import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAssessment } from './assessment.ts'
import type { CandidateModel, Evidence } from '../../shared/model.ts'

const model: CandidateModel = {
  schemaVersion: '1',
  name: '模型',
  summary: '说明',
  objects: [
    {
      id: 'object',
      name: '对象',
      description: '独立对象',
      properties: [],
      evidence: [],
    },
  ],
  relations: [],
  actions: [],
  functions: [],
  rules: [],
  activities: [],
  questions: [],
}
const document = {
  name: 'document',
  blocks: [{ id: 'b1', text: '主体登记事项' }],
}
const assessment = (
  coveredElements = ['object'],
  evidence: Evidence[] = [],
) => ({
  summary: '评估说明',
  processAssessments: [
    {
      processId: 'p',
      processName: '登记',
      status: 'supported',
      coveredElements,
      gaps: [],
      evidence,
    },
  ],
  recommendations: [],
  questions: [],
})
test('assessment rejects missing fields and unsupported references instead of inventing defaults', () => {
  for (const invalid of [{}, assessment(['missing']), assessment([])])
    assert.throws(() => parseAssessment(invalid, model, document))
})
test('assessment grounds citations without changing the input', () => {
  const input = assessment(
    ['object'],
    [
      { blockId: 'wrong', quote: '登记事项' },
      { blockId: 'b1', quote: '自行推断' },
    ],
  )
  const result = parseAssessment(input, model, document)
  assert.deepEqual(result.processAssessments[0].evidence, [
    { blockId: 'b1', quote: '登记事项' },
  ])
  assert.equal(input.processAssessments[0].evidence.length, 2)
})
