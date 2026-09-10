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
  activities: [
    {
      id: 'p',
      name: '登记',
      goal: '独立保存事项',
      requirements: [],
      evidence: [],
    },
  ],
  boundaries: [],
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
      reason: '模型能够独立表达事项。',
      requirements: [
        {
          requirement: '独立保存业务事项',
          status: 'supported',
          elements: coveredElements,
          explanation: '对象为每个业务事项提供独立身份，可以保存并重复引用。',
          gap: '',
          suggestion: '',
          evidence,
        },
      ],
      evidence,
    },
  ],
  recommendations: [],
  clarifications: [],
})
test('assessment rejects missing fields and unsupported references instead of inventing defaults', () => {
  for (const invalid of [{}, assessment(['missing']), assessment([])])
    assert.throws(() => parseAssessment(invalid, model))
})
test('model-only assessment rejects fabricated source citations and leaves input intact', () => {
  const input = assessment(
    ['object'],
    [{ blockId: 'b1', quote: '未经提供的文档' }],
  )
  assert.throws(() => parseAssessment(input, model), /评估结构不完整/)
  assert.equal(input.processAssessments[0].evidence.length, 1)
  assert.equal(input.processAssessments[0].requirements[0].evidence.length, 1)
})

test('model-only assessment does not require the provider to repeat empty citation metadata', () => {
  const raw = assessment()
  const { evidence: _processEvidence, ...process } = raw.processAssessments[0]
  const { evidence: _requirementEvidence, ...requirement } =
    process.requirements[0]
  const result = parseAssessment(
    {
      ...raw,
      processAssessments: [{ ...process, requirements: [requirement] }],
    },
    model,
  )
  assert.deepEqual(result.processAssessments[0].evidence, [])
  assert.deepEqual(result.processAssessments[0].requirements[0].evidence, [])
})
