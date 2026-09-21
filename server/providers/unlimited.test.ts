import test from 'node:test'
import assert from 'node:assert/strict'
import { createDeepSeekProvider } from './deepseek.ts'
import { createGptProvider } from './gpt.ts'
import { createGlmProvider } from './glm.ts'
import { createQwenProvider } from './qwen.ts'

for (const [name, create, prefix] of [
  ['DeepSeek', createDeepSeekProvider, 'LLM'],
  ['GPT', createGptProvider, 'GPT'],
  ['GLM', createGlmProvider, 'GLM'],
  ['Qwen', createQwenProvider, 'QWEN'],
] as const) {
  test(`${name} requests default to unlimited and accept zero while preserving cancellation`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    for (const timeout of [undefined, '0']) {
      for (const cancel of [false, true]) {
        const controller = new AbortController()
        let closed = false
        const provider = create(async (_url, init) => {
          t.mock.timers.tick(3600000)
          assert.equal(init?.signal?.aborted, false)
          return new Response(new ReadableStream<Uint8Array>({
            start(output) {
              output.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"完成"}}]}\n\n'))
              if (!cancel) {
                output.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
                output.close()
              }
            },
            cancel() { closed = true },
          }))
        }, {
          [`${prefix}_API_KEY`]: 'test-key',
          [`${prefix}_API_URL`]: 'https://test.invalid/v1',
          [`${prefix}_API_TIMEOUT_MS`]: timeout,
        })
        const result = provider('生成', {
          signal: controller.signal,
          onEvent: event => { if (cancel && event.type === 'delta') controller.abort() },
        })
        if (cancel) {
          await assert.rejects(result, { name: 'AbortError' })
          assert.equal(closed, true)
        } else assert.equal(await result, '完成')
      }
    }
  })
}
