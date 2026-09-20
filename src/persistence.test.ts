import test from 'node:test'
import assert from 'node:assert/strict'
import type { Project } from './types.ts'
import { initialRevisions } from './workspace.ts'
import { restoreProject } from './persistence.ts'
import { reviseUnderstanding, hasUnsavedAnswers } from './understanding.ts'
import { freshness } from './workspace.ts'
import { extractUnderstandingSources } from '../shared/understanding-sources.ts'
import { artifactVersion } from '../shared/workflow.ts'
import { prepareCompilationRetry } from './modeling-progress.ts'

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
test('partial compilation output survives reload without becoming a candidate, and retry starts a fresh stream', () => {
  const stored: Project = { ...empty, plan: {
    plan: '已完成设计', complete: true, compiled: false,
    compilation: { text: '{"objects":[', reasoning: '转录对象。', attempt: 2, callId: 'previous-call', status: 'streaming' },
  } }
  const restored = restoreProject(JSON.parse(JSON.stringify(stored)), empty)
  assert.equal(restored.candidate, null)
  assert.equal(restored.plan?.compiled, false)
  assert.deepEqual(restored.plan?.compilation, { text: '{"objects":[', reasoning: '转录对象。', attempt: 2, status: 'interrupted' })
  assert.equal(prepareCompilationRetry(restored.plan!).compilation, undefined)
  assert.equal(prepareCompilationRetry(restored.plan!).plan, '已完成设计')
})
test('interrupted design iteration retains complete design, partial revision and reviewer feedback on reload', () => {
  const stored: Project = { ...empty, plan: {
    plan: '完整设计。', complete: true, compiled: false, designDraft: '部分修订',
    businessBasis: '业务依据。', businessBasisComplete: true,
    designReview: { status: 'drafting', round: 2, businessBasisVersion: artifactVersion('业务依据。'), rounds: [
      { design: '完整设计。', verdict: 'revise', feedback: '办理操作缺少前提。' },
    ] },
  } }
  const restored = restoreProject(JSON.parse(JSON.stringify(stored)), empty)
  assert.equal(restored.plan?.plan, '完整设计。')
  assert.equal(restored.plan?.complete, true)
  assert.equal(restored.plan?.designDraft, '部分修订')
  assert.equal(restored.plan?.designReview?.reason, 'interrupted')
  assert.equal(restored.plan?.designReview?.rounds[0].feedback, '办理操作缺少前提。')
  assert.equal(restored.plan?.designReview?.businessBasisVersion, artifactVersion('业务依据。'))
})
test('understanding sources and the model’s original basis survive restoration independently', () => {
  const old = extractUnderstandingSources('客户提交。 [[source:b1]]', { name: '旧文档', blocks: [{ id: 'b1', text: '提交申请原文。' }] })
  const current = extractUnderstandingSources('客户撤回。 [[source:b1]]', { name: '新文档', blocks: [{ id: 'b1', text: '撤回申请原文。' }] })
  const stored: Project = {
    ...empty,
    understanding: reviseUnderstanding({ ...current, questions: [] }),
    plan: { plan: '设计草案', complete: true, compiled: true, basis: old },
  }
  const restored = restoreProject(JSON.parse(JSON.stringify(stored)), empty)
  assert.equal(restored.understanding?.sources?.blocks[0].text, '撤回申请原文。')
  assert.equal(restored.plan?.basis?.sources?.blocks[0].text, '提交申请原文。')
  assert.equal(restored.plan?.basis?.narrative, '客户提交。')
})
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
        {
          callId: 'glm1',
          provider: 'glm',
          model: 'glm-5.3-flash',
          reasoningEffort: 'max',
          connectedMs: 80,
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
  assert.equal(restored.timings.understand?.[2].provider, 'glm')
  assert.equal(restored.timings.understand?.[2].reasoningEffort, 'max')
  assert.deepEqual(restored.messages[0].context, stored.messages[0].context)
})

test('restoring a valid semantic plan preserves its fact, story and mapping chain', () => {
  const semantic = {
    schemaVersion: '2',
    status: 'mapped',
    facts: [
      {
        id: 'fact-1',
        statement: '客户提交订单',
        kind: 'event',
        actors: ['客户'],
        objects: ['订单'],
        conditions: [],
        source: '客户提交订单',
        certainty: 'explicit',
      },
    ],
    stories: [
      {
        id: 'story-1',
        name: '下单',
        goal: '提交订单',
        factIds: ['fact-1'],
        steps: [
          { order: 1, actor: '客户', action: '提交', object: '订单', factIds: ['fact-1'] },
        ],
      },
    ],
    mappings: [
      {
        factId: 'fact-1',
        elementIds: ['submit-order'],
        mappingType: 'action',
        explanation: '提交动作表达该事实',
        coverage: 'full',
      },
    ],
    boundaries: [],
    clarifications: [],
  }
  const restored = restoreProject(
    { ...empty, plan: { plan: '说明', complete: true, compiled: false, semantic } },
    empty,
  )
  assert.deepEqual(restored.plan?.semantic, semantic)
})

test('malformed semantic plans are dropped at the storage boundary', () => {
  const restored = restoreProject(
    {
      ...empty,
      plan: {
        plan: '说明',
        complete: true,
        compiled: false,
        semantic: { facts: 'invalid', stories: [], mappings: [], boundaries: [], clarifications: [] },
      },
    },
    empty,
  )
  assert.equal(restored.plan?.semantic, undefined)
})
test('partial semantic snapshots survive a draft reload', () => {
  const semantic = {
    schemaVersion: '2',
    status: 'facts',
    facts: [
      {
        id: 'fact-1', statement: '客户提交订单', kind: 'event',
        actors: ['客户'], objects: ['订单'], conditions: [],
        source: '客户提交订单', certainty: 'explicit',
      },
    ],
    stories: [], mappings: [], boundaries: [], clarifications: [],
  }
  const restored = restoreProject(
    { ...empty, plan: { plan: '', complete: false, compiled: false, semantic } },
    empty,
  )
  assert.equal(restored.plan?.semantic?.status, 'facts')
  assert.equal(restored.plan?.semantic?.facts[0].source, '客户提交订单')
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

test('free-text basis and partial design survive a draft round trip without legacy semantic records', () => {
  for (const complete of [false, true]) {
    const stored: Project = { ...empty, plan: {
      plan: '设计没有固定章节。', businessBasis: '事实、故事和情形都可用自然语言描述。',
      businessBasisComplete: complete, complete: false, compiled: false,
      basis: { narrative: '本轮业务说明。' },
    } }
    const restored = restoreProject(JSON.parse(JSON.stringify(stored)), empty)
    assert.equal(restored.plan?.businessBasis, stored.plan?.businessBasis)
    assert.equal(restored.plan?.businessBasisComplete, complete)
    assert.equal(restored.plan?.plan, stored.plan?.plan)
    assert.equal(restored.plan?.semantic, undefined)
    assert.deepEqual(restored.plan?.basis, { narrative: '本轮业务说明。', sources: undefined })
  }
})
