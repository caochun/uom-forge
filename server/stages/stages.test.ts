import test from 'node:test'
import assert from 'node:assert/strict'
import { buildModel, compileModel } from './modeling.ts'
import { validateCompiledModel } from '../validation/compiled-model.ts'
import { understandingWarnings } from './understanding.ts'
import { extractQuestions } from '../../shared/questions.ts'
import {
  UNDERSTANDING_SECTIONS,
  semanticModelPrompt,
  compileModelPrompt,
  understandingPrompt,
} from './prompts.ts'
import type { CandidateModel } from '../../shared/model.ts'
import type { StageEvent } from '../../shared/analysis.ts'

const semanticPlan =
  '## 模型概述\n跟踪事项与成果。\n## 对象及边界\n事项 req；成果 result。\n## 关系\n事项通过产出关系 produces 指向成果。'
const candidate = (): CandidateModel => ({
  schemaVersion: '1',
  name: '通用业务',
  summary: '事项形成成果。',
  objects: [
    {
      id: 'req',
      name: '事项',
      description: '一次独立事项。',
      properties: [],
      evidence: [],
    },
    {
      id: 'result',
      name: '成果',
      description: '可追溯产出。',
      properties: [],
      evidence: [],
    },
  ],
  relations: [
    {
      id: 'produces',
      name: '形成',
      description: '事项形成成果。',
      from: 'req',
      to: 'result',
      properties: [],
      evidence: [],
    },
  ],
  actions: [
    {
      id: 'record-result',
      name: '登记成果',
      description: '登记形成的成果。',
      targets: ['result'],
      inputs: [],
      preconditions: [],
      effects: ['创建成果'],
      evidence: [],
    },
  ],
  functions: [],
  rules: [
    {
      id: 'trace',
      name: '可追溯',
      description: '成果需追溯事项。',
      elements: ['req', 'result', 'produces'],
      evidence: [],
    },
  ],
  activities: [
    {
      id: 'process',
      name: '办理事项',
      goal: '形成成果',
      evidence: [],
      requirements: [
        {
          description: '登记成果及其来源',
          elements: ['record-result', 'produces'],
          status: 'partial',
          reason: '待支撑评估',
          evidence: [],
        },
      ],
    },
  ],
  boundaries: [],
})

test('semantic turn and compiler have isolated inputs; stream and result preserve the plan', async () => {
  const events: StageEvent[] = []
  const prompts: string[] = []
  const result = await buildModel(
    {
      narrative: 'NARRATIVE_ONLY',
      feedback: 'FEEDBACK_ONLY',
      currentModel: {
        ...candidate(),
        document: { text: 'DOCUMENT_CANARY' },
        source: 'SOURCE_CANARY',
        objects: [
          {
            ...candidate().objects[0],
            evidence: [{ blockId: 'b', quote: 'QUOTE_CANARY' }],
            source: 'SOURCE_CANARY',
          },
        ],
        relations: [
          {
            ...candidate().relations[0],
            fromId: 'req',
            toId: 'result',
            from: '事项',
            to: '成果',
          },
        ],
      },
    },
    async (prompt, options) => {
      prompts.push(prompt)
      assert.equal(options.provider, 'gpt')
      assert.doesNotMatch(prompt, /DOCUMENT_CANARY|SOURCE_CANARY|QUOTE_CANARY/)
      if (prompts.length === 1) {
        assert.match(prompt, /NARRATIVE_ONLY/)
        assert.match(prompt, /FEEDBACK_ONLY/)
        assert.doesNotMatch(prompt, /additionalProperties|schemaVersion/)
        assert.match(prompt, /"from":"req","to":"result"/)
        options.onEvent?.({ type: 'delta', text: semanticPlan })
        return semanticPlan
      }
      if (prompts.length === 3) {
        assert.match(prompt, /NARRATIVE_ONLY/)
        assert.doesNotMatch(prompt, /FEEDBACK_ONLY|跟踪事项与成果/)
        return JSON.stringify({
          summary: '可表达。',
          cases: [
            {
              id: 'c1',
              fact: '事项形成成果',
              basisIds: ['U1'],
              scenario: '事项 A 形成成果 B',
              status: 'expressed',
              elements: ['produces'],
              explanation: '形成关系明确归属。',
              gap: '',
              suggestion: '',
            },
          ],
          clarifications: [],
        })
      }
      assert.ok(
        events.some(
          (event) =>
            event.type === 'model-plan' && event.semanticPlan === semanticPlan,
        ),
      )
      assert.doesNotMatch(prompt, /NARRATIVE_ONLY|FEEDBACK_ONLY/)
      assert.ok(prompt.includes(JSON.stringify(semanticPlan)))
      options.onEvent?.({ type: 'delta', text: JSON.stringify(candidate()) })
      return JSON.stringify(candidate())
    },
    { provider: 'gpt', onEvent: (event) => events.push(event) },
  )
  assert.equal(prompts.length, 3)
  assert.equal(result.expressionReview.status, 'passed')
  assert.equal(result.semanticPlan, semanticPlan)
  assert.deepEqual(result.model, candidate())
  assert.deepEqual(result.provenance, {
    basis: 'business-understanding',
    evidence: 'unlinked',
  })
  assert.deepEqual(
    events.filter((event) => event.type === 'delta').map((event) => event.part),
    ['semantic', 'compile'],
  )
})

test('missing narrative stops before invoking a provider', async () => {
  let calls = 0
  for (const narrative of ['', '  ', undefined, {}]) {
    await assert.rejects(
      buildModel({ narrative: narrative as string }, async () => {
        calls++
        return ''
      }),
      /业务说明/,
    )
  }
  assert.equal(calls, 0)
})

test('standalone compilation retries only B using the exact saved semantic plan', async () => {
  let calls = 0
  const result = await compileModel(
    semanticPlan,
    'NARRATIVE_ONLY',
    async (prompt) => {
      calls++
      if (calls === 2) {
        assert.match(prompt, /NARRATIVE_ONLY/)
        return JSON.stringify({
          summary: '可表达',
          cases: [
            {
              id: 'c1',
              fact: '成果归属事项',
              basisIds: ['U1'],
              scenario: '甲事项形成乙成果',
              status: 'expressed',
              elements: ['produces'],
              explanation: '关系区分归属。',
              gap: '',
              suggestion: '',
            },
          ],
          clarifications: [],
        })
      }
      assert.equal(prompt, compileModelPrompt(semanticPlan))
      assert.doesNotMatch(
        prompt,
        /additionalProperties|NARRATIVE_ONLY|FEEDBACK_ONLY/,
      )
      return JSON.stringify(candidate())
    },
  )
  assert.equal(calls, 2)
  assert.equal(result.expressionReview.status, 'passed')
  assert.equal(result.semanticPlan, semanticPlan)
  for (const plan of ['', undefined, ' '])
    await assert.rejects(
      compileModel(plan as string, 'NARRATIVE_ONLY', async () => {
        throw new Error('must not run')
      }),
      /请先完成建模说明/,
    )
})

test('cancellation between steps prevents compilation and retains the published plan', async () => {
  const controller = new AbortController()
  let calls = 0
  let saved = ''
  await assert.rejects(
    buildModel(
      { narrative: '业务说明' },
      async () => {
        calls++
        return semanticPlan
      },
      {
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === 'model-plan') {
            saved = event.semanticPlan || ''
            controller.abort()
          }
        },
      },
    ),
    { name: 'AbortError' },
  )
  assert.equal(calls, 1)
  assert.equal(saved, semanticPlan)
})

test('compiler failure or cancellation preserves plan without publishing a model', async () => {
  for (const cancel of [false, true]) {
    const controller = new AbortController()
    const events: StageEvent[] = []
    let calls = 0
    await assert.rejects(
      buildModel(
        { narrative: '业务说明' },
        async () => {
          if (++calls === 1) return semanticPlan
          if (cancel) controller.abort()
          return 'not JSON'
        },
        { signal: controller.signal, onEvent: (event) => events.push(event) },
      ),
      cancel ? { name: 'AbortError' } : /模型整理失败，建模说明已保留/,
    )
    assert.equal(calls, 2)
    assert.equal(
      events.find((event) => event.type === 'model-plan')?.semanticPlan,
      semanticPlan,
    )
  }
})

test('compiled output rejects missing fields, dangling references and invented evidence instead of repairing them', () => {
  const variants = [
    (model: CandidateModel) => {
      model.relations[0].to = 'missing'
    },
    (model: CandidateModel) => {
      model.actions[0].targets = ['missing']
    },
    (model: CandidateModel) => {
      model.rules[0].elements = ['missing']
    },
    (model: CandidateModel) => {
      model.activities[0].requirements[0].elements = ['missing']
    },
    (model: CandidateModel) => {
      model.objects[0].evidence = [{ blockId: 'pretend', quote: 'invented' }]
    },
    (model: CandidateModel) => {
      model.activities[0].requirements[0].status = 'covered'
    },
    (model: CandidateModel) => {
      model.objects[0].properties = [
        {
          name: 'field',
          type: 'string',
          description: 'unrequested detail',
          evidence: [],
        },
      ]
    },
  ]
  for (const mutate of variants) {
    const model = candidate()
    mutate(model)
    assert.throws(() => validateCompiledModel(JSON.stringify(model)))
  }
  assert.throws(() => validateCompiledModel('{}'))
})

test('reading handoff reports missing sections without rewriting the explanation', () => {
  const narrative = UNDERSTANDING_SECTIONS.map(
    ({ title }) => `## ${title}\n材料未说明。`,
  ).join('\n\n')
  assert.deepEqual(understandingWarnings(narrative), [])
  assert.equal(understandingWarnings('## 业务概述\n业务概述。').length, 8)
  const prompt = understandingPrompt({
    name: 'doc',
    blocks: [{ id: '1', text: 'DOCUMENT' }],
  })
  for (const { title } of UNDERSTANDING_SECTIONS)
    assert.ok(prompt.includes(`## ${title}`))
  assert.match(prompt, /类型或业务分支/)
})

test('confirmation choices preserve commas and distinguish multiple selection from text', () => {
  const questions = extractQuestions(
    '## 待确认问题\n1. 如何处理？\\\n  选项：满足条件，继续办理；退回\n2. 需要哪些信息？\n  多选：编号；地址\n3. 具体公式是什么？\n## 其他\n1. 不是问题',
  )
  assert.deepEqual(questions, [
    { text: '如何处理？', options: ['满足条件，继续办理', '退回'] },
    { text: '需要哪些信息？', options: ['编号', '地址'], multiple: true },
    { text: '具体公式是什么？', options: [] },
  ])
})

test('prompts contain no sample domain vocabulary or source evidence requirement in semantic step', () => {
  const semantic = semanticModelPrompt({ narrative: '测试输入' })
  assert.doesNotMatch(semantic, /供电|馈线|主变|融资租赁|高速|blockId/)
  assert.doesNotMatch(compileModelPrompt('PLAN'), /DOCUMENT/)
})
