import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { runPiModeling } from './pi-modeling.ts'
import { runPiText } from './pi-text.ts'
import { understandingPrompt } from '../stages/prompts.ts'
import { designVerdict } from '../stages/design-review.ts'
import type { StageEvent } from '../../shared/analysis.ts'
import { reviewModelClarifications } from '../../shared/clarifications.ts'
import { artifactVersion } from '../../shared/workflow.ts'

const narrative = '只有审核通过的申请才能办理。'
const prepared = '业务事实：审核通过是办理前提。\n业务案例：申请未审核时不允许办理；审核通过后才可办理。'
const initial = '申请是独立对象，办理操作改变申请状态。'
const revised = '申请是独立对象，办理操作以审核通过为前提，然后改变申请状态。'
const defect = '结论：需修改\n业务案例：申请未审核就办理。业务说明要求审核通过，但办理操作缺少前提，应增加审核通过条件。'
const passed = '结论：可表达\n复查：未通过审核的申请被办理前提阻止；已通过审核的申请可以办理，结果属于该申请。'
const frame = (delta: unknown, reason: string | null = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: reason }] })}\n\n`
const stream = (content: string, tool = false, reason?: string) => new Response(
  frame({ content }, tool ? null : reason || 'stop') + (tool ? frame({ tool_calls: [{ index: 0, id: 'call-check', type: 'function', function: { name: 'check_expression', arguments: '{}' } }] }, 'tool_calls') : '') + 'data: [DONE]\n\n',
  { headers: { 'content-type': 'text/event-stream' } },
)
function configure(t: TestContext) {
  const values = { GLM_API_KEY: 'pi-test', GLM_API_URL: 'https://glm.invalid/v4', GLM_MODEL: 'glm-test', GLM_REASONING_EFFORT: 'low' }
  const old = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]))
  Object.assign(process.env, values)
  t.after(() => {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
}
const noTurn = async () => { throw new Error('must not call') }

test('design review recognizes common Chinese revision conclusions', () => {
  assert.equal(designVerdict('结论：可表达\n已能表达该业务案例。'), 'sufficient')
  assert.equal(designVerdict('结论：需要修改\n运行状态没有明确归属。'), 'revise')
  assert.equal(designVerdict('结论：存在缺口\n多个实例无法区分。'), 'revise')
  assert.equal(designVerdict('结论：需业务澄清\n边界影响模型选择。'), 'clarify')
  assert.equal(designVerdict('这份设计可能还需要补充前提。'), 'unknown')
})

test('Pi tool loop checks, revises and replays feedback, then exits without a finish turn', async t => {
  configure(t)
  const requests: any[] = []
  const events: StageEvent[] = []
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    requests.push(body)
    assert.deepEqual(body.tools.map((tool: any) => tool.function.name), ['check_expression'])
    if (requests.length === 2) {
      assert.ok(body.messages.some((message: any) => message.role === 'tool' && message.content.includes(defect)))
    }
    assert.ok(requests.length <= 2, 'no handoff/final summary turn')
    return stream(requests.length === 1 ? initial : revised, true)
  })
  let checks = 0
  const result = await runPiModeling({ narrative }, async (prompt, options) => {
    assert.equal(options.outputFormat, undefined)
    assert.ok(prompt.includes(JSON.stringify(prepared)))
    assert.ok(!prompt.includes(narrative), 'review and design use the same basis without re-sending document reading')
    checks++
    if (checks === 2) {
      assert.ok(prompt.includes(JSON.stringify(revised)))
      assert.ok(prompt.includes(JSON.stringify(defect)))
      assert.ok(prompt.includes(JSON.stringify(initial)), 'review can compare prior design, not just trust the stated edits')
    }
    options.onEvent?.({ type: 'delta', text: checks === 1 ? defect : passed })
    return checks === 1 ? defect : passed
  }, { provider: 'glm', onEvent: event => events.push(event) }, prepared)
  assert.equal(result.modelDesign, revised)
  assert.equal(result.designReview.status, 'completed')
  assert.equal(result.designReview.rounds.length, 2)
  assert.equal(result.designReview.businessBasisVersion, artifactVersion(prepared))
  for (const request of requests) {
    const userText = request.messages.filter((message: any) => message.role === 'user').map((message: any) =>
      typeof message.content === 'string' ? message.content : message.content.map((part: any) => part.text || '').join('')).join('\n')
    assert.ok(userText.includes(JSON.stringify(prepared)))
    assert.ok(!userText.includes(narrative))
  }
  assert.equal(requests.length, 2)
  assert.equal(checks, 2)
  assert.ok(events.some(event => event.type === 'delta' && event.part === 'design-check' && event.text === defect))
  const checkpoints = events.filter(event => event.type === 'design-review' && event.modelDesign)
  assert.ok(checkpoints.some(event => event.type === 'design-review' && event.modelDesign === initial))
  assert.ok(checkpoints.some(event => event.type === 'design-review' && event.modelDesign === revised))
  assert.equal(checkpoints[0].type === 'design-review' && checkpoints[0].review.rounds.length, 0, 'events are snapshots, not mutable aliases')
})

test('a plain text response is reviewed without an extra tool handoff, and feedback can drive the next Pi turn', async t => {
  configure(t)
  let calls = 0
  let checks = 0
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    calls++
    if (calls === 2) assert.ok(body.messages.some((m: any) => m.role === 'user' && m.content.includes(defect)))
    return stream(calls === 1 ? initial : revised)
  })
  const result = await runPiModeling({ narrative }, async () => ++checks === 1 ? defect : passed, { provider: 'glm' }, prepared)
  assert.equal(calls, 2)
  assert.equal(checks, 2)
  assert.equal(result.designReview.status, 'completed')
})

test('flexible headings and grounded questions are retained without format repair', async t => {
  configure(t)
  let calls = 0
  const draft = `## 我的设计\n${revised}\n\n## 需要补充的业务信息\n1. 审核通过后是否需要复核？\n依据：“业务事实：审核通过是办理前提。”\n歧义：通过即办理，或仍需复核。\n影响：改变办理前提。\n选项：立即办理；先复核`
  t.mock.method(globalThis, 'fetch', async () => { calls++; return stream(draft, true) })
  const result = await runPiModeling({ narrative }, async () => '结论：业务待澄清\n是否复核需由业务确认；不能自行增加复核规则。', { provider: 'glm' }, prepared)
  assert.equal(result.modelDesign, draft)
  assert.equal(calls, 1)
  assert.equal(result.designReview.reason, 'clarify')
  assert.equal(reviewModelClarifications(result.modelDesign, narrative, prepared).clarifications[0].basisSource, 'business-basis')
})

test('unrecognized review text is preserved for people without regeneration or a false pass', async t => {
  configure(t)
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return stream(initial, true) })
  const result = await runPiModeling({ narrative }, async () => '这份设计可能还需要补充前提。', { provider: 'glm' }, prepared)
  assert.equal(calls, 1)
  assert.equal(result.designReview.reason, 'unrecognized')
  assert.equal(result.designReview.rounds[0].feedback, '这份设计可能还需要补充前提。')
})

test('design revisions stop at three rounds and retain the latest complete design', async t => {
  configure(t)
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => stream(`${initial}\n修订 ${++calls}`, true))
  const result = await runPiModeling({ narrative }, async () => defect, { provider: 'glm' }, prepared)
  assert.equal(calls, 3)
  assert.equal(result.designReview.reason, 'limit')
  assert.equal(result.designReview.rounds.length, 3)
  assert.match(result.modelDesign, /修订 3/)
})

test('an unchanged design stops without paying for the same review again', async t => {
  configure(t)
  let calls = 0
  let checks = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return stream(initial, true) })
  const result = await runPiModeling({ narrative }, async () => { checks++; return defect }, { provider: 'glm' }, prepared)
  assert.equal(calls, 2)
  assert.equal(checks, 1)
  assert.equal(result.designReview.reason, 'no-progress')
})

test('review service failure retains the design and does not block compilation', async t => {
  configure(t)
  t.mock.method(globalThis, 'fetch', async () => stream(initial, true))
  const result = await runPiModeling({ narrative }, noTurn, { provider: 'glm' }, prepared)
  assert.equal(result.modelDesign, initial)
  assert.equal(result.designReview.reason, 'unavailable')
})

test('a truncated revision cannot replace the last complete design', async t => {
  configure(t)
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => ++calls === 1 ? stream(initial, true) : stream('半份设计', false, 'length'))
  const result = await runPiModeling({ narrative }, async () => defect, { provider: 'glm' }, prepared)
  assert.equal(result.modelDesign, initial)
  assert.equal(calls, 2)
  assert.equal(result.designReview.status, 'attention')
})

test('cancellation in the reviewer stops the loop but publishes the complete draft first', async t => {
  configure(t)
  const controller = new AbortController()
  const events: StageEvent[] = []
  t.mock.method(globalThis, 'fetch', async () => stream(initial, true))
  await assert.rejects(runPiModeling({ narrative }, async (_prompt, options) => {
    controller.abort(new Error('cancelled'))
    options.signal?.throwIfAborted()
    return passed
  }, { provider: 'glm', signal: controller.signal, onEvent: event => events.push(event) }, prepared), /cancelled/)
  assert.ok(events.some(event => event.type === 'design-review' && event.modelDesign === initial))
})

test('cancelled modeling does not start a request', async t => {
  configure(t)
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not fetch') })
  const controller = new AbortController()
  controller.abort(new Error('cancelled'))
  await assert.rejects(runPiModeling({ narrative }, noTurn, { provider: 'glm', signal: controller.signal }, prepared), /cancelled/)
})

test('Pi understanding remains one flexible text generation without reviewer or format retries', async t => {
  configure(t)
  const draft = '可以多次登记。 [[source:B1]]'
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return stream(draft) })
  assert.equal(await runPiText(understandingPrompt({ name: 'test', blocks: [{ id: 'B1', text: '可以多次登记。' }] }), 'reading', { provider: 'glm' }), draft)
  assert.equal(calls, 1)
})
