import test from 'node:test'
import assert from 'node:assert/strict'
import {
  beginBasisRepair,
  beginDesignCheck,
  beginDesignRound,
  createModelingSession,
  finishModeling,
  recordReview,
  replaceBusinessBasis,
  setAcceptance,
} from './session.ts'
import type { DesignAcceptance } from '../../shared/design-acceptance.ts'
import { artifactVersion } from '../../shared/workflow.ts'

const input = { narrative: '客户可以提交申请。' }
const basis = '申请是业务对象。'
const acceptance: DesignAcceptance = {
  scope: '申请处理',
  scenario: '客户提交申请。',
  outcome: '申请被记录。',
  questions: [{
    id: 'Q1', question: '申请是否被记录？', kind: 'result', grounding: 'explicit',
    sourceQuote: '客户可以提交申请。', reason: '原文明确提交行为。', expected: '模型表达申请及提交结果。',
  }],
}

test('modeling session keeps artifact versions while changing workflow state', () => {
  let session = createModelingSession(input, basis)
  assert.equal(session.review.status, 'preparing-checks')
  assert.equal(session.review.round, 0)
  assert.equal(session.review.businessBasisVersion, artifactVersion(basis))

  session = setAcceptance(session, acceptance)
  assert.equal(session.review.acceptanceVersion, artifactVersion(acceptance))
  session = beginDesignRound(session)
  assert.equal(session.review.status, 'drafting')
  assert.equal(session.review.round, 1)
  session = beginDesignCheck(session)
  assert.equal(session.review.status, 'checking')
  assert.equal(session.review.feedbackDraft, '')
})

test('recording a checkpoint snapshots the basis used by that review', () => {
  let session = createModelingSession(input, basis)
  session = setAcceptance(session, acceptance)
  session = beginDesignCheck(beginDesignRound(session))
  session = recordReview(session, {
    design: '申请对象。', feedback: '缺少提交结果。', verdict: 'revise', businessBasis: basis,
    acceptanceVersion: session.review.acceptanceVersion,
  })
  assert.equal(session.review.rounds.length, 1)
  assert.equal(session.review.rounds[0].businessBasis, basis)
  assert.equal(session.review.rounds[0].businessBasisVersion, artifactVersion(basis))
  assert.equal(session.review.feedbackDraft, undefined)
})

test('basis repair replaces only the current basis and preserves review history', () => {
  let session = createModelingSession(input, basis)
  session = beginBasisRepair(session)
  const revisedBasis = '申请是业务对象，提交后产生记录。'
  session = replaceBusinessBasis(session, revisedBasis)
  assert.equal(session.review.status, 'repairing-basis')
  assert.equal(session.businessBasis, revisedBasis)
  assert.equal(session.review.businessBasisVersion, artifactVersion(revisedBasis))
})

test('finishing with sufficient is completed and every other reason needs attention', () => {
  const completed = finishModeling(createModelingSession(input, basis), 'sufficient')
  assert.equal(completed.review.status, 'completed')
  const attention = finishModeling(createModelingSession(input, basis), 'limit')
  assert.equal(attention.review.status, 'attention')
  assert.equal(attention.review.reason, 'limit')
})
