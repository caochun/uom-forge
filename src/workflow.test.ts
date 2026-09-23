import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAnalysisEvent } from './responses.ts'

test('removed workflow events are rejected at the SSE boundary', () => {
  assert.throws(() => parseAnalysisEvent({ type: 'model-checkpoint', model: {} }), /无效事件/)
  assert.throws(() => parseAnalysisEvent({ type: 'removed-plan', payload: {} }), /无效事件/)
})
