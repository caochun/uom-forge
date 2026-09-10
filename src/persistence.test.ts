import test from 'node:test'
import assert from 'node:assert/strict'
import type { Project } from './types.ts'
import { initialRevisions } from './workspace.ts'
import { restoreProject } from './persistence.ts'

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
  assert.deepEqual(restored.candidate, stored.candidate)
  assert.deepEqual(restored.answers, stored.answers)
  assert.equal(restored.feedbackDocumentRevision, 2)
  assert.equal(restored.feedback, stored.feedback)
  assert.deepEqual(restored.understanding?.questions, [
    { text: '待确认事项', options: [] },
  ])
  assert.equal(restored.timings.understand?.[0].firstTextMs, 100)
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
