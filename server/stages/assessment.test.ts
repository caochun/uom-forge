import test from 'node:test'
import assert from 'node:assert/strict'
import { assessModel } from './assessment.ts'
import type { CandidateModel } from '../../shared/model.ts'
import type { Assessment, StageEvent } from '../../shared/analysis.ts'

const basis = '案例 C1：申请 A 的结果必须归属于 A。'
const model: CandidateModel = {
  schemaVersion: '1', name: '申请', summary: '申请结果。',
  objects: [{ id: 'application', name: '申请', description: '申请及所属结果。', properties: [], evidence: [] }],
  relations: [], actions: [], functions: [], rules: [], boundaries: [],
}
const assessment: Assessment = {
  summary: '独立案例可表达。', recommendations: [], clarifications: [],
  caseAssessments: [{ caseId: 'C1', scenario: '申请 A 的结果归属于 A。', basis,
    status: 'supported', elements: ['application'], explanation: '申请对象记录自己的结果。', gap: '', suggestion: '' }],
}

test('final model assessment accepts a standalone case on the first call', async () => {
  let calls = 0
  const result = await assessModel(model, basis, async prompt => {
    calls++
    assert.ok(prompt.includes(JSON.stringify(basis)))
    assert.ok(prompt.includes('application'))
    return JSON.stringify(assessment)
  })
  assert.deepEqual(result.assessment, assessment)
  assert.equal(calls, 1)
})

test('invalid references get one dedicated repair with original inputs, error and previous report', async () => {
  const invalid = structuredClone(assessment)
  invalid.caseAssessments[0].elements = ['invented']
  const previous = JSON.stringify(invalid)
  const events: StageEvent[] = []
  let calls = 0
  const result = await assessModel(model, basis, async prompt => {
    if (++calls === 1) return previous
    assert.match(prompt, /修复上次业务案例检查报告/)
    assert.doesNotMatch(prompt, /表达检查方法：/)
    assert.ok(prompt.includes(JSON.stringify(previous)))
    assert.ok(prompt.includes(JSON.stringify(basis)))
    assert.ok(prompt.includes('application'))
    assert.match(prompt, /业务案例 C1 引用了不存在的模型元素/)
    return JSON.stringify(assessment)
  }, { onEvent: event => events.push(event) })
  assert.equal(calls, 2)
  assert.deepEqual(result.assessment.caseAssessments, assessment.caseAssessments)
  assert.ok(events.some(event => event.type === 'phase' && event.text.includes('正在修复')))
})

test('a second invalid assessment fails without endless retries or false success', async () => {
  let calls = 0
  await assert.rejects(assessModel(model, basis, async () => { calls++; return '{}' }), /评估结构不完整/)
  assert.equal(calls, 2)
})

test('cancellation prevents the repair call', async () => {
  let calls = 0
  const controller = new AbortController()
  await assert.rejects(assessModel(model, basis, async () => {
    calls++
    controller.abort(new Error('cancelled'))
    return '{}'
  }, { signal: controller.signal }), /cancelled/)
  assert.equal(calls, 1)
})
