import test from 'node:test'
import assert from 'node:assert/strict'
import {
  extractQuestions,
  withoutQuestionSection,
} from '../shared/questions.ts'
import {
  hasUnsavedAnswers,
  reviseUnderstanding,
  saveUnderstandingAnswers,
  sameAnswer,
  receiveClarifications,
} from './understanding.ts'
import { freshness } from './workspace.ts'
import type { Understanding } from '../shared/analysis.ts'
import type { BusinessClarification } from '../shared/analysis.ts'
import { restoreProject } from './persistence.ts'
import type { Project } from './types.ts'

const source: Understanding = {
  narrative:
    '## 业务概述\n按需求办理事项。\n\n## 不确定事项\n某类事项采用的办理方式尚未说明。\n\n## 待确认问题\n1. 某类事项采用哪套办理方式？\n选项：沿用通常方式；单独办理\n2. 结果要保留哪些内容？\n多选：办理主体；办理时间\n3. 说明保留时限？\n\n## 附注\n保留这段正文。',
  questions: [
    {
      text: '某类事项采用哪套办理方式？',
      options: ['沿用通常方式', '单独办理'],
    },
    {
      text: '结果要保留哪些内容？',
      options: ['办理主体', '办理时间'],
      multiple: true,
    },
    { text: '说明保留时限？', options: [] },
  ],
  warnings: [],
}
const project = (): Project => ({
  version: 4,
  document: { name: 'doc', content: 'text', blocks: [], size: '', updated: '' },
  understanding: reviseUnderstanding(source),
  answers: {},
  questionsSaved: false,
  feedback: '',
  feedbackDocumentRevision: 1,
  plan: { plan: 'saved plan', complete: true, compiled: false },
  candidate: null,
  narration: '',
  assessment: null,
  outputs: {},
  timings: {},
  messages: [],
  revisions: {
    document: 1,
    understoodDocument: 1,
    business: 1,
    planBasis: 1,
    candidateBasis: 1,
    model: 1,
    narrationBasis: 1,
    assessmentBasis: 1,
  },
})

test('partial confirmations revise the narrative and leave only unanswered questions pending', () => {
  const revised = reviseUnderstanding(source, {
    0: '沿用通常方式',
    2: '保留五年',
  })
  assert.match(revised.narrative, /已确认说明：沿用通常方式/)
  assert.match(revised.narrative, /已确认说明：保留五年/)
  assert.doesNotMatch(
    revised.narrative.split('## 待确认问题')[1],
    /某类事项|保留时限/,
  )
  assert.deepEqual(extractQuestions(revised.narrative), [source.questions[1]])
  assert.deepEqual(revised.questions, [source.questions[1]])
  assert.match(revised.narrative, /保留这段正文/)
  assert.equal(revised.source, source)
  assert.doesNotMatch(source.narrative, /已确认说明/)
  assert.equal(
    withoutQuestionSection(revised.narrative).includes(
      '已确认说明：沿用通常方式',
    ),
    true,
  )
})

test('changing, clearing and repeated saves do not accumulate previous answers or sections', () => {
  const first = reviseUnderstanding(source, { 0: '沿用通常方式' })
  const changed = reviseUnderstanding(first.source, { 0: '单独办理' })
  assert.doesNotMatch(changed.narrative, /已确认说明：沿用通常方式/)
  assert.match(changed.narrative, /已确认说明：单独办理/)
  assert.equal(changed.narrative.split('## 已确认的业务说明').length, 2)
  assert.deepEqual(
    reviseUnderstanding(changed.source, { 0: '单独办理' }),
    changed,
  )
  assert.equal(
    reviseUnderstanding(changed.source, {}).narrative,
    source.narrative,
  )
  const all = reviseUnderstanding(source, {
    0: '单独办理',
    1: ['办理时间', '办理主体'],
    2: '五年',
  })
  assert.deepEqual(all.questions, [])
  assert.doesNotMatch(all.narrative, /## 待确认问题/)
})

test('draft answers do not change the saved understanding and saving invalidates downstream outputs once', () => {
  const initial = project()
  const draft = { ...initial, answers: { 0: '沿用通常方式' } }
  assert.equal(hasUnsavedAnswers(draft), true)
  assert.equal(draft.understanding?.narrative, source.narrative)
  const saved = saveUnderstandingAnswers(draft)
  assert.equal(hasUnsavedAnswers(saved), false)
  assert.equal(saved.revisions.business, initial.revisions.business + 1)
  assert.equal(freshness(saved.revisions).plan, true)
  assert.equal(freshness(saved.revisions).candidate, true)
  assert.equal(freshness(saved.revisions).assessment, true)
  assert.equal(saveUnderstandingAnswers(saved).revisions, saved.revisions)
  const staleDocument = {
    ...saved,
    revisions: { ...saved.revisions, document: 2 },
    answers: { 0: '单独办理' },
  }
  assert.equal(saveUnderstandingAnswers(staleDocument), staleDocument)
})

test('multi-select is a set; blank answers and out-of-catalogue entries never become confirmations', () => {
  const initial = {
    ...project(),
    answers: {
      1: ['办理时间', '办理主体', '办理主体'],
      2: '  ',
      99: '不属于当前问题',
    },
  }
  const saved = saveUnderstandingAnswers(initial)
  assert.deepEqual(saved.understanding?.confirmedAnswers, {
    1: ['办理主体', '办理时间'],
  })
  assert.equal(hasUnsavedAnswers(saved), false)
  assert.equal(
    sameAnswer(initial.answers[1], saved.understanding?.confirmedAnswers[1]),
    true,
  )
  assert.equal(
    hasUnsavedAnswers({ ...saved, answers: { 1: ['办理主体', '办理时间'] } }),
    false,
  )
})

test('model and assessment clarifications join one catalogue without reopening answered questions', () => {
  const saved = saveUnderstandingAnswers({
    ...project(),
    answers: { 0: '沿用通常方式' },
  })
  const clarification: BusinessClarification = {
    text: '一份记录可以归属多个事项吗？',
    basis: '记录需追溯事项。',
    ambiguity: '仅归属一次事项或由多个事项共同使用。',
    impact: '决定归属关系是否允许指向多个事项。',
    options: ['仅一个', '可多个'],
    multiple: false,
  }
  const discovered = receiveClarifications(saved, [clarification], 'model')
  assert.equal(discovered.understanding!.source.questions.length, 4)
  assert.equal(discovered.revisions, saved.revisions)
  assert.equal(hasUnsavedAnswers(discovered), false)
  assert.match(
    discovered.understanding!.narrative,
    /决定归属关系是否允许指向多个事项/,
  )
  assert.equal(discovered.understanding!.questions.length, 3)
  assert.equal(
    receiveClarifications(discovered, [clarification], 'assess'),
    discovered,
  )
  assert.equal(
    receiveClarifications(
      discovered,
      [{ ...clarification, text: source.questions[0].text }],
      'model',
    ),
    discovered,
  )
  const answered = saveUnderstandingAnswers({
    ...discovered,
    answers: { ...discovered.answers, 3: '可多个' },
  })
  assert.equal(answered.revisions.business, discovered.revisions.business + 1)
  assert.equal(answered.understanding!.questions.length, 2)
  assert.equal(answered.understanding!.confirmedAnswers[0], '沿用通常方式')
  assert.match(answered.understanding!.narrative, /已确认说明：可多个/)
  assert.doesNotMatch(
    answered.understanding!.narrative.split('## 待确认问题')[1],
    /一份记录/,
  )
  assert.equal(freshness(answered.revisions).candidate, true)
  const restored = restoreProject(
    JSON.parse(JSON.stringify(answered)),
    project(),
  )
  assert.deepEqual(
    restored.understanding!.source.questions[3].clarification,
    answered.understanding!.source.questions[3].clarification,
  )
  assert.equal(restored.understanding!.confirmedAnswers[3], '可多个')
  assert.equal(restored.revisions.business, answered.revisions.business)
  assert.equal(
    receiveClarifications(restored, [clarification], 'assess'),
    restored,
  )
  const stale = {
    ...restored,
    revisions: { ...restored.revisions, document: 2 },
  }
  assert.equal(receiveClarifications(stale, [clarification], 'model'), stale)
})

test('editing the revised narrative retains clarification context and answer choices', () => {
  const clarification: BusinessClarification = {
    text: '记录归属如何确定？',
    basis: '记录形成于事项。\n保存时保留关系。',
    ambiguity: '独占记录或共用记录。',
    impact: '影响事项与记录的联系。',
    options: ['独占', '共用'],
    multiple: false,
  }
  const discovered = receiveClarifications(project(), [clarification], 'assess')
  const extracted = extractQuestions(discovered.understanding!.narrative)
  assert.deepEqual(
    { multiple: false, ...extracted.at(-1) },
    discovered.understanding!.source.questions.at(-1),
  )
})
