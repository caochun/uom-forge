import test from 'node:test'
import assert from 'node:assert/strict'
import { readBusiness } from './stages/understanding.ts'

import type { StageEvent } from '../shared/analysis.ts'

const document = {
  name: 'material.md',
  blocks: [{ id: 'b1', text: '只有原文包含的标记：DOC_ONLY_37。' }],
}
const narrative =
  '# 业务概述\n\n申请满足条件时可以处理，否则继续保留。\n\n## 待确认问题\n\n1. 是否需要复核？\n   选项：需要；不需要\n2. 请补充责任人。\n'

test('reads once, publishes the narrative and extracts optional questions', async () => {
  const events: StageEvent[] = []
  const prompts: string[] = []
  const result = await readBusiness(
    document,
    async (prompt, options) => {
      prompts.push(prompt)
      assert.equal(options.provider, 'gpt')
      assert.ok(prompt.includes('DOC_ONLY_37'))
      assert.doesNotMatch(
        prompt,
        /JSON Schema|kebab-case|外键|actions|functions/,
      )
      assert.match(
        prompt,
        /业务主体与业务事项|可持续管理的资源和业务产出|业务事实与对象联系/,
      )
      options.onEvent?.({ type: 'delta', text: narrative })
      return narrative
    },
    { provider: 'gpt', onEvent: (event) => events.push(event) },
  )
  assert.equal(prompts.length, 1)
  assert.equal(result.understanding.narrative, narrative)
  assert.deepEqual(result.understanding.questions, [
    { text: '是否需要复核？', options: ['需要', '不需要'] },
    { text: '请补充责任人。', options: [] },
  ])
  assert.deepEqual(
    events.filter((event) => event.type === 'delta').map((event) => event.part),
    ['reading'],
  )
})

test('cancellation after reading prevents the second provider invocation', async () => {
  const controller = new AbortController()
  let calls = 0
  await assert.rejects(
    readBusiness(
      document,
      async () => {
        calls++
        controller.abort()
        return narrative
      },
      { signal: controller.signal },
    ),
    { name: 'AbortError' },
  )
  assert.equal(calls, 1)
})

test('an empty explanation never reaches the formatter', async () => {
  let calls = 0
  await assert.rejects(
    readBusiness(document, async () => {
      calls++
      return ' \n'
    }),
    /未返回业务说明/,
  )
  assert.equal(calls, 1)
})
