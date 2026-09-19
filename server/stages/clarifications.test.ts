import test from 'node:test'
import assert from 'node:assert/strict'
import { buildModel, compileModel } from './modeling.ts'
import { modelContext } from './model-context.ts'
import {
  containsBasis,
  modelingContent,
  parseModelClarifications,
  reviewModelClarifications,
} from '../../shared/clarifications.ts'
import type { CandidateModel } from '../../shared/model.ts'
import type { StageEvent } from '../../shared/analysis.ts'

const narrative = '每次办理形成处理记录，记录与办理事项之间的归属尚未明确。'
const semantics =
  '## 模型概述\n办理事项产生记录。\n## 建模判断与边界\n记录如何归属事项尚未确定；本轮不展开计算算法与技术字段。'
const section = `## 需要补充的业务信息
1. 一份处理记录可以归属几个事项？
依据：${narrative}
歧义：仅属于一次事项，或者可以作为多次事项的共同记录。
影响：前者建模为记录到单次事项的归属，后者需允许记录与多个事项关联。
选项：只归属一个事项；可以归属多个事项`
const plan = semantics + '\n\n' + section
const model: CandidateModel = {
  schemaVersion: '1',
  name: '事项处理',
  summary: '管理事项与记录。',
  objects: [],
  relations: [],
  actions: [],
  functions: [],
  rules: [],
  activities: [],
  boundaries: ['记录如何归属事项尚未确定。'],
}
const uncertainCheck = (basis: string, frozen = false) =>
  JSON.stringify({
    summary: '业务归属尚未明确。',
    ...(frozen ? { judgments: [{ id: 'scenario-story-1', status: 'uncertain', elements: [], explanation: '业务归属尚未确定。', gap: '归属未定。', suggestion: '保留边界。' }], additionalCases: [] } : { cases: [
      {
        id: 'ownership',
        fact: '记录归属事项',
        basis,
        scenario: '记录 R 属于事项 A 或 A/B，业务尚未确定。',
        status: 'uncertain',
        elements: [],
        explanation: '模型保留未知边界。',
        gap: '归属未确定。',
        suggestion: '保留未知，不作默认。',
      },
    ] }),
    clarifications: [],
  })

function semanticFixture(prompt: string, source: string): string | undefined {
  if (prompt.includes('业务事实提取器'))
    return JSON.stringify({
      facts: [{
        id: 'fact-1', statement: source, kind: 'event', actors: ['业务方'],
        objects: ['事项'], conditions: [], source, certainty: 'explicit',
      }],
    })
  if (prompt.includes('组织成业务故事'))
    return JSON.stringify({
      stories: [{
        id: 'story-1', name: '办理事项', goal: '完成事项', factIds: ['fact-1'],
        steps: [{ order: 1, actor: '业务方', action: '办理', object: '事项', factIds: ['fact-1'] }],
      }],
    })
  if (prompt.includes('映射到已经编译的候选领域模型元素'))
    return JSON.stringify({
      mappings: [{
        factId: 'fact-1', elementIds: [], mappingType: 'object',
        explanation: '当前候选保留该事实为边界，尚无对应元素。', coverage: 'missing',
      }],
    })
}

test('clarifications are review metadata with basis and impact, published before B and omitted from its input', async () => {
  let calls = 0
  const events: StageEvent[] = []
  const result = await buildModel(
    { narrative },
    async (prompt) => {
      const fixture = semanticFixture(prompt, narrative)
      if (fixture) return fixture
      if (++calls === 1) return plan
      if (calls === 3) return uncertainCheck(narrative, true)
      assert.ok(
        events.some(
          (event) =>
            event.type === 'model-plan' &&
            event.clarifications[0]?.text === '一份处理记录可以归属几个事项？',
        ),
      )
      assert.ok(prompt.includes(JSON.stringify(semantics)))
      assert.match(prompt, /fact-1/)
      assert.doesNotMatch(prompt, /一份处理记录可以归属几个事项|只归属一个事项/)
      return JSON.stringify(model)
    },
    { onEvent: (event) => events.push(event) },
  )
  assert.equal(calls, 3)
  assert.deepEqual(result.clarifications, parseModelClarifications(plan))
  assert.deepEqual(result.model.boundaries, model.boundaries)
  assert.equal('questions' in result.model, false)
  assert.equal(result.semanticPlan, plan)
  let retryCalls = 0
  const retry = await compileModel(plan, narrative, async (prompt) => {
    if (++retryCalls === 2) return uncertainCheck(narrative)
    assert.ok(prompt.endsWith(JSON.stringify(semantics)))
    return JSON.stringify(model)
  })
  assert.deepEqual(retry.clarifications, parseModelClarifications(plan))
  assert.equal(retry.expressionReview.status, 'issues')
})

test('unsupported business questions cannot silently reach the user or compiler', async () => {
  assert.throws(
    () => parseModelClarifications('## 需要补充的业务信息\n1. 需要审批吗？'),
    /缺少依据/,
  )
  let calls = 0
  const result = await buildModel(
    { narrative: '独立保存事项。' },
    async (prompt) => {
      const fixture = semanticFixture(prompt, '独立保存事项。')
      if (fixture) return fixture
      calls++
      if (calls === 1) return plan
      if (calls === 3) return uncertainCheck('独立保存事项。', true)
      assert.doesNotMatch(prompt, /一份处理记录可以归属几个事项/)
      return JSON.stringify(model)
    },
  )
  assert.equal(calls, 3)
  assert.deepEqual(result.clarifications, [])
  assert.equal(result.semanticPlan, plan)
  assert.match(result.validation.warnings.join('\n'), /依据不在当前业务说明/)
  assert.throws(
    () =>
      parseModelClarifications(
        plan + '\n\n' + section.split('\n').slice(1).join('\n'),
      ),
    /重复/,
  )
  assert.equal(
    containsBasis(
      '说明“归属唯一”。\n另一段指出“归属可多个”。',
      '“说明‘归属唯一’。”；“另一段指出‘归属可多个’。”',
    ),
    true,
  )
  assert.equal(
    containsBasis(
      '说明“归属唯一”。\n另一段指出“归属可多个”。',
      '“说明‘归属唯一’。”“另一段指出‘归属可多个’。”',
    ),
    true,
  )
  assert.equal(
    containsBasis('归属唯一。', '“归属唯一。”；“归属可多个。”'),
    false,
  )
  assert.equal(
    containsBasis(
      '说明同时出现“一份记录只属于一个事项”和“一份记录由多个事项共同形成”，两者尚未协调。',
      '“一份记录只属于一个事项”与“一份记录由多个事项共同形成”同时出现，尚未协调。',
    ),
    true,
  )
  assert.equal(
    containsBasis(
      '一份记录只属于一个事项。',
      '“一份记录只属于一个事项”与“所有事项自动共享记录”冲突。',
    ),
    false,
  )
})

test('one invalid question cannot erase valid questions or the plan when B fails', async () => {
  const mixed =
    plan +
    '\n2. 其他记录是否共享？\n依据：不存在的依据\n歧义：共享或独立\n影响：归属不同\n3. 需要审批吗？'
  const events: StageEvent[] = []
  let calls = 0
  await assert.rejects(
    buildModel(
      { narrative },
      async (prompt) => {
        const fixture = semanticFixture(prompt, narrative)
        if (fixture) return fixture
        if (++calls === 1) return mixed
        assert.doesNotMatch(prompt, /其他记录是否共享|不存在的依据|需要审批吗/)
        return '{}'
      },
      { onEvent: (event) => events.push(event) },
    ),
    /模型整理失败/,
  )
  assert.equal(calls, 2)
  const event = events.find((e) => e.type === 'model-plan')
  assert.ok(event?.type === 'model-plan')
  assert.equal(event.semanticPlan, mixed)
  assert.equal(event.clarifications.length, 1)
  assert.equal(event.warnings.length, 2)
  assert.equal(reviewModelClarifications(mixed).clarifications.length, 0)
})

test('duplicate questions are isolated and a questionnaire alone is not a model plan', async () => {
  const duplicate = plan + '\n' + section.split('\n').slice(1).join('\n')
  const review = reviewModelClarifications(duplicate, narrative)
  assert.equal(review.clarifications.length, 1)
  assert.match(review.warnings[0], /重复/)
  let calls = 0
  await assert.rejects(
    buildModel({ narrative }, async (prompt) => {
      const fixture = semanticFixture(prompt, narrative)
      if (fixture) return fixture
      calls++
      return section
    }),
    /没有可整理的模型内容/,
  )
  assert.equal(calls, 1)
  await assert.rejects(
    compileModel(section, narrative, async () => {
      throw new Error('must not invoke')
    }),
    /没有可整理的模型内容/,
  )
})

test('no clarification section means no questionnaire; semantic scope and subsequent sections survive', () => {
  assert.deepEqual(parseModelClarifications(semantics), [])
  assert.equal(modelingContent(semantics), semantics)
  assert.deepEqual(
    parseModelClarifications(semantics + '\n## 需要补充的业务信息\n无。'),
    [],
  )
  assert.match(
    modelingContent(plan + '\n## 附注\n保留的建模判断'),
    /附注\n保留的建模判断/,
  )
  const context = modelContext({
    ...model,
    questions: ['OLD_QUESTION_CANARY'],
    historicalQuestions: ['HISTORICAL_CANARY'],
  })
  assert.doesNotMatch(
    JSON.stringify(context),
    /OLD_QUESTION_CANARY|HISTORICAL_CANARY/,
  )
  assert.match(JSON.stringify(context), /记录如何归属事项尚未确定/)
})
