import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAssessment } from './assessment.ts'
import type { CandidateModel } from '../../shared/model.ts'
import type { Assessment, CaseAssessment } from '../../shared/analysis.ts'

const basis = '每次申请单独记录审核结果。审核通过才能办理。是否允许撤回尚未确定。'
const model: CandidateModel = {
  schemaVersion: '1', name: '申请模型', summary: '申请及审核结果。',
  objects: [{ id: 'application', name: '申请', description: '每次申请及其审核结果。', properties: [], evidence: [] }],
  relations: [], actions: [], functions: [], rules: [], boundaries: [],
}
const row = (change: Partial<CaseAssessment> = {}): CaseAssessment => ({
  caseId: 'C1', scenario: '申请 A 的审核结果归属于 A。', basis: '每次申请单独记录审核结果。',
  status: 'supported', elements: ['application'], explanation: '申请对象分别记录各自审核结果。',
  gap: '', suggestion: '', ...change,
})
const report = (rows = [row()]): Assessment => ({ summary: '本轮业务案例检查。', caseAssessments: rows, recommendations: [], clarifications: [] })
const parse = (value: unknown) => parseAssessment(value, model, basis)

test('standalone expression, inference and contrast cases need no process or requirement hierarchy', () => {
  const value = report([
    row(),
    row({ caseId: 'C2', scenario: '未审核的申请不能办理。', basis: '审核通过才能办理。',
      status: 'partial', gap: '缺少办理前提。', suggestion: '为办理操作补充审核前提。' }),
    row({ caseId: 'C3', scenario: '申请 A 与 B 的审核结果互换时，模型应能区分。' }),
  ])
  assert.deepEqual(parse(value), value)
})

test('unresolved business is not misreported as a model failure or forced to cite an element', () => {
  const value = report([row({ caseId: 'C4', scenario: '申请 A 是否可撤回待确认。', basis: '是否允许撤回尚未确定。',
    status: 'clarify', elements: [], explanation: '撤回条件未确定，无法判断模型是否足够。',
    gap: '撤回边界未决。', suggestion: '回到业务理解确认，不擅自增加撤回操作。' })])
  assert.equal(parse(value).caseAssessments[0].status, 'clarify')
  assert.deepEqual(parse(value).clarifications, [])
})

test('duplicate case identifiers and duplicate scenario text are rejected', () => {
  assert.throws(() => parse(report([row(), row({ scenario: '另一案例' })])), /业务案例编号或内容重复/)
  assert.throws(() => parse(report([row(), row({ caseId: 'C2' })])), /业务案例编号或内容重复/)
})

test('contrast cases retain meaningful differences in operators and numeric conditions', () => {
  const numericBasis = '负载率 ≥ 80% 与负载率 < 80% 的安排必须区分。'
  const value = report([
    row({ caseId: 'C1', scenario: '负载率 ≥ 80%。', basis: numericBasis }),
    row({ caseId: 'C2', scenario: '负载率 < 80%。', basis: numericBasis }),
  ])
  assert.equal(parseAssessment(value, model, numericBasis).caseAssessments.length, 2)
})

test('model references and excerpts must come from the supplied inputs', () => {
  assert.throws(() => parse(report([row({ elements: ['invented'] })])), /不存在的模型元素/)
  assert.throws(() => parse(report([row({ basis: '必须永久保存所有结果。' })])), /依据不在本次建模依据/)
  assert.throws(() => parse(report([row({ elements: [] })])), /没有引用模型元素/)
  assert.throws(() => parse(report([row({ status: 'partial', elements: [], gap: '缺口', suggestion: '建议' })])), /没有引用模型元素/)
})

test('case conclusions must agree with gaps and suggestions', () => {
  assert.throws(() => parse(report([row({ gap: '还缺少规则' })])), /可表达，却仍有缺口/)
  assert.throws(() => parse(report([row({ status: 'missing', elements: [] })])), /缺少具体缺口或未决边界/)
  assert.throws(() => parse(report([row({ status: 'clarify', elements: [] })])), /缺少具体缺口或未决边界/)
  assert.equal(parse(report([row({ status: 'missing', elements: [], gap: '未表达申请。', suggestion: '补充申请概念。' })])).caseAssessments[0].status, 'missing')
})

test('new clarifications cite the modeling basis and retain that provenance', () => {
  const value = report()
  value.clarifications = [{ text: '是否允许撤回？', basis: '是否允许撤回尚未确定。',
    ambiguity: '允许撤回或不允许撤回。', impact: '决定是否需要撤回操作。', options: ['允许', '不允许'], multiple: false }]
  assert.equal(parse(value).clarifications[0].basisSource, 'business-basis')
  value.clarifications[0].basis = '申请及审核结果。'
  assert.throws(() => parse(value), /依据不在本次输入/)
})

test('structural repair errors identify the case and field', () => {
  const value = report()
  const { scenario: _scenario, ...invalidRow } = value.caseAssessments[0]
  assert.throws(() => parse({ ...value, caseAssessments: [invalidRow] }), /第 1 个业务案例（C1）缺少必需字段 scenario/)
  assert.throws(() => parse({ ...value, processAssessments: [] }), /未定义的字段 processAssessments/)
})

test('an explicit report with no assessable cases is allowed', () => {
  assert.deepEqual(parse(report([])).caseAssessments, [])
})
