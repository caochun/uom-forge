import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { createApiMiddleware } from './api.ts'
import type { RunTurn } from './providers/types.ts'
import type { AnalysisEvent } from '../shared/analysis.ts'
import { testAgents } from './testing/agents.ts'

async function serve(runTurn: RunTurn, agents = testAgents(runTurn)) {
  const middleware = createApiMiddleware(runTurn, agents)
  const server = createServer((request, response) => {
    void middleware(request, response, () => {
      response.statusCode = 404
      response.end()
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  return { server, url: `http://127.0.0.1:${address.port}` }
}
async function close(server: Server) {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}
const post = (url: string, value: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
  })
const events = (text: string): AnalysisEvent[] =>
  text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)) as AnalysisEvent)

test('HTTP and SSE reject malformed inputs before invoking inference', async () => {
  let calls = 0
  const { server, url } = await serve(async () => {
    calls++
    return ''
  })
  try {
    assert.equal((await fetch(url + '/api/analyze')).status, 405)
    assert.equal(
      (await post(url + '/api/analyze', { narrative: '' })).status,
      400,
    )
    const bad = await post(url + '/api/analyze/stream', {
      stage: 'compile',
      document: { blocks: ['must not be used'] },
    })
    assert.ok(events(await bad.text()).some((event) => event.type === 'error'))
    assert.equal(calls, 0)
  } finally {
    await close(server)
  }
})

test('reading emits SSE to completion; a consumed request body does not cancel inference', async () => {
  const { server, url } = await serve(async (prompt, options) => {
    assert.match(prompt, /DOCUMENT_ONLY/)
    assert.equal(options.provider, 'gpt')
    assert.equal(options.reasoningEffort, 'low')
    assert.equal(options.signal?.aborted, false)
    options.onEvent?.({
      type: 'timing',
      timing: {
        callId: 'reading-call',
        provider: 'gpt',
        model: 'test-model',
        startedAt: new Date().toISOString(),
        promptCharacters: prompt.length,
        outputCharacters: 0,
        elapsedMs: 3,
        connectedMs: 3,
        status: 'running',
      },
    })
    options.onEvent?.({ type: 'delta', text: '## 业务概述\n说明。' })
    return '## 业务概述\n说明。'
  })
  try {
    const response = await post(url + '/api/analyze/stream', {
      stage: 'understand',
      provider: 'gpt',
      reasoningEffort: 'low',
      document: { name: 'doc', blocks: [{ id: '1', text: 'DOCUMENT_ONLY' }] },
    })
    const output = events(await response.text())
    assert.ok(
      output.some(
        (event) => event.type === 'phase' && event.text.includes('GPT API'),
      ),
    )
    assert.ok(
      output.some(
        (event) => event.type === 'delta' && event.part === 'reading',
      ),
    )
    assert.ok(output.some((event) => event.type === 'understanding-narrative'))
    assert.ok(
      output.some(
        (event) =>
          event.type === 'timing' &&
          event.part === 'reading' &&
          event.timing.provider === 'gpt' &&
          event.timing.connectedMs === 3,
      ),
    )
    assert.equal(output.at(-1)?.type, 'result')
  } finally {
    await close(server)
  }
})

test('SSE disconnect aborts an active inference call', async () => {
  let observeAbort: () => void = () => {}
  const aborted = new Promise<void>((resolve) => {
    observeAbort = resolve
  })
  const { server, url } = await serve(
    async (_prompt, options) =>
      new Promise((_resolve, reject) => {
        options.onEvent?.({ type: 'delta', text: 'partial' })
        options.signal?.addEventListener(
          'abort',
          () => {
            observeAbort()
            reject(options.signal?.reason)
          },
          { once: true },
        )
      }),
  )
  try {
    const controller = new AbortController()
    const response = await fetch(url + '/api/analyze/stream', {
      method: 'POST',
      body: JSON.stringify({
        stage: 'understand',
        document: { name: 'doc', blocks: [{ id: '1', text: 'text' }] },
      }),
      signal: controller.signal,
    })
    await response.body?.getReader().read()
    controller.abort()
    await aborted
  } finally {
    await close(server)
  }
})

test('discussion uses GPT and all API routes reject disabled ACP before inference', async () => {
  let calls = 0
  const { server, url } = await serve(async (_prompt, options) => {
    calls++
    assert.equal(options.provider, 'gpt')
    assert.equal(options.reasoningEffort, 'high')
    return '讨论结果'
  })
  try {
    const response = await post(url + '/api/discuss', {
      provider: 'gpt',
      reasoningEffort: 'high',
      document: { name: 'doc', blocks: [{ id: '1', text: 'DOCUMENT_ONLY' }] },
      messages: [{ role: 'user', content: '解释业务边界' }],
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { text: '讨论结果' })
    for (const route of ['/api/analyze', '/api/analyze/stream', '/api/discuss', '/api/discuss/stream']) {
      const disabled = await post(url + route, { provider: 'codex' })
      assert.match(await disabled.text(), /ACP 已停用/)
    }
    assert.equal(calls, 1)
  } finally {
    await close(server)
  }
})

test('discussion stream forwards provider deltas and returns the validated answer', async () => {
  const { server, url } = await serve(async (_prompt, options) => {
    options.onEvent?.({ type: 'delta', text: '正在分析', reasoning: true })
    options.onEvent?.({ type: 'delta', text: '结论。' })
    return '结论。'
  })
  try {
    const response = await post(url + '/api/discuss/stream', {
      provider: 'gpt',
      document: { name: 'doc', blocks: [{ id: '1', text: '业务说明。' }] },
      messages: [{ role: 'user', content: '解释业务边界' }],
    })
    assert.equal(response.status, 200)
    const output = await response.text()
    assert.match(output, /"reasoning":true/)
    assert.match(output, /"type":"result"/)
    assert.match(output, /"text":"结论。"/)
  } finally {
    await close(server)
  }
})

test('model options are public configuration, and invalid efforts fail before inference on every route', async () => {
  let calls = 0
  const { server, url } = await serve(async () => { calls++; return 'must not run' })
  try {
    const response = await fetch(url + '/api/models')
    assert.equal(response.status, 200)
    const profiles = await response.json()
    assert.deepEqual(Object.keys(profiles).sort(), ['deepseek', 'glm', 'gpt', 'qwen'])
    for (const value of Object.values(profiles))
      assert.deepEqual(Object.keys(value as object).sort(), ['defaultEffort', 'description', 'efforts', 'model'])
    assert.equal((await post(url + '/api/models', {})).status, 405)
    for (const route of ['/api/analyze', '/api/analyze/stream', '/api/discuss', '/api/discuss/stream']) {
      const response = await post(url + route, {
        stage: 'understand', provider: 'glm', reasoningEffort: 'none',
        document: { name: 'doc', blocks: [{ id: '1', text: '业务说明。' }] },
        messages: [{ role: 'user', content: '解释' }],
      })
      if (!['/api/analyze/stream', '/api/discuss/stream'].includes(route)) assert.equal(response.status, 400)
      assert.match(await response.text(), /不支持所选思考强度/)
    }
    assert.equal(calls, 0)
  } finally {
    await close(server)
  }
})
