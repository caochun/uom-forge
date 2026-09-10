import test from 'node:test'
import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import { createDeepSeekProvider } from './deepseek.ts'
import { createCodexProvider } from './codex.ts'
import type { ProviderEvent } from '../../shared/analysis.ts'

const env = {
  LLM_API_KEY: 'test-key',
  LLM_API_URL: 'http://test.invalid/v1',
  LLM_MODEL: 'test-model',
  LLM_API_TIMEOUT_MS: '1000',
}
test('DeepSeek preserves split UTF-8, multiline SSE, reasoning and final unterminated event', async () => {
  const raw =
    'data: {"choices":[\r\ndata: {"delta":{"reasoning_content":"思考"}}]}\r\n\r\n' +
    'data: {"choices":[{"delta":{"content":"成果"}}]}\n\n' +
    'data: [DONE]'
  const bytes = new TextEncoder().encode(raw)
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 2)
        controller.enqueue(bytes.slice(i, i + 2))
      controller.close()
    },
  })
  const events: ProviderEvent[] = []
  const provider = createDeepSeekProvider(async (url, init) => {
    assert.equal(url, 'http://test.invalid/v1/chat/completions')
    assert.deepEqual(JSON.parse(String(init?.body)), {
      model: 'test-model',
      stream: true,
      thinking: { type: 'disabled' },
      messages: [{ role: 'user', content: 'this turn only' }],
    })
    return new Response(stream)
  }, env)
  assert.equal(
    await provider('this turn only', {
      onEvent: (event) => events.push(event),
    }),
    '成果',
  )
  assert.deepEqual(
    events
      .filter((event) => event.type === 'delta')
      .map((event) => [event.text, !!event.reasoning]),
    [
      ['思考', true],
      ['成果', false],
    ],
  )
})

test('DeepSeek user cancellation remains AbortError and closes the stream', async () => {
  const controller = new AbortController()
  let closed = false
  const provider = createDeepSeekProvider(
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
    env,
  )
  await assert.rejects(
    provider('input', {
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === 'delta') controller.abort()
      },
    }),
    { name: 'AbortError' },
  )
  assert.equal(closed, true)
})

test('DeepSeek timeouts stop a stalled stream; errors and partial output are not successes', async () => {
  let closed = false
  const stalled = createDeepSeekProvider(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            closed = true
          },
        }),
      ),
    { ...env, LLM_API_TIMEOUT_MS: '30' },
  )
  await assert.rejects(stalled('input', {}), /超时/)
  assert.equal(closed, true)
  const cases: [Response, RegExp][] = [
    [new Response('unavailable', { status: 503 }), /503/],
    [
      new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'),
      /提前结束/,
    ],
    [
      new Response('data: {"error":{"message":"upstream failure"}}\n\n'),
      /upstream failure/,
    ],
  ]
  for (const [response, expected] of cases)
    await assert.rejects(
      createDeepSeekProvider(async () => response, env)('input', {}),
      expected,
    )
})

const fakeAcp = `
const readline = require('node:readline');
const write = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
readline.createInterface({input:process.stdin}).on('line', line => {
  const message = JSON.parse(line);
  if(message.id===1) write({id:1,result:{}});
  else if(message.id===2) write({id:2,result:{sessionId:'session'}});
  else if(message.id===3) {
    const output=JSON.stringify({cwd:process.cwd(),config:JSON.parse(process.env.CODEX_CONFIG),prompt:message.params.prompt});
    write({method:'session/update',params:{update:{sessionUpdate:'agent_message_chunk',content:{text:output}}}});
    if(process.env.FORGE_TEST_MODE==='exit') setImmediate(()=>process.exit(2));
    else if(process.env.FORGE_TEST_MODE!=='stall') write({id:3,result:{stopReason:'end_turn'}});
  }
});`
const codex = (mode = '') =>
  createCodexProvider(
    { command: process.execPath, args: ['-e', fakeAcp] },
    {
      ...process.env,
      CODEX_CONFIG: '{}',
      CODEX_MODEL: '',
      CODEX_REASONING_EFFORT: '',
      CODEX_ACP_TIMEOUT_MS: '1500',
      FORGE_TEST_MODE: mode,
    },
  )

test('Codex sends explicit model/effort and prompt; each call is isolated and cleans its directory', async () => {
  const provider = codex()
  const first = JSON.parse(await provider('first', {}))
  const second = JSON.parse(await provider('second', {}))
  assert.equal(first.config.model, 'gpt-6-astra')
  assert.equal(first.config.model_reasoning_effort, 'medium')
  assert.notEqual(first.cwd, second.cwd)
  assert.deepEqual(second.prompt, [{ type: 'text', text: 'second' }])
  for (const cwd of [first.cwd, second.cwd])
    await assert.rejects(access(cwd), { code: 'ENOENT' })
})
test('Codex partial process exit fails; user cancellation preserves the reason and cleans up', async () => {
  await assert.rejects(codex('exit')('input', {}), /完成响应前退出/)
  const controller = new AbortController()
  let cwd = ''
  await assert.rejects(
    codex('stall')('input', {
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === 'delta') {
          cwd = JSON.parse(event.text).cwd
          controller.abort()
        }
      },
    }),
    { name: 'AbortError' },
  )
  await assert.rejects(access(cwd), { code: 'ENOENT' })
})

test('Codex timing identifies the call, reports session and first text, and retains immutable snapshots', async () => {
  const events: ProviderEvent[] = []
  const result = await codex()('测量输入', {
    onEvent: (event) => events.push(event),
  })
  const timings = events
    .filter((event) => event.type === 'timing')
    .map((event) => event.timing)
  const first = timings[0]
  const last = timings.at(-1)!
  assert.equal(first.status, 'running')
  assert.equal(first.firstTextMs, undefined)
  assert.equal(first.outputCharacters, 0)
  assert.equal(last.status, 'completed')
  assert.equal(last.promptCharacters, 4)
  assert.equal(last.outputCharacters, Array.from(result).length)
  assert.equal(last.model, 'gpt-6-astra')
  assert.equal(last.reasoningEffort, 'medium')
  assert.ok(last.connectedMs! <= last.sessionReadyMs!)
  assert.ok(last.sessionReadyMs! <= last.firstTextMs!)
  assert.ok(last.firstTextMs! <= last.elapsedMs)
  assert.equal(new Set(timings.map((timing) => timing.callId)).size, 1)
  assert.equal(events.at(-1)?.type, 'timing')
})

test('DeepSeek timing separates reasoning from first body text and records failures without a false first text', async () => {
  const events: ProviderEvent[] = []
  const provider = createDeepSeekProvider(
    async () =>
      new Response(
        'data: {"choices":[{"delta":{"reasoning_content":"reasoning only"}}]}\n\n' +
          'data: {"choices":[{"delta":{"content":"正文🙂"}}]}\n\n' +
          'data: [DONE]\n\n',
      ),
    env,
  )
  await provider('input', {
    onEvent(event) {
      if (event.type === 'delta' && event.reasoning) {
        const latest = events.filter((item) => item.type === 'timing').at(-1)
        assert.equal(latest?.timing.firstTextMs, undefined)
      }
      events.push(event)
    },
  })
  const last = events.filter((event) => event.type === 'timing').at(-1)!.timing
  assert.equal(last.status, 'completed')
  assert.equal(last.outputCharacters, 3)
  assert.equal(last.sessionReadyMs, undefined)
  assert.ok(last.firstTextMs! >= last.connectedMs!)
  const failures: ProviderEvent[] = []
  await assert.rejects(
    createDeepSeekProvider(
      async () => new Response('unavailable', { status: 503 }),
      env,
    )('input', { onEvent: (event) => failures.push(event) }),
    /503/,
  )
  const failed = failures
    .filter((event) => event.type === 'timing')
    .at(-1)!.timing
  assert.equal(failed.status, 'failed')
  assert.equal(failed.firstTextMs, undefined)
})

test('cancelling Codex records a cancelled call with partial output, not completion', async () => {
  const events: ProviderEvent[] = []
  const controller = new AbortController()
  await assert.rejects(
    codex('stall')('input', {
      signal: controller.signal,
      onEvent(event) {
        events.push(event)
        if (event.type === 'delta') controller.abort()
      },
    }),
    { name: 'AbortError' },
  )
  const timing = events
    .filter((event) => event.type === 'timing')
    .at(-1)!.timing
  assert.equal(timing.status, 'cancelled')
  assert.ok(timing.outputCharacters > 0)
})
