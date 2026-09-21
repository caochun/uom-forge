import test from 'node:test'
import assert from 'node:assert/strict'
import { createDeadline, createProgressDeadline, timeoutFromEnv } from './lifetime.ts'

const limits = { firstOutputMs: 100, idleMs: 30, totalMs: 300 }

test('execution deadlines default to unlimited and zero disables an explicit fallback', () => {
  for (const value of [undefined, '', ' ', 'invalid', '-1', 'Infinity', '0'])
    assert.equal(timeoutFromEnv(value), 0)
  assert.equal(timeoutFromEnv('0', 300000), 0)
  assert.equal(timeoutFromEnv(undefined, 300000), 300000)
  assert.equal(timeoutFromEnv('', 300000), 300000)
  assert.equal(timeoutFromEnv('600000'), 600000)
})

test('unlimited execution still supports caller cancellation and rejects an already cancelled caller', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const controller = new AbortController()
  const deadline = createDeadline(controller.signal, 0, '生成')
  t.mock.timers.tick(3600000)
  assert.equal(deadline.signal.aborted, false)
  const reason = new DOMException('Stopped', 'AbortError')
  controller.abort(reason)
  assert.equal(deadline.signal.reason, reason)
  deadline.dispose()
  assert.throws(() => createDeadline(controller.signal, 0, '生成'), error => error === reason)
})

test('explicit experiment deadlines still expire and can be disposed', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const deadline = createDeadline(undefined, 300000, '生成')
  const disposed = createDeadline(undefined, 300000, '生成')
  disposed.dispose()
  t.mock.timers.tick(300000)
  assert.match(deadline.signal.reason.message, /生成超时（超过 300 秒）/)
  assert.equal(disposed.signal.aborted, false)
  deadline.dispose()
})

test('zero also disables progress deadlines without changing cancellation', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const deadline = createProgressDeadline(undefined, { firstOutputMs: 0, idleMs: 0, totalMs: 0 }, 'ACP')
  t.mock.timers.tick(3600000)
  deadline.output()
  t.mock.timers.tick(3600000)
  assert.equal(deadline.signal.aborted, false)
  deadline.dispose()
})

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
