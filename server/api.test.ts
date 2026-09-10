import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { createApiMiddleware } from './api.ts'
import type { RunTurn } from './providers/types.ts'
import type { AnalysisEvent } from '../shared/analysis.ts'

async function serve(runTurn: RunTurn) {
  const middleware = createApiMiddleware(runTurn)
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
    assert.equal(options.signal?.aborted, false)
    options.onEvent?.({
      type: 'timing',
      timing: {
        callId: 'reading-call',
        provider: 'codex',
        model: 'test-model',
        startedAt: new Date().toISOString(),
        promptCharacters: prompt.length,
        outputCharacters: 0,
        elapsedMs: 3,
        sessionReadyMs: 3,
        status: 'running',
      },
    })
    options.onEvent?.({ type: 'delta', text: '## 业务概述\n说明。' })
    return '## 业务概述\n说明。'
  })
  try {
    const response = await post(url + '/api/analyze/stream', {
      stage: 'understand',
      provider: 'codex',
      document: { name: 'doc', blocks: [{ id: '1', text: 'DOCUMENT_ONLY' }] },
    })
    const output = events(await response.text())
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
          event.timing.sessionReadyMs === 3,
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
