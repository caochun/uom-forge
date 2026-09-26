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
    businessBasis: '建模依据。', businessBasisComplete: true,
    designReview: { status: 'drafting', round: 2, businessBasisVersion: artifactVersion('建模依据。'), rounds: [
      { design: '完整设计。', verdict: 'revise', feedback: '办理操作缺少前提。' },
    ] },
  } }
  const restored = restoreProject(JSON.parse(JSON.stringify(stored)), empty)
  assert.equal(restored.plan?.plan, '完整设计。')
  assert.equal(restored.plan?.complete, true)
  assert.equal(restored.plan?.designDraft, '部分修订')
  assert.equal(restored.plan?.designReview?.reason, 'interrupted')
  assert.equal(restored.plan?.designReview?.rounds[0].feedback, '办理操作缺少前提。')
  assert.equal(restored.plan?.designReview?.businessBasisVersion, artifactVersion('建模依据。'))
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
  const { questions: _priorQuestions, ...model } = stored.candidate.model
  assert.deepEqual(restored.candidate, {
    ...stored.candidate,
    model: { ...model, boundaries: [] },
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

test('free-text basis and partial design survive a draft round trip', () => {
  for (const complete of [false, true]) {
    const stored: Project = { ...empty, plan: {
      plan: '设计没有固定章节。', businessBasis: '事实、故事和情形都可用自然语言描述。',
      businessBasisReasoning: '先分辨事实与待确认内容。',
      designReasoning: '先确定对象边界。',
      designCheckReasoning: '再检查业务过程是否可表达。',
      businessBasisComplete: complete, complete: false, compiled: false,
      basis: { narrative: '本轮业务说明。' },
    } }
    const restored = restoreProject(JSON.parse(JSON.stringify(stored)), empty)
    assert.equal(restored.plan?.businessBasis, stored.plan?.businessBasis)
    assert.equal(restored.plan?.businessBasisReasoning, stored.plan?.businessBasisReasoning)
    assert.equal(restored.plan?.designReasoning, stored.plan?.designReasoning)
    assert.equal(restored.plan?.designCheckReasoning, stored.plan?.designCheckReasoning)
    assert.equal(restored.plan?.businessBasisComplete, complete)
    assert.equal(restored.plan?.plan, stored.plan?.plan)
    assert.deepEqual(restored.plan?.basis, { narrative: '本轮业务说明。', sources: undefined })
  }
})

test('basis reasoning survives interruption before body output and invalid stored reasoning is dropped', () => {
  const plan = { plan: '', complete: false, compiled: false, businessBasisReasoning: '正在提炼事实。' }
  const restored = restoreProject({ ...empty, plan }, empty)
  assert.equal(restored.plan?.businessBasisReasoning, plan.businessBasisReasoning)
  assert.equal(restored.plan?.businessBasis, undefined)
  assert.equal(restored.plan?.businessBasisComplete, undefined)
  assert.equal(restoreProject({ ...empty, plan: { ...plan, businessBasisReasoning: { invalid: true } } }, empty).plan?.businessBasisReasoning, undefined)
})

test('design reasoning survives an interrupted draft and invalid values are dropped', () => {
  const plan = {
    plan: '对象：申请。', complete: false, compiled: false,
    designReasoning: '正在判断对象边界。',
    designCheckReasoning: '正在检查前提条件。',
  }
  const restored = restoreProject({ ...empty, plan }, empty)
  assert.equal(restored.plan?.designReasoning, plan.designReasoning)
  assert.equal(restored.plan?.designCheckReasoning, plan.designCheckReasoning)
  const invalid = restoreProject({ ...empty, plan: { ...plan, designReasoning: 42, designCheckReasoning: null } }, empty)
  assert.equal(invalid.plan?.designReasoning, undefined)
  assert.equal(invalid.plan?.designCheckReasoning, undefined)
})
