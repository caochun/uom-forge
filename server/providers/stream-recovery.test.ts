import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { Agent, type AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'
import type { ProviderEvent } from '../../shared/analysis.ts'
import { createGlmProvider } from './glm.ts'
import { createPiModel, createPiStream } from './pi.ts'
import { connectionFailure } from './stream-recovery.ts'

const env = { GLM_API_KEY: 'test-key', GLM_API_URL: 'https://glm.invalid/v4', GLM_API_TIMEOUT_MS: '0' }
const frame = (delta: unknown, finish_reason: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`
const complete = () => new Response(frame({ content: '完整结果' }, 'stop') + 'data: [DONE]\n\n')
function broken(text = '废弃片段', eof = false) {
  let sent = false
  return new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!sent) {
        sent = true
        controller.enqueue(new TextEncoder().encode(frame({ reasoning_content: '失败思考' }) + frame({ content: text })))
      } else {
        // Let the consumer process the already received frames first.
        await new Promise(resolve => setTimeout(resolve, 5))
        if (eof) controller.close()
        else controller.error(new TypeError('terminated', { cause: Object.assign(new Error('socket closed'), { code: 'UND_ERR_SOCKET' }) }))
      }
    },
  }))
}

test('transport classification keeps socket causes but excludes quota, validation and cancellation', () => {
  assert.equal(connectionFailure(new TypeError('terminated', { cause: Object.assign(new Error('socket'), { code: 'UND_ERR_SOCKET' }) })), 'UND_ERR_SOCKET')
  for (const error of ['429 quota terminated', '401 unauthorized', 'invalid JSON', 'Provider finish_reason: length', new DOMException('cancelled', 'AbortError')])
    assert.equal(connectionFailure(error), undefined)
})

for (const eof of [false, true]) test(`review/compile stream resets partial output and retries ${eof ? 'premature EOF' : 'socket termination'}`, async () => {
  let calls = 0
  const events: ProviderEvent[] = []
  let visible = '', reasoning = ''
  const result = await createGlmProvider(async () => ++calls === 1 ? broken(undefined, eof) : complete(), env)('prompt', {
    onEvent(event) {
      events.push(event)
      if (event.type === 'reset') { visible = ''; reasoning = '' }
      if (event.type === 'delta') {
        if (event.reasoning) reasoning += event.text
        else visible += event.text
      }
    },
  })
  assert.equal(calls, 2)
  assert.equal(result, '完整结果')
  assert.equal(visible, result)
  assert.equal(reasoning, '')
  assert.ok(events.findIndex(e => e.type === 'delta') < events.findIndex(e => e.type === 'reset'))
  assert.deepEqual(events.filter(e => e.type === 'timing').map(e => e.timing.status).filter(status => status !== 'running'), ['failed', 'completed'])
})

test('retries are bounded and cancellation during backoff never starts another request', async () => {
  let calls = 0
  await assert.rejects(createGlmProvider(async () => { calls++; return broken() }, env)('prompt', {}), /GLM.*UND_ERR_SOCKET.*重试 2 次/)
  assert.equal(calls, 3)
  for (const point of ['delta', 'reset'] as const) {
    calls = 0
    const controller = new AbortController()
    await assert.rejects(createGlmProvider(async () => { calls++; return broken() }, env)('prompt', {
      signal: controller.signal,
      onEvent(event) { if (event.type === point) controller.abort(new Error('user stopped')) },
    }), /user stopped/)
    assert.equal(calls, 1)
  }
})

test('a configured deadline includes retry backoff and retains its timeout reason', async () => {
  let calls = 0
  await assert.rejects(createGlmProvider(async () => { calls++; return broken() }, { ...env, GLM_API_TIMEOUT_MS: '50' })('prompt', {}), /GLM 请求超时/)
  assert.equal(calls, 1)
})

test('Pi recovers real TCP disconnects after reasoning, text and tool arguments without replaying tools or polluting history', async t => {
  const bodies: any[] = []
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    bodies.push(JSON.parse(body))
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const tool = (id: string) => frame({ tool_calls: [{ index: 0, id, type: 'function', function: { name: 'check', arguments: '{}' } }] }, 'tool_calls')
    if (bodies.length === 1 || bodies.length === 3) {
      res.write(frame({ reasoning_content: '失败思考' }) + frame({ content: '废弃片段' }) + tool('discarded'))
      setTimeout(() => res.destroy(), 20)
    } else if (bodies.length === 2) {
      res.end(frame({ reasoning_content: '保留思考' }) + frame({ content: '完整设计' }) + tool('valid') + 'data: [DONE]\n\n')
    } else res.end(frame({ content: '完成' }, 'stop') + 'data: [DONE]\n\n')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const config = { ...env, GLM_API_URL: `http://127.0.0.1:${address.port}/v4` }
  const events: string[] = []
  let visible = '', reasoning = '', toolCalls = 0, starts = 0
  const parameters = Type.Object({})
  const tool: AgentTool<typeof parameters> = {
    name: 'check', label: 'check', description: 'check', parameters,
    async execute(id) { assert.equal(id, 'valid'); toolCalls++; return { content: [{ type: 'text', text: '已检查' }], details: {} } },
  }
  const agent = new Agent({
    initialState: { model: createPiModel('glm', config), tools: [tool] },
    streamFn: createPiStream('glm', () => false, config, 'high', () => {
      events.push('reset'); visible = ''; reasoning = ''
    }),
  })
  agent.subscribe(event => {
    if (event.type === 'message_start' && event.message.role === 'assistant') { starts++; visible = ''; reasoning = '' }
    if (event.type === 'message_update') {
      const update = event.assistantMessageEvent
      if (update.type === 'text_delta') { visible += update.delta; events.push(update.delta) }
      if (update.type === 'thinking_delta') reasoning += update.delta
    }
  })
  await agent.prompt('检查设计')
  assert.equal(agent.state.errorMessage, undefined)
  assert.equal(bodies.length, 4)
  assert.equal(toolCalls, 1)
  assert.equal(starts, 2)
  assert.equal(visible, '完成')
  assert.equal(reasoning, '')
  assert.deepEqual(bodies[0].messages, bodies[1].messages)
  assert.deepEqual(bodies[2].messages, bodies[3].messages)
  assert.equal(bodies[3].messages.filter((m: any) => m.role === 'tool').length, 1)
  assert.doesNotMatch(JSON.stringify(agent.state.messages), /废弃片段|失败思考|discarded/)
  assert.deepEqual(events, ['废弃片段', 'reset', '完整设计', '废弃片段', 'reset', '完成'])
})

test('Pi cancellation during retry backoff resolves its stream and makes no further request', async () => {
  const controller = new AbortController()
  let calls = 0
  const agent = new Agent({
    initialState: { model: createPiModel('glm', env), tools: [] },
    streamFn: (model, context, options) => createPiStream('glm', () => false, env, 'high', () => {
      controller.abort(); agent.abort()
    })(model, context, { ...options, fetch: async () => { calls++; return broken() } }),
  })
  await agent.prompt('测试')
  assert.equal(controller.signal.aborted, true)
  assert.equal(calls, 1)
  assert.equal((agent.state.messages.at(-1) as { stopReason: string }).stopReason, 'aborted')
})

test('Pi result settles after its retry budget is exhausted, including result-only consumers', async () => {
  let calls = 0
  const stream = await createPiStream('glm', () => false, env)(createPiModel('glm', env), {
    messages: [{ role: 'user', content: '测试', timestamp: Date.now() }],
  }, { fetch: async () => { calls++; return broken() } })
  const result = await stream.result()
  assert.equal(calls, 3)
  assert.equal(result.stopReason, 'error')
  assert.match(result.errorMessage!, /UND_ERR_SOCKET.*重试 2 次/)
})

test('Pi retains a reset before HTTP headers through SDK error wrapping and does not reuse its code for later HTTP errors', async () => {
  for (const recover of [true, false]) {
    let calls = 0
    const stream = await createPiStream('glm', () => false, env)(createPiModel('glm', env), {
      messages: [{ role: 'user', content: '测试', timestamp: Date.now() }],
    }, { fetch: async () => {
      calls++
      if (calls === 1) throw new TypeError('fetch failed', { cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) })
      return recover ? complete() : new Response(JSON.stringify({ error: { message: '余额不足' } }), { status: 429 })
    } })
    const result = await stream.result()
    assert.equal(calls, 2)
    assert.equal(result.stopReason, recover ? 'stop' : 'error')
    if (!recover) assert.match(result.errorMessage!, /余额不足/)
  }
})
