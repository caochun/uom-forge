import test from 'node:test'
import assert from 'node:assert/strict'
import { readSse } from './document.ts'
import {
  discussionText,
  isStageResult,
  parseAnalysisEvent,
} from './responses.ts'
import type { AnalysisEvent } from '../shared/analysis.ts'

test('design checkpoints accept free text and reject broken metadata without imposing document headings', () => {
  const value = { type: 'design-review', part: 'semantic', semanticPlan: '任意文本。', review: {
    status: 'checking', round: 1, rounds: [],
  } }
  assert.deepEqual(parseAnalysisEvent(value), value)
  assert.throws(() => parseAnalysisEvent({ ...value, review: { ...value.review, rounds: [null] } }), /无效事件/)
})

test('frontend consumes typed SSE split inside UTF-8 and detects a mismatched stage result', async () => {
  const data =
    'data: {"type":"delta","text":"业务说明"}\n\ndata: {"type":"result","result":{"narrative":"模型自述"}}'
  const bytes = new TextEncoder().encode(data)
  const response = new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 2)
          controller.enqueue(bytes.slice(i, i + 2))
        controller.close()
      },
    }),
  )
  const events: AnalysisEvent[] = []
  await readSse(response, (event) => events.push(event))
  assert.deepEqual(events[0], { type: 'delta', text: '业务说明' })
  const last = events.at(-1)
  assert.ok(last?.type === 'result')
  assert.equal(isStageResult('narrate', last.result), true)
  assert.equal(isStageResult('understand', last.result), false)
})

test('semantic plan events pass through the SSE boundary', () => {
  const semantic = { schemaVersion: '2', status: 'facts', facts: [], stories: [], mappings: [], boundaries: [], clarifications: [] }
  const event = parseAnalysisEvent({ type: 'semantic-plan', part: 'semantic', semantic })
  assert.deepEqual(event, { type: 'semantic-plan', part: 'semantic', semantic })
  assert.throws(() => parseAnalysisEvent({ type: 'semantic-plan', part: 'compile', semantic }), /无效事件/)
  assert.throws(
    () => parseAnalysisEvent({ type: 'semantic-plan', part: 'semantic', semantic: { ...semantic, facts: 'invalid' } }),
    /语义计划结构无效/,
  )
})
test('malformed transport envelopes and discussion failures are reported explicitly', () => {
  assert.throws(
    () => parseAnalysisEvent({ type: 'delta', text: 42 }),
    /无效事件/,
  )
  assert.throws(
    () => parseAnalysisEvent({ type: 'result', result: null }),
    /无效事件/,
  )
  assert.throws(() => discussionText({ error: '调用失败' }), /调用失败/)
  assert.throws(() => discussionText({}), /没有返回文本/)
  assert.equal(discussionText({ text: '业务解释' }), '业务解释')
})

test('business basis SSE accepts human-readable text without imposing a content schema', () => {
  const event = { type: 'business-basis', part: 'basis', text: '事实不要求编号，标题也可自由组织。' }
  assert.deepEqual(parseAnalysisEvent(event), event)
  assert.throws(() => parseAnalysisEvent({ ...event, text: [] }), /无效事件/)
})
