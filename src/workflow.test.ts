import type { Project } from './types.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { restoreProject } from './persistence.ts'
import { prepareModelResume, resumeNarrative } from './model-resume.ts'
import { artifactVersion } from '../shared/workflow.ts'
import { modelingProgress } from './modeling-progress.ts'
import { initialRevisions } from './workspace.ts'
import { parseAnalysisEvent } from './responses.ts'

const empty: Project = { version: 4, document: { name: '', content: '', size: '', updated: '', blocks: [] }, understanding: null, answers: {}, questionsSaved: false, feedback: '', feedbackDocumentRevision: null, plan: null, candidate: null, narration: '', assessment: null, outputs: {}, timings: {}, revisions: initialRevisions, messages: [] }

const narrative = '作者提交材料。'
const model = { schemaVersion: '1', name: '材料', summary: narrative, objects: [{ id: 'material', name: '材料', description: '独立材料。', properties: [], evidence: [] }], relations: [], actions: [], functions: [], rules: [], activities: [], boundaries: [] }
const review = { status: 'issues', narrativeVersion: artifactVersion(narrative), sourceVersion: 'source-v1', findings: [{ kind: 'omission', blockIds: ['B1'], passage: '', note: '需要核对参与者。' }], warnings: [] }
const saved = () => ({
  version: 4,
  document: { name: '业务', content: narrative, blocks: [{ id: 'B1', text: narrative }], size: '1', updated: '' },
  understanding: { narrative, questions: [], warnings: [], review },
  plan: { plan: '材料与作者。', complete: true, compiled: true, basis: { narrative }, semantic: {
    schemaVersion: '2', status: 'stories', narrativeVersion: artifactVersion(narrative), understandingReview: review,
    facts: [{ id: 'F1', statement: narrative, source: narrative, kind: 'event', actors: ['作者'], objects: ['材料'], conditions: [], certainty: 'explicit' }],
    stories: [], scenarios: [{ id: 'Q1', factIds: ['F1'], statement: narrative, scenario: '作者 A 提交材料 X。', distinction: '材料的提交者。' }], mappings: [], boundaries: [], clarifications: [],
  } },
  candidate: { model, revision: 1, documentRevision: 0, expressionReview: {
    status: 'checking', selectedSnapshot: 0, snapshots: [{ model }], changes: [], warnings: [],
    lineage: { narrativeVersion: artifactVersion(narrative), planVersion: artifactVersion('材料与作者。'), compiledModelVersion: artifactVersion(model), candidateVersion: artifactVersion(model) },
  } },
  revisions: { ...initialRevisions, understoodDocument: 0, planBasis: 0, candidateBasis: 0, model: 1 },
})

test('restored drafts retain understanding findings, scenarios and lineage, and interrupted checks can resume', () => {
  const project = restoreProject(JSON.parse(JSON.stringify(saved())), empty)
  assert.ok(project)
  assert.equal(project.understanding?.review?.findings[0].note, '需要核对参与者。')
  assert.equal(project.plan?.semantic?.scenarios?.[0].id, 'Q1')
  assert.equal(project.candidate?.expressionReview?.status, 'incomplete')
  const result = prepareModelResume(project, 'verify')
  assert.equal(result.expressionReview.lineage?.candidateVersion, artifactVersion(model))
  project.understanding!.narrative += '\n## 待确认问题\n1. 新发现的问题？'
  assert.equal(resumeNarrative(project), narrative)
  assert.equal(prepareModelResume(project, 'map').semanticPlan, '材料与作者。')
  project.revisions.business++
  assert.throws(() => prepareModelResume(project, 'verify'), /依据已变化/)
})

test('manual edits create a new checking snapshot without discarding prior candidates', () => {
  const project = restoreProject(saved(), empty)
  project.candidate!.edited = true
  project.candidate!.model = { ...project.candidate!.model, summary: '人工澄清后的模型表述。' }
  assert.throws(() => prepareModelResume(project, 'map'), /先重新检查/)
  const result = prepareModelResume(project, 'verify')
  assert.equal(result.expressionReview.snapshots.length, 2)
  assert.equal(result.expressionReview.snapshots[0].model.summary, narrative)
  assert.equal(result.expressionReview.snapshots[1].model.summary, '人工澄清后的模型表述。')
  assert.equal(result.expressionReview.lineage?.candidateVersion, artifactVersion(result.model))
})

test('mapping progress and understanding review SSE have explicit validated states', () => {
  const project = restoreProject(saved(), empty)
  assert.equal(modelingProgress({ plan: project.plan, candidate: project.candidate, runningPart: 'mapping' }).active?.id, 'mapping')
  assert.equal(parseAnalysisEvent({ type: 'understanding-review', review }).type, 'understanding-review')
  assert.throws(() => parseAnalysisEvent({ type: 'understanding-review' }), /无效事件/)
  assert.throws(() => parseAnalysisEvent({ type: 'semantic-plan', part: 'semantic', semantic: { ...project.plan!.semantic, scenarios: [{ id: 'bad', factIds: ['unknown'] }] } }), /情形/)
})
