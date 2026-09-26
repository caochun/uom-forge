import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAssessment } from './assessment.ts'
import type { CandidateModel } from '../../shared/model.ts'

const modelWithoutRequirements = (): CandidateModel => ({
  schemaVersion: '1',
  name: '测试模型',
  summary: '只有笼统目标的业务计划。',
  objects: [],
  relations: [],
  actions: [],
  functions: [],
  rules: [],
  boundaries: [],
})

test('assessment accepts an external business plan without declared requirements and marks it partial', () => {
  const parsed = parseAssessment({
    summary: '目标过于笼统，暂不能逐项核验。',
    processAssessments: [{
      processId: 'review',
      processName: '审核',
      reason: '只有笼统目标，模型尚未声明可逐项检验的业务要求。',
      requirements: [],
    }],
    recommendations: [],
    clarifications: [],
  }, modelWithoutRequirements())

  assert.equal(parsed.processAssessments[0].status, 'partial')
  assert.deepEqual(parsed.processAssessments[0].requirements, [])
})

test('assessment rejects duplicate requirements for an external business plan', () => {
  assert.throws(() => parseAssessment({
    summary: '评估。',
    processAssessments: [{
      processId: 'review',
      processName: '审核',
      reason: '评估。',
      requirements: [{
        requirement: '同一要求',
        status: 'missing',
        elements: [],
        explanation: '模型没有支撑。',
        gap: '模型未声明该要求。',
        suggestion: '补充业务要求。',
      }, {
        requirement: '同一要求',
        status: 'missing',
        elements: [],
        explanation: '模型没有支撑。',
        gap: '模型未声明该要求。',
        suggestion: '补充业务要求。',
      }],
    }],
    recommendations: [],
    clarifications: [],
  }, modelWithoutRequirements()), /评估要求重复/)
})
