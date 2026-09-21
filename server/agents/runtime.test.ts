import test from 'node:test'
import assert from 'node:assert/strict'
import { runPiText } from './pi-text.ts'

for (const timeout of [undefined, '0']) {
  test(`Pi text keeps streaming beyond 300 seconds with timeout=${timeout}`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const config = {
      GLM_API_KEY: 'test-key',
      GLM_API_URL: 'https://glm.invalid/v4',
      GLM_REASONING_EFFORT: 'low',
      UOM_PI_TIMEOUT_MS: timeout,
    }
    const previous = Object.fromEntries(Object.keys(config).map(key => [key, process.env[key]]))
    for (const [key, value] of Object.entries(config)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    t.after(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    })
    let output!: ReadableStreamDefaultController<Uint8Array>
    const encode = new TextEncoder()
    const frame = (text: string, stop = false) => encode.encode(
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: stop ? 'stop' : null }] })}\n\n`,
    )
    t.mock.method(globalThis, 'fetch', async () => new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          output = controller
          output.enqueue(frame('开始整理。'))
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    ))
    let markStarted!: () => void
    const started = new Promise<void>(resolve => { markStarted = resolve })
    const result = runPiText('整理业务文档。', 'reading', {
      provider: 'glm',
      onEvent: event => { if (event.type === 'delta' && event.text) markStarted() },
    })
    await started
    t.mock.timers.tick(3600000)
    output.enqueue(frame('整理完成。', true))
    output.enqueue(encode.encode('data: [DONE]\n\n'))
    output.close()
    assert.equal(await result, '开始整理。整理完成。')
  })
}
