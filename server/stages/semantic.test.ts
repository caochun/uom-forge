import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSemanticPlan,
  extractFacts,
  mapFactsToElements,
  organizeStories,
} from './semantic.ts'
import { validateSemanticPlan } from '../validation/semantic.ts'
import { parseAnalysisRequest } from '../validation/requests.ts'
import type { StageEvent } from '../../shared/analysis.ts'
import type { SemanticPlanV2 } from '../../shared/semantic.ts'
import type { CandidateModel } from '../../shared/model.ts'

const candidate: CandidateModel = {
  schemaVersion: '1', name: '订单', summary: '客户提交订单。',
  objects: [{ id: 'order', name: '订单', description: '提交的订单。', properties: [], evidence: [] }],
  relations: [],
  actions: [{ id: 'submit-order', name: '提交订单', description: '客户提交订单。', targets: ['order'], inputs: [], preconditions: [], effects: ['订单已提交'], evidence: [] }],
  functions: [], rules: [], activities: [], boundaries: [],
}

const fact = () => ({
  id: 'fact-1',
  statement: '客户提交订单',
  kind: 'event' as const,
  actors: ['客户'],
  objects: ['订单'],
  conditions: [],
  result: '订单已提交',
  source: '客户提交订单',
  certainty: 'explicit' as const,
})
const story = () => ({
  id: 'story-1',
  name: '下单',
  goal: '提交订单',
  factIds: ['fact-1'],
  steps: [
    {
      order: 1,
      actor: '客户',
      action: '提交',
      object: '订单',
      result: '订单已提交',
      factIds: ['fact-1'],
    },
  ],
})
const mapping = () => ({
  factId: 'fact-1',
  elementIds: ['submit-order'],
  mappingType: 'action' as const,
  explanation: '提交动作创建订单',
  coverage: 'full' as const,
})

test('semantic handoff extracts, organizes and maps only known facts', async () => {
  let call = 0
  const events: StageEvent[] = []
  const runTurn = async () => {
    call += 1
    if (call === 1) return JSON.stringify({ facts: [fact()] })
    if (call === 2) return JSON.stringify({ stories: [story()] })
    return JSON.stringify({ mappings: [mapping()] })
  }
  const result = await buildSemanticPlan('客户提交订单。', candidate, runTurn, {
    onEvent: (event) => events.push(event),
  })
  assert.deepEqual(result.facts, [fact()])
  assert.equal(result.stories[0].steps[0].factIds[0], 'fact-1')
  assert.equal(result.mappings[0].coverage, 'full')
  assert.deepEqual(events.find((event) => event.type === 'semantic-plan'), {
    type: 'semantic-plan',
    part: 'semantic',
    semantic: result,
  })
  assert.equal(events.some((event) => event.type === 'delta'), false)
})

test('explicit fact citations must exist in the narrative', async () => {
  await assert.rejects(
    buildSemanticPlan(
      '客户提交订单。',
      candidate,
      async () =>
        JSON.stringify({
          facts: [
            {
              ...fact(),
              statement: '客户付款',
              source: '客户付款',
            },
          ],
        }),
    ),
    /source 不存在/,
  )
})

test('fact extraction resolves stable source ids to exact narrative text', async () => {
  let call = 0
  const events: StageEvent[] = []
  const result = await buildSemanticPlan(
    '## 业务事实\n\n- 客户提交订单。',
    candidate,
    async () => {
      call += 1
      if (call === 1)
        return JSON.stringify({
          facts: [
            {
              ...fact(),
              source: undefined,
              sourceIds: ['S0002'],
            },
          ],
          clarifications: [],
        })
      if (call === 2) return JSON.stringify({ stories: [story()] })
      return JSON.stringify({ mappings: [mapping()] })
    },
    { onEvent: (event) => events.push(event) },
  )
  assert.equal(result.facts[0].source, '客户提交订单。')
  assert.equal(result.status, 'mapped')
  assert.equal(
    events.some(
      (event) =>
        event.type === 'semantic-plan' &&
        event.semantic.status === 'mapped' &&
        event.semantic.facts[0].source === '客户提交订单。',
    ),
    true,
  )
})

test('fact ambiguities become grounded clarifications without stopping preparation', async () => {
  let call = 0
  const result = await buildSemanticPlan(
    '订单提交后是否需要人工审核尚未说明。',
    candidate,
    async () => {
      call += 1
      if (call === 1)
        return JSON.stringify({
          facts: [
            {
              ...fact(),
              statement: '订单提交后可能需要人工审核',
              source: undefined,
              sourceIds: ['S0001'],
              certainty: 'uncertain',
            },
          ],
          clarifications: [
            {
              text: '订单提交后是否需要人工审核？',
              sourceIds: ['S0001'],
              ambiguity: '可能需要审核，也可能直接进入后续环节。',
              impact: '决定是否增加审核操作和状态。',
              options: ['需要', '不需要'],
              multiple: false,
            },
          ],
        })
      if (call === 2) return JSON.stringify({ stories: [story()] })
      return JSON.stringify({ mappings: [mapping()] })
    },
  )
  assert.equal(result.clarifications[0].text, '订单提交后是否需要人工审核？')
  assert.equal(result.clarifications[0].basis, '订单提交后是否需要人工审核尚未说明。')
  assert.equal(result.facts[0].certainty, 'uncertain')
})

test('fact extraction repairs duplicate ids and empty string fields deterministically', async () => {
  const facts = await extractFacts(
    '客户提交订单。\n审核员审核订单。',
    async () => JSON.stringify({
      facts: [
        {
          ...fact(),
          id: 'F0001',
          source: '客户提交订单。',
          actors: [' 客户 ', '', '客户'],
          result: ' ',
        },
        {
          ...fact(),
          id: 'F0001',
          statement: '审核员审核订单',
          source: '审核员审核订单。',
          actors: ['审核员'],
        },
      ],
    }),
  )
  assert.deepEqual(facts.map((item) => item.id), ['F0001', 'F0002'])
  assert.deepEqual(facts[0].actors, ['客户'])
  assert.equal(facts[0].result, undefined)
})

test('step facts are automatically included in the owning story', async () => {
  let call = 0
  const result = await buildSemanticPlan(
    '客户提交订单。',
    candidate,
    async () => {
      call += 1
      if (call === 1) return JSON.stringify({ facts: [fact()] })
      if (call === 2)
        return JSON.stringify({
          stories: [{ ...story(), factIds: [] }],
        })
      return JSON.stringify({ mappings: [mapping()] })
    },
  )
  assert.deepEqual(result.stories[0].factIds, ['fact-1'])
  assert.equal(call, 3)
})

test('invalid story structures get one retry while unknown facts still fail', async () => {
  let call = 0
  const phases: string[] = []
  const result = await buildSemanticPlan(
    '客户提交订单。',
    candidate,
    async () => {
      call += 1
      if (call === 1) return JSON.stringify({ facts: [fact()] })
      if (call === 2)
        return JSON.stringify({
          stories: [{
            ...story(),
            steps: [{ ...story().steps[0], actor: '' }],
          }],
        })
      if (call === 3) return JSON.stringify({ stories: [story()] })
      return JSON.stringify({ mappings: [mapping()] })
    },
    {
      onEvent: (event) => {
        if (event.type === 'phase') phases.push(event.text)
      },
    },
  )
  assert.equal(result.stories[0].name, '下单')
  assert.equal(call, 4)
  assert.equal(phases.includes('业务故事结构未通过校验，正在修正后重试。'), true)
})

test('globally numbered story steps are renumbered instead of rejected', async () => {
  const secondFact = { ...fact(), id: 'fact-2', statement: '仓库发货', source: '仓库发货' }
  let call = 0
  const result = await buildSemanticPlan(
    '客户提交订单。\n仓库发货。',
    candidate,
    async () => {
      call += 1
      if (call === 1) return JSON.stringify({ facts: [fact(), secondFact] })
      if (call === 2)
        return JSON.stringify({
          stories: [
            story(),
            {
              id: 'story-2',
              name: '发货',
              goal: '完成发货',
              factIds: ['fact-2'],
              // Numbered as a continuation of story-1 — a common model output.
              steps: [
                { order: 3, actor: '仓库', action: '发货', object: '订单', factIds: ['fact-2'] },
                { order: 2, actor: '仓库', action: '备货', object: '订单', factIds: ['fact-2'] },
              ],
            },
          ],
        })
      return JSON.stringify({
        mappings: [mapping(), { ...mapping(), factId: 'fact-2' }],
      })
    },
  )
  assert.equal(call, 3)
  assert.deepEqual(
    result.stories[1].steps.map((step) => [step.order, step.action]),
    [[1, '备货'], [2, '发货']],
  )
})

test('duplicate step orders are ambiguous and per-step errors name the missing field', async () => {
  const stubFacts = async () => JSON.stringify({ facts: [fact()] })
  await assert.rejects(
    buildSemanticPlan('客户提交订单。', candidate, async (prompt) =>
      prompt.includes('业务事实提取器')
        ? stubFacts()
        : JSON.stringify({
            stories: [{
              ...story(),
              steps: [
                { ...story().steps[0], order: 1 },
                { ...story().steps[0], order: 1, action: '复核' },
              ],
            }],
          }),
    ),
    /story-1 的步骤 order 有重复/,
  )
  await assert.rejects(
    buildSemanticPlan('客户提交订单。', candidate, async (prompt) =>
      prompt.includes('业务事实提取器')
        ? stubFacts()
        : JSON.stringify({
            stories: [{
              ...story(),
              steps: [{ ...story().steps[0], actor: '', factIds: [] }],
            }],
          }),
    ),
    /story-1 第 1 步（提交）缺少 actor、factIds/,
  )
})

test('empty or invalid step orders cannot be coerced into a business sequence', async () => {
  for (const order of [null, '', ' ', false, 0, -1, 1.5]) {
    let calls = 0
    await assert.rejects(organizeStories([fact()], async () => {
      calls++
      return JSON.stringify({ stories: [{ ...story(), steps: [{ ...story().steps[0], order }] }] })
    }), /第 1 步的 order 必须是正整数/)
    assert.equal(calls, 2)
  }
})

test('optional step fields and duplicate references normalize without losing facts', async () => {
  const stories = await organizeStories([fact()], async () => JSON.stringify({
    stories: [{ ...story(), steps: [{ ...story().steps[0], condition: ' ', result: '', factIds: ['fact-1', '', ' fact-1 '] }] }],
  }))
  assert.equal(stories[0].steps[0].condition, undefined)
  assert.equal(stories[0].steps[0].result, undefined)
  assert.deepEqual(stories[0].steps[0].factIds, ['fact-1'])
})

test('aggregate story and fact coverage errors are retried before publication', async () => {
  let storyCalls = 0
  await organizeStories([fact()], async (prompt) => {
    if (++storyCalls === 1) return JSON.stringify({ stories: [story(), story()] })
    assert.match(prompt, /业务故事不完整或重复/)
    return JSON.stringify({ stories: [story()] })
  })
  assert.equal(storyCalls, 2)
  let mappingCalls = 0
  const mappings = await mapFactsToElements([fact()], [story()], candidate, async (prompt) => {
    if (++mappingCalls === 1) return JSON.stringify({ mappings: [] })
    assert.match(prompt, /事实 fact-1 缺少映射结论/)
    return JSON.stringify({ mappings: [mapping()] })
  })
  assert.equal(mappingCalls, 2)
  assert.equal(mappings.length, 1)
})

test('invalid fact source ids get one structured retry before stopping the stage', async () => {
  let call = 0
  const phases: string[] = []
  const result = await buildSemanticPlan(
    '客户提交订单。',
    candidate,
    async () => {
      call += 1
      if (call === 1)
        return JSON.stringify({
          facts: [{ ...fact(), source: undefined, sourceIds: ['S9999'] }],
          clarifications: [],
        })
      if (call === 2)
        return JSON.stringify({
          facts: [{ ...fact(), source: undefined, sourceIds: ['S0001'] }],
          clarifications: [],
        })
      if (call === 3) return JSON.stringify({ stories: [story()] })
      return JSON.stringify({ mappings: [mapping()] })
    },
    {
      onEvent: (event) => {
        if (event.type === 'phase') phases.push(event.text)
      },
    },
  )
  assert.equal(call, 4)
  assert.equal(result.facts[0].source, '客户提交订单。')
  assert.equal(phases.includes('业务事实结构或引用未通过校验，正在修正后重试。'), true)
})

test('stories and mappings cannot reference unknown facts', async () => {
  let call = 0
  await assert.rejects(
    buildSemanticPlan('客户提交订单。', candidate, async () => {
      call += 1
      if (call === 1) return JSON.stringify({ facts: [fact()] })
      return JSON.stringify({ stories: [{ ...story(), factIds: ['fact-ghost'] }] })
    }),
    /未知事实 fact-ghost/,
  )

  call = 0
  await assert.rejects(
    buildSemanticPlan('客户提交订单。', candidate, async () => {
      call += 1
      if (call === 1) return JSON.stringify({ facts: [fact()] })
      if (call === 2) return JSON.stringify({ stories: [story()] })
      return JSON.stringify({ mappings: [{ ...mapping(), factId: 'fact-ghost' }] })
    }),
    /引用未知事实/,
  )
})

test('every referenced element must match the declared mapping type', () => {
  assert.throws(
    () =>
      validateSemanticPlan(
        {
          schemaVersion: '2',
          status: 'mapped',
          facts: [fact()],
          stories: [story()],
          mappings: [
            {
              ...mapping(),
              elementIds: ['order', 'submit-order'],
            },
          ],
          boundaries: [],
          clarifications: [],
        },
        '客户提交订单。',
        candidate,
      ),
    /映射类型与模型元素不一致/,
  )
})

test('mapping output is split by the actual model element types', async () => {
  const mappings = await mapFactsToElements(
    [fact()],
    [story()],
    candidate,
    async () => JSON.stringify({
      mappings: [{
        ...mapping(),
        elementIds: ['order', 'submit-order'],
      }],
    }),
  )
  assert.deepEqual(
    mappings.map((item) => [item.mappingType, item.elementIds]),
    [
      ['object', ['order']],
      ['action', ['submit-order']],
    ],
  )
})

test('a saved semantic plan is revalidated when retrying compilation', () => {
  const semantic = {
    schemaVersion: '2',
    status: 'mapped',
    facts: [fact()],
    stories: [story()],
    mappings: [mapping()],
    boundaries: [],
    clarifications: [],
  } satisfies SemanticPlanV2
  const request = parseAnalysisRequest(
    {
      stage: 'compile',
      semanticPlan: '## 模型概述\n说明',
      narrative: '客户提交订单。',
      semantic,
    },
    'gpt',
  )
  if (request.stage !== 'compile') throw new Error('未返回 compile 请求。')
  assert.deepEqual(request.semantic, semantic)
  assert.throws(
    () =>
      parseAnalysisRequest(
        {
          stage: 'compile',
          semanticPlan: '说明',
          narrative: '客户提交订单。',
          semantic: { ...semantic, stories: [{ ...story(), factIds: ['fact-ghost'] }] },
        },
        'gpt',
      ),
    /未知事实/,
  )
  assert.throws(
    () => validateSemanticPlan({ ...semantic, facts: [fact(), fact()] }),
    /业务事实 ID fact-1 重复/,
  )
  assert.throws(
    () =>
      parseAnalysisRequest(
        {
          stage: 'compile',
          semanticPlan: '说明',
          narrative: '客户提交订单。',
          semantic: 'invalid',
        },
        'gpt',
      ),
    /语义计划必须是对象/,
  )
})
