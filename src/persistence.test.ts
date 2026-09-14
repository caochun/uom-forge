import test from 'node:test'
import assert from 'node:assert/strict'
import type { Project } from './types.ts'
import { initialRevisions } from './workspace.ts'
import { restoreProject } from './persistence.ts'
import { reviseUnderstanding, hasUnsavedAnswers } from './understanding.ts'
import { freshness } from './workspace.ts'

const empty: Project = {
  version: 4,
  document: { name: '', content: '', size: '', updated: '', blocks: [] },
  understanding: null,
  answers: {},
  questionsSaved: false,
  feedback: '',
  feedbackDocumentRevision: null,
  plan: null,
  candidate: null,
  narration: '',
  assessment: null,
  outputs: {},
  timings: {},
  revisions: initialRevisions,
  messages: [],
}
test('expression review survives save/restore, interrupted work is incomplete, and updated understanding makes it stale', () => {
  const model = {
    schemaVersion: '1',
    name: '事项',
    summary: '说明',
    objects: [],
    relations: [],
    actions: [],
    functions: [],
    rules: [],
    activities: [],
    boundaries: [],
  }
  const stored = {
    ...empty,
    revisions: {
      ...initialRevisions,
      understoodDocument: 0,
      business: 1,
      candidateBasis: 1,
      model: 2,
    },
    candidate: {
      model,
      revision: 2,
      documentRevision: 0,
      expressionReview: {
        status: 'checking',
        snapshots: [{ model }],
        changes: [],
        warnings: [],
      },
    },
  }
  const restored = restoreProject(JSON.parse(JSON.stringify(stored)), empty)
  assert.equal(restored.candidate?.expressionReview?.status, 'incomplete')
  assert.equal(restored.candidate?.expressionReview?.snapshots.length, 1)
  assert.deepEqual(
    restored.candidate?.expressionReview?.snapshots[0].model,
    model,
  )
  assert.equal(freshness(restored.revisions).candidate, false)
  assert.equal(
    freshness({ ...restored.revisions, business: 2 }).candidate,
    true,
  )
  const again = restoreProject(JSON.parse(JSON.stringify(restored)), empty)
  assert.deepEqual(
    again.candidate?.expressionReview,
    restored.candidate?.expressionReview,
  )
})
test('restoring an existing draft preserves the document, edits, answers, feedback and timing history', () => {
  const stored = {
    ...empty,
    document: {
      name: '业务文档.docx',
      content: '<p>正文</p>',
      size: '1 KB',
      updated: 'now',
      blocks: [{ id: 'block-1', text: '正文' }],
    },
    understanding: {
      narrative: '业务说明',
      questions: ['待确认事项'],
      warnings: [],
    },
    answers: { 0: ['甲', '乙'], 1: '补充信息' },
    feedback: '保留对象边界',
    feedbackDocumentRevision: 2,
    plan: {
      plan: '建模说明原文',
      complete: true,
      compiled: false,
      warnings: ['有一项澄清未通过引文校验，未加入问题目录。'],
    },
    revisions: {
      ...initialRevisions,
      document: 2,
      understoodDocument: 2,
      business: 3,
      candidateBasis: 3,
      model: 4,
    },
    candidate: {
      edited: true,
      revision: 4,
      documentRevision: 2,
      model: {
        schemaVersion: '1',
        name: '事项',
        summary: '人工修改的说明',
        objects: [
          {
            id: 'matter',
            name: '事项',
            description: '独立业务事项',
            evidence: [],
            properties: [],
          },
        ],
        relations: [],
        actions: [],
        functions: [],
        rules: [],
        activities: [],
        questions: [],
      },
    },
    timings: {
      understand: [
        {
          callId: 'c1',
          provider: 'codex',
          model: 'test-model',
          reasoningEffort: 'medium',
          startedAt: 'now',
          elapsedMs: 500,
          firstTextMs: 100,
          promptCharacters: 20,
          outputCharacters: 40,
          status: 'completed',
        },
        {
          callId: 'gpt1',
          provider: 'gpt',
          model: 'configured-model',
          reasoningEffort: 'medium',
          connectedMs: 60,
          firstTextMs: 100,
          status: 'completed',
        },
      ],
    },
    messages: [
      {
        role: 'user',
        content: '讨论对象',
        context: {
          id: 'matter',
          name: '事项',
          description: '独立业务事项',
          additionalInfo: '保留扩展字段',
        },
      },
    ],
  }
  const restored = restoreProject(
    JSON.parse(JSON.stringify(stored)) as unknown,
    empty,
  )
  assert.deepEqual(restored.document, stored.document)
  assert.deepEqual(restored.plan, stored.plan)
  const { questions: priorQuestions, ...model } = stored.candidate.model
  assert.deepEqual(restored.candidate, {
    ...stored.candidate,
    model: { ...model, boundaries: [] },
    historicalQuestions: priorQuestions,
  })
  assert.deepEqual(restored.answers, stored.answers)
  assert.equal(restored.feedbackDocumentRevision, 2)
  assert.equal(restored.feedback, stored.feedback)
  assert.deepEqual(restored.understanding?.questions, [
    { text: '待确认事项', options: [] },
  ])
  assert.equal(restored.timings.understand?.[0].firstTextMs, 100)
  assert.equal(restored.timings.understand?.[0].provider, 'codex')
  assert.equal(restored.timings.understand?.[1].provider, 'gpt')
  assert.equal(restored.timings.understand?.[1].connectedMs, 60)
  assert.deepEqual(restored.messages[0].context, stored.messages[0].context)
})
test('old layout drafts retain object/relation/capability semantics without creating an empty candidate', () => {
  const restored = restoreProject(
    {
      objects: [{ id: 'matter', name: '事项', description: '边界' }],
      relations: [
        { id: 'related', label: '关联', fromId: 'matter', toId: 'matter' },
      ],
      capabilities: [
        {
          id: 'record',
          name: '登记',
          kind: '操作',
          targets: ['matter'],
          effects: ['创建记录'],
        },
        {
          id: 'query',
          name: '查询',
          kind: '只读能力',
          targets: ['matter'],
          output: '事项集合',
        },
      ],
      modelingState: { plan: '建模说明', complete: true },
      questionAnswers: { 0: '确认' },
      modelNarrative: '事项与操作',
    },
    empty,
  )
  assert.equal(restored.candidate?.model.relations[0].from, 'matter')
  assert.equal(restored.candidate?.model.relations[0].name, '关联')
  assert.deepEqual(restored.candidate?.model.actions[0].effects, ['创建记录'])
  assert.equal(restored.candidate?.model.functions[0].output, '事项集合')
  assert.equal(restored.plan?.plan, '建模说明')
  assert.equal(restored.answers[0], '确认')
  assert.equal(restored.narration, '事项与操作')
  assert.equal(restoreProject({ objects: [] }, empty).candidate, null)
})
test('invalid storage does not masquerade as a typed project or restart interrupted work', () => {
  assert.equal(restoreProject(null, empty), empty)
  const restored = restoreProject(
    {
      version: 4,
      document: 42,
      answers: { bad: {} },
      timings: {
        understand: [{ callId: 'c1', provider: 'codex', status: 'running' }],
      },
      messages: [{ role: 'assistant', content: '处理中', progress: true }],
    },
    empty,
  )
  assert.deepEqual(restored.document, empty.document)
  assert.deepEqual(restored.answers, {})
  assert.equal(restored.timings.understand?.[0].status, 'failed')
  assert.equal(restored.messages[0].progress, false)
})

test('saved assessments retain requirement mappings and old conclusions never gain invented mappings', () => {
  const assessment = {
    summary: '说明',
    recommendations: ['共性建议'],
    questions: ['问题'],
    processAssessments: [
      {
        processId: 'p',
        processName: '办理',
        status: 'partial',
        reason: '缺少办理联系',
        evidence: [],
        requirements: [
          {
            requirement: '保存办理主体',
            status: 'partial',
            elements: ['object'],
            explanation: '主体已存在，但没有关联到事项',
            gap: '缺少联系',
            suggestion: '补充办理关系',
            evidence: [{ quote: '办理事项' }],
          },
        ],
      },
    ],
  }
  const restored = restoreProject({ ...empty, assessment }, empty)
  const { questions: priorQuestions, ...currentAssessment } = assessment
  assert.deepEqual(restored.assessment, {
    ...currentAssessment,
    clarifications: [],
    historicalQuestions: priorQuestions,
  })
  const legacy = {
    ...assessment,
    processAssessments: [
      {
        processId: 'p',
        processName: '办理',
        status: 'partial',
        coveredElements: ['object'],
        gaps: ['缺少联系'],
        evidence: [],
      },
    ],
  }
  const old = restoreProject({ ...empty, assessment: legacy }, empty)
  assert.equal(old.assessment?.summary, '说明')
  assert.equal(old.assessment?.processAssessments[0].reason, '缺少联系')
  assert.deepEqual(old.assessment?.processAssessments[0].requirements, [])
  assert.match(JSON.stringify(old.assessment), /coveredElements/)
})

test('old model questionnaires remain history, invalidate the old candidate once and never become active business questions', () => {
  const old = {
    ...empty,
    candidate: {
      model: {
        schemaVersion: '1',
        name: '旧模型',
        summary: '旧说明',
        objects: [],
        relations: [],
        actions: [],
        functions: [],
        rules: [],
        activities: [],
        questions: ['是否增加审批？', '需要哪些技术字段？'],
      },
      revision: 1,
      documentRevision: 0,
    },
    revisions: { ...empty.revisions, business: 2, candidateBasis: 2 },
  }
  const migrated = restoreProject(old, empty)
  assert.deepEqual(
    migrated.candidate?.historicalQuestions,
    old.candidate.model.questions,
  )
  assert.equal('questions' in migrated.candidate!.model, false)
  assert.deepEqual(migrated.candidate?.model.boundaries, [])
  assert.equal(migrated.revisions.business, 3)
  assert.equal(migrated.revisions.candidateBasis, 2)
  assert.equal(migrated.understanding, null)
  const restored = restoreProject(JSON.parse(JSON.stringify(migrated)), empty)
  assert.equal(restored.revisions.business, 3)
  assert.deepEqual(
    restored.candidate?.historicalQuestions,
    old.candidate.model.questions,
  )
})

test('saved confirmations in old drafts become revised understanding once; unsaved edits stay drafts', () => {
  const source = {
    narrative:
      '## 业务概述\n办理事项。\n\n## 待确认问题\n1. 采用哪种方式？\n选项：沿用通常方式；单独办理',
    questions: [
      { text: '采用哪种方式？', options: ['沿用通常方式', '单独办理'] },
    ],
    warnings: [],
  }
  const stored = {
    ...empty,
    understanding: source,
    questionsSaved: true,
    answers: { 0: '沿用通常方式' },
    revisions: {
      ...initialRevisions,
      document: 1,
      understoodDocument: 1,
      business: 2,
      planBasis: 2,
      candidateBasis: 2,
      model: 1,
      assessmentBasis: 1,
      narrationBasis: 1,
    },
  }
  const migrated = restoreProject(stored, empty)
  assert.match(migrated.understanding!.narrative, /已确认说明：沿用通常方式/)
  assert.deepEqual(migrated.understanding!.questions, [])
  assert.equal(migrated.revisions.business, 3)
  assert.equal(freshness(migrated.revisions).candidate, true)
  const restored = restoreProject(JSON.parse(JSON.stringify(migrated)), empty)
  assert.equal(restored.revisions.business, 3)
  assert.equal(
    restored.understanding!.narrative,
    migrated.understanding!.narrative,
  )
  const unsaved = restoreProject({ ...stored, questionsSaved: false }, empty)
  assert.equal(unsaved.understanding!.narrative, source.narrative)
  assert.equal(hasUnsavedAnswers(unsaved), true)
  assert.equal(unsaved.revisions.business, 2)
  const editing = restoreProject(
    {
      ...stored,
      understanding: reviseUnderstanding(source, { 0: '沿用通常方式' }),
      answers: { 0: '单独办理' },
      questionsSaved: false,
    },
    empty,
  )
  assert.match(editing.understanding!.narrative, /已确认说明：沿用通常方式/)
  assert.doesNotMatch(editing.understanding!.narrative, /已确认说明：单独办理/)
  assert.equal(hasUnsavedAnswers(editing), true)
})
