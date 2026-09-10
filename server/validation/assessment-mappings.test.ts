import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAssessment } from './assessment.ts'
import { assessmentPrompt } from '../stages/assessment.ts'
import type { CandidateModel } from '../../shared/model.ts'
import type {
  Assessment,
  ProcessAssessment,
  RequirementAssessment,
} from '../../shared/analysis.ts'

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
    { id: 'p', name: '登记', goal: '保存事项', requirements: [], evidence: [] },
  ],
  boundaries: [],
}
const requirement = (
  overrides: Partial<RequirementAssessment> = {},
): RequirementAssessment => ({
  requirement: '独立保存业务事项',
  status: 'supported',
  elements: ['object'],
  explanation: '对象为每个业务事项提供独立身份，可以保存并重复引用。',
  gap: '',
  suggestion: '',
  evidence: [],
  ...overrides,
})
const assessment = (
  requirements = [requirement()],
): Omit<Assessment, 'processAssessments'> & {
  processAssessments: Omit<ProcessAssessment, 'status'>[]
} => ({
  summary: '评估说明',
  processAssessments: [
    {
      processId: 'p',
      processName: '登记',
      reason: '模型能够独立表达事项。',
      requirements,
      evidence: [],
    },
  ],
  recommendations: [],
  clarifications: [],
})

test('assessment requires actual requirement mappings, explanations and model references', () => {
  const old = {
    ...assessment(),
    processAssessments: [
      {
        processId: 'p',
        processName: '登记',
        status: 'supported',
        coveredElements: ['object'],
        gaps: [],
        evidence: [],
      },
    ],
  }
  for (const invalid of [
    old,
    assessment([]),
    assessment([requirement({ explanation: ' ' })]),
    assessment([requirement({ requirement: '' })]),
    assessment([requirement({ elements: ['p'] })]),
    assessment([requirement({ elements: ['object', 'object'] })]),
  ])
    assert.throws(() => parseAssessment(invalid, model))
})

test('partial and missing requirements must explain the gap and suggest a change', () => {
  const input = assessment([
    requirement({
      status: 'partial',
      gap: '未表达办理主体',
      suggestion: '明确主体与事项之间的关系',
    }),
  ])
  assert.doesNotThrow(() => parseAssessment(input, model))
  for (const field of ['gap', 'suggestion'] as const) {
    const invalid = structuredClone(input)
    invalid.processAssessments[0].requirements[0][field] = ' '
    assert.throws(
      () => parseAssessment(invalid, model),
      /缺少具体缺口或改进建议/,
    )
  }
  const missing = assessment([
    requirement({
      status: 'missing',
      elements: [],
      gap: '没有表达此业务要求',
      suggestion: '确认其业务边界后补充模型',
    }),
  ])
  assert.doesNotThrow(() => parseAssessment(missing, model))
  const supportedWithGap = assessment([requirement({ gap: '未表达主体' })])
  assert.throws(
    () => parseAssessment(supportedWithGap, model),
    /可支撑，却仍有缺口/,
  )
})

test('process statuses are derived from requirements and include every model activity', () => {
  const mixed = assessment([
    requirement(),
    requirement({
      requirement: '记录办理主体',
      status: 'missing',
      elements: [],
      gap: '缺少主体',
      suggestion: '补充主体及其办理关系',
    }),
  ])
  assert.equal(
    parseAssessment(mixed, model).processAssessments[0].status,
    'partial',
  )
  assert.equal(
    parseAssessment(assessment(), model).processAssessments[0].status,
    'supported',
  )
  const missing = assessment([
    requirement({
      status: 'missing',
      elements: [],
      gap: '未表达版本',
      suggestion: '确认版本边界',
    }),
  ])
  assert.equal(
    parseAssessment(missing, model).processAssessments[0].status,
    'missing',
  )
  const omitted = assessment()
  omitted.processAssessments[0].processId = 'other'
  assert.throws(() => parseAssessment(omitted, model), /不存在的业务过程/)
  const duplicated = assessment()
  duplicated.processAssessments.push(duplicated.processAssessments[0])
  assert.throws(() => parseAssessment(duplicated, model), /无效或重复/)
  assert.throws(
    () => parseAssessment({ ...assessment(), processAssessments: [] }, model),
    /没有包含/,
  )
})

test('assessment prompt asks for requirements and local improvements without equating code with semantics', () => {
  const prompt = assessmentPrompt(model)
  assert.match(prompt, /唯一业务输入是下面的候选模型/)
  assert.match(prompt, /explanation/)
  assert.match(prompt, /不要将未细化属性、未实现接口或算法误判为本体缺口/)
  assert.match(prompt, /不修改或新增模型元素/)
  assert.match(prompt, /跨过程的共性建议/)
  assert.doesNotMatch(prompt, /coveredElements/)
})
