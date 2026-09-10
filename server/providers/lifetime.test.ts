import test from 'node:test'
import assert from 'node:assert/strict'
import { createProgressDeadline } from './lifetime.ts'

const limits = { firstOutputMs: 100, idleMs: 30, totalMs: 300 }

test('ongoing output can pass the initial deadline; a stalled output still times out', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const deadline = createProgressDeadline(undefined, limits, 'Codex ACP')
  t.mock.timers.tick(80)
  deadline.output()
  for (let i = 0; i < 4; i++) {
    t.mock.timers.tick(25)
    assert.equal(deadline.signal.aborted, false)
    deadline.output()
  }
  t.mock.timers.tick(30)
  assert.equal(deadline.signal.aborted, true)
  assert.match(deadline.signal.reason.message, /输出中断/)
  deadline.dispose()
})

test('no output and an endless stream have separate finite limits', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const waiting = createProgressDeadline(undefined, limits, 'Codex ACP')
  t.mock.timers.tick(100)
  assert.equal(waiting.signal.aborted, true)
  assert.match(waiting.signal.reason.message, /等待首段输出超时/)
  waiting.dispose()

  const streaming = createProgressDeadline(undefined, limits, 'Codex ACP')
  for (let i = 0; i < 12; i++) {
    streaming.output()
    t.mock.timers.tick(25)
  }
  assert.equal(streaming.signal.aborted, true)
  assert.match(streaming.signal.reason.message, /总时限/)
  streaming.dispose()
})

test('cancellation keeps its reason and disposing clears both timers', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const controller = new AbortController()
  const deadline = createProgressDeadline(controller.signal, limits, 'Codex ACP')
  const reason = new DOMException('Stopped', 'AbortError')
  controller.abort(reason)
  assert.equal(deadline.signal.reason, reason)
  deadline.dispose()
  const completed = createProgressDeadline(undefined, limits, 'Codex ACP')
  completed.output()
  completed.dispose()
  t.mock.timers.tick(1000)
  assert.equal(completed.signal.aborted, false)
  assert.throws(() => createProgressDeadline(controller.signal, limits, 'Codex ACP'), error => error === reason)
})
