import test from 'node:test'
import assert from 'node:assert/strict'
import { buildModel, compileModel } from './modeling.ts'
import { modelContext } from './model-context.ts'
import {
  containsBasis,
  modelingContent,
  parseModelClarifications,
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

test('clarifications are review metadata with basis and impact, published before B and omitted from its input', async () => {
  let calls = 0
  const events: StageEvent[] = []
  const result = await buildModel(
    { narrative },
    async (prompt) => {
      if (++calls === 1) return plan
      assert.ok(
        events.some(
          (event) =>
            event.type === 'model-plan' &&
            event.clarifications[0]?.text === '一份处理记录可以归属几个事项？',
        ),
      )
      assert.ok(prompt.endsWith(JSON.stringify(semantics)))
      assert.doesNotMatch(prompt, /一份处理记录可以归属几个事项|只归属一个事项/)
      return JSON.stringify(model)
    },
    { onEvent: (event) => events.push(event) },
  )
  assert.equal(calls, 2)
  assert.deepEqual(result.clarifications, parseModelClarifications(plan))
  assert.deepEqual(result.model.boundaries, model.boundaries)
  assert.equal('questions' in result.model, false)
  assert.equal(result.semanticPlan, plan)
  const retry = await compileModel(plan, async (prompt) => {
    assert.ok(prompt.endsWith(JSON.stringify(semantics)))
    return JSON.stringify(model)
  })
  assert.deepEqual(retry.clarifications, result.clarifications)
})

test('unsupported business questions cannot silently reach the user or compiler', async () => {
  assert.throws(
    () => parseModelClarifications('## 需要补充的业务信息\n1. 需要审批吗？'),
    /缺少依据/,
  )
  let calls = 0
  await assert.rejects(
    buildModel({ narrative: '独立保存事项。' }, async () => {
      calls++
      return plan
    }),
    /依据不在当前业务说明/,
  )
  assert.equal(calls, 1)
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
