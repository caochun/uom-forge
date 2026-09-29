import test from 'node:test'
import assert from 'node:assert/strict'
import { resetPlanStream } from './stream-recovery.ts'
import { parseAnalysisEvent, parseDiscussionEvent } from './responses.ts'
import type { ModelDesign } from './types.ts'

test('retry SSE envelopes survive the frontend boundary', () => {
  const event = { type: 'reset', part: 'design', text: '重新生成当前内容' }
  assert.deepEqual(parseAnalysisEvent(event), event)
  assert.deepEqual(parseDiscussionEvent(event), { type: 'reset', text: event.text })
  assert.throws(() => parseAnalysisEvent({ type: 'reset' }), /无效事件/)
  assert.throws(() => parseDiscussionEvent({ type: 'reset' }), /无效事件/)
})

test('retry clears only current previews and preserves completed basis/design/review history', () => {
  const plan: ModelDesign = {
    plan: '上一轮完整设计', complete: true, compiled: false,
    businessBasis: '完整依据', businessBasisComplete: true, businessBasisReasoning: '依据思考',
    designDraft: '失败设计', designReasoning: '失败思考', designCheckReasoning: '失败检查思考',
    designReview: { status: 'checking', round: 2, rounds: [{ design: '第一轮', feedback: '修改', verdict: 'revise' }], feedbackDraft: '失败检查' },
    compilation: { text: '失败 JSON', reasoning: '编译思考', status: 'streaming', attempt: 1 },
  }
  const design = resetPlanStream(plan, 'design')
  assert.equal(design.designDraft, '')
  assert.equal(design.designReasoning, '')
  assert.equal(design.plan, plan.plan)
  assert.equal(design.businessBasis, plan.businessBasis)
  assert.equal(design.designReview, plan.designReview)
  assert.equal(resetPlanStream(plan, 'basis'), plan)
  const basis = resetPlanStream({ ...plan, businessBasisComplete: false }, 'basis')
  assert.equal(basis.businessBasis, '')
  assert.equal(basis.businessBasisReasoning, '')
  const review = resetPlanStream(plan, 'design-check')
  assert.equal(review.designReview?.feedbackDraft, '')
  assert.equal(review.designCheckReasoning, '')
  assert.equal(review.designReview?.round, 2)
  assert.equal(review.designReview?.rounds, plan.designReview?.rounds)
  const compile = resetPlanStream(plan, 'compile')
  assert.equal(compile.compilation?.text, '')
  assert.equal(compile.compilation?.reasoning, '')
  assert.equal(compile.plan, plan.plan)
})
