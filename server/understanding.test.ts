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

test('reads, independently reviews, publishes the narrative and extracts optional questions', async () => {
  const events: StageEvent[] = []
  const prompts: string[] = []
  const result = await readBusiness(
    document,
    async (prompt, options) => {
      prompts.push(prompt)
      assert.equal(options.provider, 'gpt')
      if (prompt.includes('独立业务理解核对者')) return JSON.stringify({ coverage: [{ id: 'b1', status: 'complete', note: '已核对' }], additions: [] })
      assert.ok(prompt.includes('DOC_ONLY_37'))
      assert.doesNotMatch(
        prompt,
        /JSON Schema|kebab-case|外键|actions|functions/,
      )
      assert.match(
        prompt,
        /业务范围与适用场景|业务主体与业务事项|对象及身份边界|业务事实与关系/,
      )
      options.onEvent?.({ type: 'delta', text: narrative })
      return narrative
    },
    { provider: 'gpt', onEvent: (event) => events.push(event) },
  )
  assert.equal(prompts.length, 2)
  assert.equal(result.understanding.review?.status, 'passed')
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

test('understanding delivers validated paragraph references in both SSE and the result', async () => {
  const events: StageEvent[] = []
  const result = await readBusiness(document, async (prompt) => {
    assert.match(prompt, /"id":"b1"/)
    if (prompt.includes('独立业务理解核对者')) return JSON.stringify({ coverage: [{ id: 'b1', status: 'complete', note: '已核对' }], additions: [] })
    assert.match(prompt, /\[\[source:/)
    return '## 业务概述\n\n业务说明中的转述。 [[source:b1]]'
  }, { runtime: 'direct', onEvent: (event) => events.push(event) })
  assert.equal(result.understanding.narrative, '## 业务概述\n\n业务说明中的转述。')
  assert.equal(result.understanding.sources?.blocks[0].text, document.blocks[0].text)
  assert.deepEqual(events.find((event) => event.type === 'understanding-narrative'), {
    type: 'understanding-narrative', ...result.understanding,
  })
})
