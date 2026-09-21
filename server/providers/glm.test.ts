import test from 'node:test'
import assert from 'node:assert/strict'
import { Agent, type AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'
import type { ProviderEvent } from '../../shared/analysis.ts'
import { createGlmProvider } from './glm.ts'
import { createPiModel, createPiStream } from './pi.ts'
import { resolveProvider } from './index.ts'
import { runPiUnderstanding } from '../agents/pi-understanding.ts'

const frame = (delta: unknown, finish_reason: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`
const done = 'data: [DONE]\n\n'

test('GLM loads its own key lazily, uses coding-plan defaults and streams JSON separately from reasoning', async () => {
  const env: NodeJS.ProcessEnv = {}
  const requests: { url: string; auth: string | null; body: any }[] = []
  const provider = createGlmProvider(async (url, init) => {
    requests.push({ url: String(url), auth: new Headers(init?.headers).get('authorization'), body: JSON.parse(String(init?.body)) })
    return new Response(frame({ reasoning_content: '检查结果格式。' }) + frame({ content: '{"ok":true}' }, 'stop') + done)
  }, env)
  env.GLM_API_KEY = 'glm-test-key'
  const events: ProviderEvent[] = []
  assert.equal(await provider('Return JSON', { outputFormat: 'json', onEvent: (event) => events.push(event) }), '{"ok":true}')
  assert.deepEqual(requests[0], {
    url: 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions',
    auth: 'Bearer glm-test-key',
    body: {
      model: 'glm-5.3-flash', stream: true,
      max_tokens: 32768, reasoning_effort: 'max',
      thinking: { type: 'enabled', clear_thinking: false },
      temperature: 1, top_p: 0.95,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: 'Return JSON' }],
    },
  })
  assert.ok(events.some((event) => event.type === 'delta' && event.reasoning && event.text === '检查结果格式。'))
  const timing = events.filter((event) => event.type === 'timing').at(-1)!.timing
  assert.equal(timing.provider, 'glm')
  assert.equal(timing.reasoningEffort, 'max')
  assert.equal(timing.status, 'completed')
  assert.equal(timing.outputCharacters, 11)
  assert.equal(resolveProvider('glm'), 'glm')

  Object.assign(env, { GLM_API_URL: 'https://glm.invalid/v4/chat/completions/', GLM_MODEL: 'glm-5.3-flashx', GLM_REASONING_EFFORT: 'low', GLM_MAX_OUTPUT_TOKENS: '4096' })
  await provider('next', {})
  assert.equal(requests[1].url, 'https://glm.invalid/v4/chat/completions')
  assert.equal(requests[1].body.model, 'glm-5.3-flashx')
  assert.equal(requests[1].body.reasoning_effort, 'low')
  assert.equal(requests[1].body.max_tokens, 4096)
})

test('GLM rejects missing credentials and unsupported thinking/output settings before sending a request', async () => {
  const neverFetch: typeof fetch = async () => { throw new Error('must not fetch') }
  await assert.rejects(createGlmProvider(neverFetch, { LLM_API_KEY: 'other-key' })('input', {}), /GLM_API_KEY/)
  for (const [config, error] of [
    [{ GLM_REASONING_EFFORT: 'minimal' }, /GLM_REASONING_EFFORT/],
    [{ GLM_REASONING_EFFORT: 'none' }, /GLM_REASONING_EFFORT/],
    [{ GLM_MAX_OUTPUT_TOKENS: '0' }, /GLM_MAX_OUTPUT_TOKENS/],
    [{ GLM_MAX_OUTPUT_TOKENS: '131073' }, /GLM_MAX_OUTPUT_TOKENS/],
  ] as const) {
    const env = { GLM_API_KEY: 'test', ...config }
    await assert.rejects(createGlmProvider(neverFetch, env)('input', {}), error)
    assert.throws(() => createPiModel('glm', env), error)
  }
})

test('GLM Pi loop streams tool arguments and replays original reasoning and tool output with auto choice on retries', async () => {
  const env = { GLM_API_KEY: 'glm-test-key', GLM_API_URL: 'https://glm.invalid/v4/chat/completions/', GLM_REASONING_EFFORT: 'high' }
  const requests: any[] = []
  const originalReasoning = '先检查\n公交安排，再提交。'
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(String(url), 'https://glm.invalid/v4/chat/completions')
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer glm-test-key')
    const request = JSON.parse(String(init?.body))
    requests.push(request)
    const first = requests.length === 1
    return new Response(
      frame({ reasoning_content: first ? '先检查\n' : '检查已通过。' }) +
      (first ? frame({ reasoning_content: '公交安排，再提交。' }) : '') +
      frame({ tool_calls: [{ index: 0, id: first ? 'call-check' : 'call-finish', type: 'function', function: { name: first ? 'check' : 'finish', arguments: '{"value":' } }] }) +
      frame({ tool_calls: [{ index: 0, function: { arguments: '"公交"}' } }] }, 'tool_calls') + done,
      { headers: { 'content-type': 'text/event-stream' } },
    )
  }
  let submitted = false
  const stream = createPiStream('glm', () => true, env)
  const parameters = Type.Object({ value: Type.String() })
  const tools: AgentTool<typeof parameters>[] = [
    { name: 'check', label: 'check', description: 'Check', parameters, execute: async (_id, args) => {
      assert.equal(args.value, '公交')
      return { content: [{ type: 'text', text: '检查通过；编号 12。' }], details: {} }
    } },
    { name: 'finish', label: 'finish', description: 'Submit', parameters, execute: async (_id, args) => {
      assert.equal(args.value, '公交')
      submitted = true
      return { content: [{ type: 'text', text: '已提交。' }], details: {}, terminate: true }
    } },
  ]
  const agent = new Agent({
    initialState: {
      model: createPiModel('glm', env),
      systemPrompt: '检查并提交。',
      thinkingLevel: 'minimal', // Provider config must override this unsupported GLM level.
      tools,
    },
    streamFn: (model, context, options) => stream(model, context, { ...options, fetch: fetcher }),
  })
  agent.shouldStopAfterTurn = () => requests.length >= 3
  await agent.prompt('检查公交安排并提交。')
  assert.equal(submitted, true)
  assert.equal(requests.length, 2)
  for (const request of requests) {
    assert.equal(request.tool_choice, 'auto')
    assert.equal(request.tool_stream, true)
    assert.equal(request.reasoning_effort, 'high')
    assert.equal(request.max_tokens, 32768)
    assert.equal(request.max_completion_tokens, undefined)
    assert.deepEqual(request.thinking, { type: 'enabled', clear_thinking: false })
    assert.equal(request.messages[0].role, 'system')
  }
  const assistant = requests[1].messages.find((message: any) => message.role === 'assistant')
  assert.equal(assistant.reasoning_content, originalReasoning)
  assert.equal(assistant.tool_calls[0].function.arguments, '{"value":"公交"}')
  const tool = requests[1].messages.find((message: any) => message.role === 'tool')
  assert.equal(tool.tool_call_id, 'call-check')
  assert.equal(tool.content, '检查通过；编号 12。')
})

test('GLM Pi retries a terminated connection before it emits assistant content', async () => {
  const env = { GLM_API_KEY: 'glm-test-key', GLM_API_URL: 'https://glm.invalid/v4', GLM_REASONING_EFFORT: 'low' }
  let calls = 0
  const stream = createPiStream('glm', () => false, env)
  const output = await stream(createPiModel('glm', env), {
    systemPrompt: '输出文本。',
    messages: [{ role: 'user', content: '测试', timestamp: Date.now() }],
    tools: [],
  }, {
    fetch: async () => {
      calls++
      if (calls === 1)
        return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('terminated')) } }))
      return new Response(frame({ content: '重试成功' }, 'stop') + done, { headers: { 'content-type': 'text/event-stream' } })
    },
  })
  const message = await output.result()
  assert.equal(calls, 2)
  assert.equal(message.stopReason, 'stop')
  assert.equal((message.content[0] as { type: string; text?: string }).text, '重试成功')
})

test('GLM understanding reports upstream quota errors instead of retrying tool handoff or hiding the cause', async (t) => {
  const oldKey = process.env.GLM_API_KEY
  process.env.GLM_API_KEY = 'glm-error-test-key'
  t.after(() => {
    if (oldKey === undefined) delete process.env.GLM_API_KEY
    else process.env.GLM_API_KEY = oldKey
  })
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return new Response(JSON.stringify({ error: { code: '1113', message: '余额不足或无可用资源包 glm-error-test-key' } }), {
      status: 429,
      headers: { 'content-type': 'application/json', 'x-should-retry': 'false' },
    })
  })
  await assert.rejects(
    runPiUnderstanding(
      { name: 'test', blocks: [{ id: '1', text: '工作人员分配车辆。' }] },
      'glm',
      async () => { throw new Error('critic must not run') },
      { provider: 'glm', runtime: 'pi' },
    ),
    (error: Error) => {
      assert.match(error.message, /GLM.*1113/)
      assert.match(error.message, /余额不足/)
      assert.doesNotMatch(error.message, /glm-error-test-key/)
      return true
    },
  )
  assert.equal(calls, 1)
})

test('Pi understanding returns text without automatic review or a finish tool handoff', async (t) => {
  const previous = {
    GLM_API_KEY: process.env.GLM_API_KEY,
    GLM_API_URL: process.env.GLM_API_URL,
    GLM_MODEL: process.env.GLM_MODEL,
    GLM_REASONING_EFFORT: process.env.GLM_REASONING_EFFORT,
  }
  Object.assign(process.env, {
    GLM_API_KEY: 'glm-understanding-test-key',
    GLM_API_URL: 'https://glm.invalid/v4/chat/completions',
    GLM_MODEL: 'glm-test',
    GLM_REASONING_EFFORT: 'low',
  })
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
  const narrative = '# 文档整理稿\n沿用文档自己的组织方式。\n\n有歧义的说法暂时保留。'
  let request: any
  t.mock.method(globalThis, 'fetch', async (_url: RequestInfo | URL, init?: RequestInit) => {
    request = JSON.parse(String(init?.body))
    return new Response(frame({ content: narrative }, 'stop') + done, { headers: { 'content-type': 'text/event-stream' } })
  })
  const result = await runPiUnderstanding(
    { name: 'test', blocks: [{ id: '1', text: '业务事实。' }] },
    'glm',
    async () => { throw new Error('must not run a reviewer') },
    { provider: 'glm', runtime: 'pi' },
  )
  assert.equal(result, narrative)
  assert.equal(request.tools, undefined)
  assert.equal(request.tool_choice, 'auto')
  assert.equal(request.messages.some((message: any) => message.role === 'tool'), false)
})

test('shared Pi adapter preserves existing providers’ tool handoff request parameters', async () => {
  const env = {
    LLM_API_KEY: 'ds-test', LLM_API_URL: 'https://deepseek.invalid/v1', LLM_MODEL: 'deepseek-chat',
    GPT_API_KEY: 'gpt-test', GPT_API_URL: 'https://gpt.invalid/v1', GPT_MODEL: 'test-gpt',
    QWEN_API_KEY: 'qwen-test', QWEN_API_URL: 'https://qwen.invalid/v1', QWEN_MODEL: 'test-qwen',
  }
  for (const provider of ['deepseek', 'gpt', 'qwen'] as const) {
    let body: any
    const stream = createPiStream(provider, () => true, env)
    const output = await stream(createPiModel(provider, env), {
      messages: [{ role: 'user', content: 'test', timestamp: Date.now() }],
      tools: [{ name: 'finish', description: 'finish', parameters: Type.Object({}) }],
    }, {
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body))
        return new Response(frame({ content: 'ok' }, 'stop') + done, { headers: { 'content-type': 'text/event-stream' } })
      },
    })
    const message = await output.result()
    assert.equal(message.stopReason, 'stop')
    assert.equal(body.tool_choice, 'required')
    assert.equal(body.max_tokens ?? body.max_completion_tokens, 24000)
    assert.equal(body.reasoning_effort, undefined)
    assert.equal(body.tool_stream, undefined)
    assert.deepEqual(body.thinking, provider === 'deepseek' ? { type: 'disabled' } : undefined)
  }
})
