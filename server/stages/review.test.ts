import test from 'node:test'
import assert from 'node:assert/strict'
import { runStage } from './index.ts'
import { parseAnalysisRequest } from '../validation/requests.ts'
import { parseAssessment } from '../validation/assessment.ts'
import type { CandidateModel } from '../../shared/model.ts'

const model: CandidateModel = {
  schemaVersion: '1',
  name: '事项管理',
  summary: '登记事项。',
  objects: [
    {
      id: 'matter',
      name: '事项',
      description: '具有独立身份的事项。',
      properties: [],
      evidence: [{ quote: 'QUOTE_CANARY' }],
    },
  ],
  relations: [],
  actions: [],
  functions: [],
  rules: [],
  activities: [
    {
      id: 'registration',
      name: '登记事项',
      goal: '独立保存事项。',
      evidence: [],
      requirements: [
        {
          description: '每个事项需要独立身份',
          elements: ['matter'],
          status: 'partial',
          reason: '待支撑评估',
          evidence: [],
        },
      ],
    },
  ],
  boundaries: [],
}
const raw = {
  summary: '模型可以表达独立事项。',
  processAssessments: [
    {
      processId: 'registration',
      processName: '登记事项',
      reason: '事项具有独立身份。',
      evidence: [],
      requirements: [
        {
          requirement: '每个事项需要独立身份',
          status: 'supported',
          elements: ['matter'],
          explanation: '事项对象表达了独立的业务事项身份。',
          gap: '',
          suggestion: '',
          evidence: [],
        },
      ],
    },
  ],
  recommendations: [],
  clarifications: [],
}

test('assessment accepts only a candidate model as business input and strips earlier context and quotations', async () => {
  const request = parseAnalysisRequest(
    {
      stage: 'assess',
      model,
      document: 'DOCUMENT_CANARY',
      narrative: 'NARRATIVE_CANARY',
      answers: 'ANSWERS_CANARY',
    },
    'deepseek',
  )
  assert.deepEqual(Object.keys(request).sort(), ['model', 'provider', 'stage'])
  const result = await runStage(request, async (prompt, options) => {
    assert.equal(options.provider, 'deepseek')
    assert.match(prompt, /每个事项需要独立身份/)
    assert.doesNotMatch(
      prompt,
      /DOCUMENT_CANARY|NARRATIVE_CANARY|ANSWERS_CANARY|QUOTE_CANARY|待支撑评估/,
    )
    return JSON.stringify(raw)
  })
  assert.ok('assessment' in result)
  assert.equal(result.assessment.processAssessments[0].status, 'supported')
})

test('self-narration uses only candidate semantics as well', async () => {
  const request = parseAnalysisRequest(
    {
      stage: 'narrate',
      model,
      document: 'DOCUMENT_CANARY',
      narrative: 'NARRATIVE_CANARY',
    },
    'gpt',
  )
  await runStage(request, async (prompt) => {
    assert.match(prompt, /事项管理/)
    assert.doesNotMatch(prompt, /DOCUMENT_CANARY|NARRATIVE_CANARY|QUOTE_CANARY/)
    return '模型表达独立事项。'
  })
})

test('assessment must cover the model requirements without creating other processes or requirements', () => {
  const missing = structuredClone(raw)
  missing.processAssessments[0].requirements[0].requirement =
    '自行补造的流程要求'
  assert.throws(
    () => parseAssessment(missing, model),
    /评估要求与模型声明不一致/,
  )
  const extraProcess = structuredClone(raw)
  extraProcess.processAssessments[0].processId = 'invented'
  assert.throws(() => parseAssessment(extraProcess, model), /不存在的业务过程/)
  const duplicate = structuredClone(raw)
  duplicate.processAssessments[0].requirements.push(
    structuredClone(duplicate.processAssessments[0].requirements[0]),
  )
  assert.throws(
    () => parseAssessment(duplicate, model),
    /评估要求与模型声明不一致/,
  )
  assert.throws(
    () => parseAssessment({ ...raw, processAssessments: [] }, model),
    /没有包含/,
  )
  const noProcesses = { ...model, activities: [] }
  assert.equal(
    parseAssessment({ ...raw, processAssessments: [] }, noProcesses)
      .processAssessments.length,
    0,
  )
})

test('assessment distinguishes model changes from business clarifications grounded in model semantics', () => {
  const scoped = {
    ...model,
    boundaries: ['事项的保存是否覆盖既有记录尚未明确。'],
  }
  const clarification = {
    text: '每次保存新增记录还是覆盖既有记录？',
    basis: scoped.boundaries[0],
    ambiguity: '保留多次保存结果，或只保存最新结果。',
    impact: '前者需要表达多份记录及其归属，后者只更新原记录。',
    options: ['新增', '覆盖'],
    multiple: false,
  }
  const result = parseAssessment(
    { ...raw, clarifications: [clarification] },
    scoped,
  )
  assert.deepEqual(result.clarifications, [clarification])
  assert.throws(
    () =>
      parseAssessment(
        { ...raw, clarifications: [{ ...clarification, impact: '' }] },
        scoped,
      ),
    /结构不完整/,
  )
  assert.throws(
    () =>
      parseAssessment(
        {
          ...raw,
          clarifications: [{ ...clarification, basis: '模型没有说过的话' }],
        },
        scoped,
      ),
    /依据不在本次输入/,
  )
  assert.throws(
    () =>
      parseAssessment(
        { ...raw, clarifications: [clarification, clarification] },
        scoped,
      ),
    /重复/,
  )
})

test('assessment gets one structured retry carrying the readable validation error', async () => {
  const prompts: string[] = []
  const phases: string[] = []
  const request = parseAnalysisRequest({ stage: 'assess', model }, 'deepseek')
  const result = await runStage(
    request,
    async (prompt, options) => {
      assert.equal(options?.outputFormat, 'json')
      prompts.push(prompt)
      if (prompts.length === 1)
        return JSON.stringify({
          ...raw,
          processAssessments: [
            { ...raw.processAssessments[0], conclusion: '多余字段' },
          ],
        })
      return JSON.stringify(raw)
    },
    {
      onEvent: (event) => {
        if (event.type === 'phase') phases.push(event.text)
      },
    },
  )
  assert.equal(prompts.length, 2)
  assert.ok(prompts[1].includes(JSON.stringify(JSON.stringify({
    ...raw,
    processAssessments: [{ ...raw.processAssessments[0], conclusion: '多余字段' }],
  }))))
  assert.match(
    prompts[1],
    /上次评估输出未通过程序校验：.*第 1 个业务过程（登记事项）包含未定义的字段 conclusion/,
  )
  assert.equal(
    phases.includes('评估结果未通过程序校验，正在请求一次结构化重试。'),
    true,
  )
  assert.ok('assessment' in result)
  assert.equal(result.assessment.processAssessments[0].status, 'supported')
})

test('a second invalid assessment stops with the readable error instead of looping', async () => {
  let calls = 0
  const request = parseAnalysisRequest({ stage: 'assess', model }, 'deepseek')
  await assert.rejects(
    runStage(request, async () => {
      calls++
      return JSON.stringify({
        ...raw,
        processAssessments: [
          { ...raw.processAssessments[0], conclusion: '多余字段' },
        ],
      })
    }),
    /评估结构不完整：第 1 个业务过程（登记事项）包含未定义的字段 conclusion/,
  )
  assert.equal(calls, 2)
})
