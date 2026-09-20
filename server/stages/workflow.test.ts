import test from 'node:test'
import assert from 'node:assert/strict'
import type { CandidateModel } from '../../shared/model.ts'
import type { ModelingResult, StageEvent } from '../../shared/analysis.ts'
import type { SemanticPlanV2 } from '../../shared/semantic.ts'
import { artifactVersion } from '../../shared/workflow.ts'
import { validateSemanticPlan } from '../../shared/semantic-validation.ts'
import { checkAndRepair } from './expression.ts'
import { completeSemanticMapping, resumeModel } from './modeling.ts'
import { reviewUnderstanding } from './understanding-review.ts'
import { parseAnalysisRequest } from '../validation/requests.ts'
import { buildSemanticPreparation } from './semantic.ts'

const narrative = '同一份材料可以反复校订，每次校订保存独立批注。'
const model: CandidateModel = {
  schemaVersion: '1', name: '校订', summary: narrative,
  objects: [{ id: 'material', name: '材料', description: '独立材料', properties: [], evidence: [] }],
  relations: [], actions: [], functions: [], rules: [], activities: [], boundaries: [],
}
const semantic: SemanticPlanV2 = {
  schemaVersion: '2', status: 'stories', narrativeVersion: artifactVersion(narrative),
  facts: [{ id: 'F1', statement: narrative, kind: 'event', actors: ['校订人'], objects: ['材料', '批注'], conditions: [], source: narrative, certainty: 'explicit' }],
  stories: [{ id: 'S1', name: '校订', goal: '保留批注', factIds: ['F1'], steps: [{ order: 1, actor: '校订人', action: '校订', object: '材料', result: '保存独立批注', factIds: ['F1'] }] }],
  scenarios: [{ id: 'Q1', factIds: ['F1'], statement: narrative, scenario: '材料 A 两次校订分别形成批注 X、Y。', distinction: '确定批注属于哪次校订。' }],
  mappings: [], boundaries: [], clarifications: [],
}
const compiled = (): Omit<ModelingResult, 'expressionReview'> => ({
  semanticPlan: '## 对象及边界\n材料。', semantic: structuredClone(semantic), model: structuredClone(model),
  clarifications: [], provenance: { basis: 'business-understanding', evidence: 'unlinked' }, validation: { elements: 1, warnings: [] },
})
const judgment = (status: 'expressed' | 'defect' | 'uncertain' = 'expressed', target = 'model') => JSON.stringify({
  summary: '本轮表达判断。', judgments: [{ id: 'Q1', status, repairTarget: target,
    elements: ['material'], explanation: '检查批注的归属表达。', gap: status === 'expressed' ? '' : '归属没有确定。', suggestion: status === 'expressed' ? '' : '核对参与者与发生归属。' }],
  additionalCases: [], clarifications: [],
})
const initialCheck = (status: 'expressed' | 'defect' | 'uncertain' = 'expressed', target = 'model') => JSON.stringify({
  summary: '本轮表达判断。',
  cases: [{ id: 'Q1', fact: narrative, basis: narrative,
    scenario: '材料 A 两次校订分别形成批注 X、Y。\n需保留的区别：确定批注属于哪次校订。',
    status, repairTarget: target, elements: ['material'], explanation: '检查批注的归属表达。',
    gap: status === 'expressed' ? '' : '归属没有确定。', suggestion: status === 'expressed' ? '' : '核对参与者与发生归属.' }],
  clarifications: [],
})
const mapping = () => JSON.stringify({ mappings: [{ factId: 'F1', elementIds: ['material'], mappingType: 'object', explanation: '材料承载事实。', coverage: 'full' }] })

test('understanding audit preserves omissions and unsupported additions with valid provenance', async () => {
  const review = await reviewUnderstanding('材料只能校订一次。', [{ id: 'B1', text: narrative }], async () => JSON.stringify({
    gaps: [
      { kind: 'omission', blockIds: ['B1'], passage: '', note: '遗漏重复发生。' },
      { kind: 'conflict', blockIds: ['B1'], passage: '材料只能校订一次。', note: '原文允许反复校订。' },
    ],
  }), 'glm')
  assert.equal(review.status, 'issues')
  assert.deepEqual(review.findings.map(x => x.kind), ['omission', 'conflict'])
  assert.equal(review.narrativeVersion, artifactVersion('材料只能校订一次。'))
  const interrupted = await reviewUnderstanding(narrative, [{ id: 'B1', text: narrative }], async () => { throw new Error('terminated') }, 'glm')
  assert.equal(interrupted.status, 'incomplete')
  assert.match(interrupted.warnings[0], /terminated/)
})

test('scenarios are prepared before any candidate input and reject invented fact references', async () => {
  const events: StageEvent[] = []
  const prompts: string[] = []
  const result = await buildSemanticPreparation(narrative, async prompt => {
    prompts.push(prompt)
    return prompt.includes('业务事实提取器') ? JSON.stringify({ facts: semantic.facts }) : JSON.stringify({ stories: semantic.stories, scenarios: semantic.scenarios })
  }, { onEvent: event => events.push(event) })
  assert.equal(prompts.length, 2)
  assert.deepEqual(result.scenarios, semantic.scenarios)
  assert.equal(result.narrativeVersion, artifactVersion(narrative))
  assert.equal(events.filter(x => x.type === 'semantic-plan').length, 2)
  assert.throws(() => validateSemanticPlan({ ...result, scenarios: [{ ...semantic.scenarios![0], factIds: ['S1'] }] }), /未知事实/)
  assert.throws(() => validateSemanticPlan(result, narrative + '已修改。'), /依据已变化/)
})

test('fixed pre-model scenarios survive checks; changing them cannot produce a passing check', async () => {
  let calls = 0
  const result = await checkAndRepair(compiled(), narrative, async prompt => {
    calls++
    assert.match(prompt, /材料 A 两次校订/)
    if (calls === 1) {
      assert.match(prompt, /这是首次检查/)
      assert.match(prompt, /judgments/)
    }
    if (calls === 1) {
      return JSON.stringify({
        summary: '通过',
        cases: [{
          id: 'Q1', fact: narrative, basis: narrative,
          scenario: '只有一次', status: 'expressed', elements: ['material'],
          explanation: '材料可以表达。', gap: '', suggestion: '',
        }],
        clarifications: [],
      })
    }
    return JSON.stringify({
      summary: '通过',
      cases: [{
        id: 'Q1', fact: narrative, basis: narrative,
        scenario: '材料 A 两次校订分别形成批注 X、Y。\n需保留的区别：确定批注属于哪次校订。',
        status: 'expressed', elements: ['material'],
        explanation: '材料可以表达。', gap: '', suggestion: '',
      }],
      clarifications: [],
    })
  }, {})
  assert.equal(calls, 2)
  assert.equal(result.expressionReview.status, 'passed')
  const checked = result.expressionReview.snapshots[0].check!.cases[0]
  assert.match(checked.scenario, /两次校订/)
  assert.deepEqual(checked.factIds, ['F1'])
})

test('understanding gaps do not enter model repair and unresolved facts cannot map as full', async () => {
  let calls = 0
  const result = await checkAndRepair(compiled(), narrative, async () => { calls++; return initialCheck('defect', 'understanding') }, {})
  assert.equal(calls, 1)
  assert.equal(result.expressionReview.status, 'issues')
  assert.equal(result.expressionReview.changes.length, 0)
  const mapped = await completeSemanticMapping(result, narrative, async () => mapping(), {})
  assert.equal(mapped.semantic?.mappings[0].coverage, 'partial')
  assert.equal(mapped.semantic?.mappedModelVersion, artifactVersion(model))
})

test('mapping alone resumes after interruption without changing candidate, plan, or checking again', async () => {
  const result = await checkAndRepair(compiled(), narrative, async () => initialCheck(), {})
  const failed = await completeSemanticMapping(result, narrative, async () => { throw new Error('terminated') }, {})
  assert.equal(failed.semantic?.status, 'stories')
  let calls = 0
  const request = parseAnalysisRequest({ stage: 'map', narrative, result: failed }, 'glm')
  assert.equal(request.stage, 'map')
  const resumed = await resumeModel('map', narrative, failed, async prompt => {
    calls++
    assert.match(prompt, /映射到已经编译/)
    assert.doesNotMatch(prompt, /第二阶段 B|第二阶段内部业务表达检查/)
    return mapping()
  })
  assert.equal(calls, 1)
  assert.deepEqual(resumed.model, model)
  assert.equal(resumed.semanticPlan, failed.semanticPlan)
  assert.equal(resumed.semantic?.status, 'mapped')
  assert.equal(resumed.validation.warnings.length, 0)
  assert.throws(() => parseAnalysisRequest({ stage: 'map', narrative: narrative + '变化', result: failed }, 'glm'), /依据|版本/)
})

test('a verification resume keeps fixed scenarios and candidate without invoking compilation', async () => {
  const events: StageEvent[] = []
  const failed = await checkAndRepair(compiled(), narrative, async () => { throw new Error('terminated') }, {})
  assert.equal(failed.expressionReview.status, 'incomplete')
  const resumed = await resumeModel('verify', narrative, failed, async prompt => {
    assert.doesNotMatch(prompt, /第二阶段 B|第二阶段 A/)
    return prompt.includes('映射到已经编译') ? mapping() : judgment()
  }, { onEvent: event => events.push(event) })
  assert.equal(resumed.expressionReview.status, 'passed')
  assert.equal(resumed.expressionReview.warnings.length, 0)
  assert.deepEqual(resumed.model, model)
  assert.ok(events.some(e => e.type === 'model-checkpoint'))
  assert.ok(events.some(e => e.type === 'phase' && e.part === 'mapping'))
})

test('repairs preserve initial plan lineage and recovery rejects a mismatched candidate', async () => {
  let calls = 0
  const result = await checkAndRepair(compiled(), narrative, async () => {
    calls++
    if (calls === 1) return initialCheck('defect')
    if (calls === 2) return JSON.stringify({ changes: [{ collection: 'objects', id: 'material', value: { ...model.objects[0], description: '材料下分别记录每次校订及其批注归属。' }, caseIds: ['Q1'], reason: '明确本次校订的独立归属。' }] })
    return judgment()
  }, {})
  assert.notEqual(result.expressionReview.lineage?.compiledModelVersion, result.expressionReview.lineage?.candidateVersion)
  assert.equal(result.expressionReview.lineage?.planVersion, artifactVersion(result.semanticPlan))
  assert.equal(result.expressionReview.snapshots.length, 2)
  const forged = { ...result, model: { ...result.model, summary: '另一个版本' } }
  assert.throws(() => parseAnalysisRequest({ stage: 'verify', narrative, result: forged }, 'glm'), /不一致|版本/)
})

test('a later repair regression rolls back to the preceding accepted candidate', async () => {
  let calls = 0
  const result = await checkAndRepair(compiled(), narrative, async () => {
    calls++
    if (calls === 1) return initialCheck('defect')
    if (calls === 2) return JSON.stringify({ changes: [{
      collection: 'objects', id: 'material',
      value: { ...model.objects[0], description: '第一次修正保留每次校订的归属。' },
      caseIds: ['Q1'], reason: '补足第一次校订的业务归属。',
    }] })
    if (calls === 3) return JSON.stringify({
      summary: '新增第二种情形。',
      judgments: [{ id: 'Q1', status: 'expressed', repairTarget: 'model', elements: ['material'], explanation: '第一次情形仍可表达。', gap: '', suggestion: '' }],
      additionalCases: [{
        id: 'Q2', fact: narrative, basis: narrative,
        scenario: '材料 A 在另一时点再次校订并形成批注 Z。',
        status: 'defect', repairTarget: 'model', elements: ['material'],
        explanation: '无法区分第二次校订。', gap: '缺少发生归属。', suggestion: '保留第二次校订的归属。',
      }],
      clarifications: [],
    })
    if (calls === 4) return JSON.stringify({ changes: [{
      collection: 'objects', id: 'material',
      value: { ...model.objects[0], description: '第二次修正仅保留 Z 的归属。' },
      caseIds: ['Q2'], reason: '修正第二种情形。',
    }] })
    return JSON.stringify({
      summary: '第二种情形通过但第一次情形回归。',
      judgments: [{ id: 'Q1', status: 'defect', repairTarget: 'model', elements: ['material'], explanation: '第一次情形不再可表达。', gap: '归属回归。', suggestion: '恢复第一次归属。' },
        { id: 'Q2', status: 'expressed', repairTarget: 'model', elements: ['material'], explanation: '第二种情形可表达。', gap: '', suggestion: '' }],
      additionalCases: [], clarifications: [],
    })
  }, {})
  assert.equal(calls, 5)
  assert.equal(result.expressionReview.selectedSnapshot, 1)
  assert.equal(result.model.objects[0].description, '第一次修正保留每次校订的归属。')
  assert.match(result.expressionReview.warnings.join('\n'), /恢复本轮修正前的候选/)
})
