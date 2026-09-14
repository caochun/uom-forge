import test from 'node:test'
import assert from 'node:assert/strict'
import { createGptProvider } from './gpt.ts'
import { createDeepSeekProvider } from './deepseek.ts'
import { createQwenProvider } from './qwen.ts'
import { resolveProvider } from './index.ts'
import type { ProviderEvent } from '../../shared/analysis.ts'

const env = {
  GPT_API_KEY: 'gpt-test-key',
  GPT_API_URL: 'http://gpt.invalid/v1/',
  GPT_MODEL: 'configured-gpt',
  GPT_API_TIMEOUT_MS: '1000',
  LLM_API_KEY: 'deepseek-test-key',
  LLM_API_URL: 'http://deepseek.invalid/v1',
  LLM_MODEL: 'configured-deepseek',
  LLM_API_TIMEOUT_MS: '1000',
  QWEN_API_KEY: 'qwen-test-key',
  QWEN_API_URL: 'http://qwen.invalid/v1',
  QWEN_MODEL: 'configured-qwen',
  QWEN_API_TIMEOUT_MS: '1000',
}
const body =
  'data: {"choices":[{"delta":{"content":"正文🙂"}}]}\n\n' +
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
  'data: [DONE]\n\n'

test('GPT resolves configuration per call, isolates provider parameters and emits streaming timing', async () => {
  const config: NodeJS.ProcessEnv = {}
  const requests: { url: string; auth: string | null; body: unknown }[] = []
  const fetcher: typeof fetch = async (url, init) => {
    requests.push({
      url: String(url),
      auth: new Headers(init?.headers).get('authorization'),
      body: JSON.parse(String(init?.body)) as unknown,
    })
    return new Response(body)
  }
  const gpt = createGptProvider(fetcher, config)
  Object.assign(config, env)
  const events: ProviderEvent[] = []
  assert.equal(
    await gpt('first turn', { onEvent: (event) => events.push(event) }),
    '正文🙂',
  )
  assert.deepEqual(requests[0], {
    url: 'http://gpt.invalid/v1/chat/completions',
    auth: 'Bearer gpt-test-key',
    body: {
      model: 'configured-gpt',
      stream: true,
      reasoning_effort: 'medium',
      messages: [{ role: 'user', content: 'first turn' }],
    },
  })
  config.GPT_API_URL = 'http://gpt.invalid/v1/chat/completions/'
  config.GPT_REASONING_EFFORT = 'high'
  await gpt('second turn', {})
  assert.deepEqual(requests[1], {
    ...requests[0],
    body: {
      model: 'configured-gpt',
      stream: true,
      reasoning_effort: 'high',
      messages: [{ role: 'user', content: 'second turn' }],
    },
  })
  await createDeepSeekProvider(fetcher, config)('third turn', {})
  assert.deepEqual(requests[2], {
    url: 'http://deepseek.invalid/v1/chat/completions',
    auth: 'Bearer deepseek-test-key',
    body: {
      model: 'configured-deepseek',
      stream: true,
      thinking: { type: 'disabled' },
      max_tokens: 16384,
      messages: [{ role: 'user', content: 'third turn' }],
    },
  })
  const timing = events
    .filter((event) => event.type === 'timing')
    .at(-1)!.timing
  assert.equal(timing.provider, 'gpt')
  assert.equal(timing.model, env.GPT_MODEL)
  assert.equal(timing.reasoningEffort, 'medium')
  assert.equal(timing.status, 'completed')
  assert.equal(timing.outputCharacters, 3)
  assert.equal(timing.sessionReadyMs, undefined)
  assert.ok(timing.firstTextMs! >= timing.connectedMs!)
  assert.ok(
    events.some((event) => event.type === 'delta' && event.text === '正文🙂'),
  )
})

test('Qwen resolves its independent OpenAI-compatible configuration', async () => {
  const requests: { url: string; auth: string | null; body: unknown }[] = []
  const qwen = createQwenProvider(async (url, init) => {
    requests.push({
      url: String(url),
      auth: new Headers(init?.headers).get('authorization'),
      body: JSON.parse(String(init?.body)) as unknown,
    })
    return new Response(body)
  }, env)
  assert.equal(await qwen('qwen turn', {}), '正文🙂')
  assert.deepEqual(requests[0], {
    url: 'http://qwen.invalid/v1/chat/completions',
    auth: 'Bearer qwen-test-key',
    body: {
      model: 'configured-qwen',
      stream: true,
      max_tokens: 16384,
      messages: [{ role: 'user', content: 'qwen turn' }],
    },
  })
  assert.equal(resolveProvider('qwen'), 'qwen')
})

test('GPT requires its own credentials; Codex is explicitly disabled', async () => {
  let fetched = false
  await assert.rejects(
    createGptProvider(
      async () => {
        fetched = true
        return new Response(body)
      },
      { LLM_API_KEY: 'other-key', LLM_API_URL: 'http://other.invalid' },
    )('input', {}),
    /GPT_API_KEY/,
  )
  assert.equal(fetched, false)
  assert.equal(resolveProvider('gpt'), 'gpt')
  assert.equal(resolveProvider('deepseek'), 'deepseek')
  assert.throws(() => resolveProvider('codex'), /ACP 已停用/)
  assert.throws(() => resolveProvider('unknown'), /不支持/)
})

test('GPT rejects upstream errors, incomplete streams, invalid JSON, token limits and empty responses', async () => {
  const cases: [() => Response, RegExp][] = [
    [() => new Response('unavailable', { status: 503 }), /GPT 返回 HTTP 503/],
    [
      () =>
        new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'),
      /GPT 连接提前结束/,
    ],
    [
      () => new Response('data: {"error":{"message":"upstream failed"}}\n\n'),
      /GPT：upstream failed/,
    ],
    [() => new Response('data: broken\n\n'), /GPT 返回了无效的流式 JSON/],
    [
      () =>
        new Response(
          'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
        ),
      /GPT 输出未正常完成（length）/,
    ],
    [() => new Response('data: [DONE]\n\n'), /GPT 没有返回正文/],
  ]
  for (const [response, expected] of cases) {
    const events: ProviderEvent[] = []
    await assert.rejects(
      createGptProvider(async () => response(), env)('input', {
        onEvent: (event) => events.push(event),
      }),
      expected,
    )
    assert.equal(
      events.filter((event) => event.type === 'timing').at(-1)?.timing.status,
      'failed',
    )
  }
})

test('GPT cancellation and its independent deadline close the response stream', async () => {
  for (const mode of ['cancel', 'timeout'] as const) {
    let closed = false
    const controller = new AbortController()
    const events: ProviderEvent[] = []
    const provider = createGptProvider(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(stream) {
              stream.enqueue(
                new TextEncoder().encode(
                  'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
                ),
              )
            },
            cancel() {
              closed = true
            },
          }),
        ),
      { ...env, GPT_API_TIMEOUT_MS: mode === 'timeout' ? '30' : '1000' },
    )
    await assert.rejects(
      provider('input', {
        signal: controller.signal,
        onEvent(event) {
          events.push(event)
          if (mode === 'cancel' && event.type === 'delta') controller.abort()
        },
      }),
      mode === 'cancel' ? { name: 'AbortError' } : /GPT 请求超时/,
    )
    assert.equal(closed, true)
    assert.equal(
      events.filter((event) => event.type === 'timing').at(-1)?.timing.status,
      mode === 'cancel' ? 'cancelled' : 'failed',
    )
  }
})
