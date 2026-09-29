import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { runPiModeling as runPiModelingActual } from './pi-modeling.ts'
import { runPiText } from './pi-text.ts'
import { understandingPrompt } from '../stages/prompts.ts'
import type { StageEvent } from '../../shared/analysis.ts'
import { reviewModelClarifications } from '../../shared/clarifications.ts'
import { artifactVersion } from '../../shared/workflow.ts'
import { businessContextVersion } from '../stages/business-context.ts'
import { readDesignReview, interruptDesignReview } from '../../shared/design-review.ts'
import type { DesignAcceptance, DesignCheckReport } from '../../shared/design-acceptance.ts'
import { designCheckMarkdown } from '../validation/design-acceptance.ts'

const narrative = '只有审核通过的申请才能办理。'
const prepared = '业务事实：审核通过是办理前提。\n业务案例：申请未审核时不允许办理；审核通过后才可办理。'
const initial = '申请是独立对象，办理操作改变申请状态。'
const revised = '申请是独立对象，办理操作以审核通过为前提，然后改变申请状态。'
const acceptance: DesignAcceptance = { scope: '办理前提', scenario: '假设甲未通过、乙已通过审核，分别尝试办理。', outcome: '甲被前提阻止，乙的办理结果归属于乙的申请。', questions: [{ id: 'Q1', question: '办理是否以审核通过为前提？', kind: 'behavior',
  grounding: 'explicit', sourceQuote: narrative, reason: '已明确必要前提。', expected: '未通过不允许办理，通过后可办理。' }] }
const makeReport = (status: DesignCheckReport['answers'][number]['status'], issues: DesignCheckReport['issues'] = []): DesignCheckReport => ({
  summary: '核查本轮业务来源与办理前提。', answers: [{ questionId: 'Q1', status, sourceQuote: narrative,
    evidence: status === 'supported' ? [{ quote: '申请是独立对象', reason: '申请承载办理结果，前提见设计。' }] : [],
    scenario: '假设甲未通过审核、乙通过审核。', result: status === 'supported' ? '甲不允许办理，乙允许。' : '前提缺少定义。',
    gap: status === 'supported' ? '' : '办理前提未表达，应增加审核通过条件。' }], issues,
})
const basisIssue: DesignCheckReport['issues'][number] = { id: 'B1', type: 'basis', status: 'open', sourceQuote: narrative,
  problem: '依据遗漏办理许可，影响审核通过的申请。', acceptance: '依据补回许可并复查。', resolution: '等待校正依据。', evidence: [] }
const defectReport = makeReport('gap')
const passedReport = makeReport('supported')
const defect = JSON.stringify(defectReport)
const passed = JSON.stringify(passedReport)
const fix = JSON.stringify(makeReport('supported', [basisIssue]))
const defectText = designCheckMarkdown(defectReport, acceptance)
const passedText = designCheckMarkdown(passedReport, acceptance)
// Most tests exercise the existing Pi loop. Dedicated tests below exercise the
// new pre-design call as well, without mocking the loop or its validators.
const runPiModeling: typeof runPiModelingActual = (input, turn, options, basis) => runPiModelingActual(input,
  (prompt, turnOptions) => prompt.includes('任务：在模型设计开始前') ? Promise.resolve(JSON.stringify(acceptance)) : turn(prompt, turnOptions), options, basis)
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

test('the acceptance call precedes design and cannot see the candidate or expression feedback', async t => {
  configure(t)
  const events: StageEvent[] = []
  let preparedChecks = false
  let calls = 0
  const input = { narrative, currentModel: { privateCandidate: 'CANDIDATE_MARKER' }, feedback: 'FEEDBACK_MARKER' }
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    assert.ok(preparedChecks)
    calls++
    const body = JSON.parse(String(init.body))
    assert.ok(JSON.stringify(body.messages).includes('Q1'))
    return stream(revised, true)
  })
  const result = await runPiModelingActual(input, async (prompt, options) => {
    assert.equal(options.outputFormat, 'json')
    if (!preparedChecks) {
      assert.ok(prompt.includes('任务：在模型设计开始前'))
      assert.ok(!prompt.includes('CANDIDATE_MARKER') && !prompt.includes('FEEDBACK_MARKER'))
      assert.ok(!prompt.includes(revised))
      assert.ok(!prompt.includes(prepared), 'source questions do not inherit the extracted basis')
      options.onEvent?.({ type: 'delta', text: '验收准备阶段的内部思考', reasoning: true })
      preparedChecks = true
      return JSON.stringify(acceptance)
    }
    assert.ok(prompt.includes(JSON.stringify(acceptance)))
    return passed
  }, { provider: 'glm', onEvent: e => events.push(e) }, prepared)
  assert.equal(calls, 1)
  assert.deepEqual(result.designReview.acceptance, acceptance)
  assert.equal(result.designReview.acceptanceVersion, artifactVersion(acceptance))
  assert.equal(result.designReview.rounds[0].acceptanceVersion, artifactVersion(acceptance))
  assert.ok(events.some(e => e.type === 'design-review' && e.review.round === 0 && e.review.acceptance))
  assert.ok(!events.some(e => e.type === 'delta' && e.text === '验收准备阶段的内部思考'), 'acceptance preparation reasoning stays out of the design stream')
})

test('an incomplete checklist stops before design and cancellation preserves the preparation state', async t => {
  configure(t)
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('design must not start') })
  const events: StageEvent[] = []
  await assert.rejects(runPiModelingActual({ narrative }, async () => '{"questions":[]}', {
    provider: 'glm', onEvent: e => events.push(e),
  }, prepared), /验收清单未完成/)
  const last = events.filter(e => e.type === 'design-review').at(-1)
  assert.equal(last?.type === 'design-review' && last.review.reason, 'acceptance-unavailable')
  assert.ok(last?.type === 'design-review' && readDesignReview(last.review))
  const controller = new AbortController()
  await assert.rejects(runPiModelingActual({ narrative }, async () => {
    controller.abort(new Error('cancelled'))
    return JSON.stringify(acceptance)
  }, { provider: 'glm', signal: controller.signal, onEvent: e => events.push(e) }, prepared), /cancelled/)
  assert.ok(events.some(e => e.type === 'design-review' && e.review.round === 0 && e.review.reason === 'interrupted'))
})

test('missing answer or dropped historical issue stops as an invalid report, never a pass', async t => {
  configure(t)
  let designs = 0
  t.mock.method(globalThis, 'fetch', async () => stream(`${revised} 第${++designs}版`, true))
  const issue = { ...basisIssue, id: 'G1', type: 'model' as const }
  let checks = 0
  const result = await runPiModeling({ narrative }, async () => ++checks === 1
    ? JSON.stringify(makeReport('supported', [issue])) : passed, { provider: 'glm' }, prepared)
  assert.equal(result.designReview.reason, 'unrecognized')
  assert.equal(designs, 2)
  assert.match(result.designReview.rounds[1].validationError || '', /G1.*未复查/)
  assert.equal(result.designReview.rounds[1].rawReport, passed)
  const empty = await runPiModeling({ narrative }, async () => JSON.stringify({ ...passedReport, answers: [] }), { provider: 'glm' }, prepared)
  assert.equal(empty.designReview.reason, 'unrecognized')
  assert.match(empty.designReview.rounds[0].validationError || '', /覆盖/)
})

test('connection recovery stays within the same design round and resets failed review drafts', async t => {
  configure(t)
  let calls = 0
  const events: StageEvent[] = []
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    if (calls === 1) return new Response(frame({ reasoning_content: '旧思考' }) + frame({ content: '失败片段' }))
    return stream(initial, true)
  })
  const result = await runPiModeling({ narrative }, async (_prompt, options) => {
    options.onEvent?.({ type: 'delta', text: '失败审阅' })
    options.onEvent?.({ type: 'reset', text: '重新审阅' })
    options.onEvent?.({ type: 'delta', text: passed })
    return passed
  }, { provider: 'glm', onEvent: event => events.push(event) }, prepared)
  assert.equal(calls, 2)
  assert.equal(result.modelDesign, initial)
  assert.equal(result.designReview.round, 1)
  assert.equal(result.designReview.rounds.length, 1)
  assert.equal(result.designReview.rounds[0].feedback, passedText)
  assert.ok(events.some(e => e.type === 'reset' && e.part === 'design'))
  assert.ok(events.some(e => e.type === 'reset' && e.part === 'design-check'))
})

test('basis correction reaches the next Pi turn, rechecks an unchanged design and versions every review', async t => {
  configure(t)
  const corrected = '业务事实：审核通过是办理前提；允许多次办理。'
  const source = { documentName: '规则', complete: true, blocks: [{ id: 'original', text: '审核通过后可多次办理。' }], citations: [] }
  const input = { narrative, sources: source }
  const events: StageEvent[] = []
  let calls = 0
  let checks = 0
  const fixed = JSON.stringify(makeReport('supported', [{ ...basisIssue, status: 'resolved', resolution: '依据已补回许可。', evidence: [{ artifact: 'basis', quote: corrected, reason: '新版依据包含许可。' }] }]))
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    calls++
    const request = JSON.parse(String(init.body))
    if (calls === 2) assert.ok(request.messages.some((m: any) => m.role === 'tool' && m.content.includes(JSON.stringify(corrected))))
    return stream(revised, true)
  })
  const result = await runPiModeling(input, async prompt => {
    checks++
    assert.ok(prompt.includes(JSON.stringify(source.blocks)))
    if (checks === 2) {
      assert.ok(prompt.includes(JSON.stringify(corrected)))
      assert.ok(prompt.includes(JSON.stringify(prepared)), 'previous basis remains available for comparing expectations')
    }
    return checks === 1 ? fix : fixed
  }, { provider: 'glm', onEvent: event => events.push(event), agents: {
    text: async (prompt, part) => {
      assert.equal(part, 'basis')
      assert.ok(prompt.includes('依据遗漏办理许可'))
      assert.ok(prompt.includes(JSON.stringify(source.blocks)))
      return corrected
    },
  } }, prepared)
  assert.equal(result.businessBasis, corrected)
  assert.equal(result.designReview.reason, 'sufficient')
  assert.equal(result.designReview.round, 2)
  assert.equal(result.designReview.sourceVersion, businessContextVersion(input))
  assert.equal(result.designReview.businessBasisVersion, artifactVersion(corrected))
  assert.deepEqual(result.designReview.acceptance, acceptance, 'basis correction cannot delete or weaken the fixed questions')
  assert.ok(result.designReview.rounds.every(r => r.acceptanceVersion === artifactVersion(acceptance)))
  assert.deepEqual(result.designReview.rounds.map(r => r.businessBasisVersion), [artifactVersion(prepared), artifactVersion(corrected)])
  assert.deepEqual(readDesignReview(JSON.parse(JSON.stringify(result.designReview))), JSON.parse(JSON.stringify(result.designReview)))
  assert.equal(input.narrative, narrative)
  assert.equal(calls, 2)
  assert.equal(checks, 2)
  assert.ok(events.some(e => e.type === 'business-basis' && e.revised && e.text === corrected))
  const repairing = events.find(e => e.type === 'design-review' && e.review.status === 'repairing-basis')
  assert.equal(repairing?.type === 'design-review' && interruptDesignReview(repairing.review)?.reason, 'interrupted')
})

test('an unchanged basis correction stops without claiming success or emitting a corrected artifact', async t => {
  configure(t)
  const events: StageEvent[] = []
  t.mock.method(globalThis, 'fetch', async () => stream(initial, true))
  const result = await runPiModeling({ narrative }, async () => fix, {
    provider: 'glm', agents: { text: async () => prepared }, onEvent: e => events.push(e),
  }, prepared)
  assert.equal(result.designReview.reason, 'basis-unchanged')
  assert.equal(result.businessBasis, prepared)
  assert.equal(events.filter(e => e.type === 'business-basis').length, 0)
})

test('basis repairs share the three-review budget and do not repair after the final review', async t => {
  configure(t)
  let repairs = 0
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => stream(`${initial} ${++calls}`, true))
  const result = await runPiModeling({ narrative }, async () => fix, {
    provider: 'glm', agents: { text: async () => `${prepared} 校正 ${++repairs}` },
  }, prepared)
  assert.equal(calls, 3)
  assert.equal(repairs, 2)
  assert.equal(result.designReview.reason, 'limit')
  assert.equal(result.businessBasis, `${prepared} 校正 2`)
})

test('cancellation during basis correction preserves the old artifact and interrupts the review', async t => {
  configure(t)
  const controller = new AbortController()
  const events: StageEvent[] = []
  t.mock.method(globalThis, 'fetch', async () => stream(initial, true))
  await assert.rejects(runPiModeling({ narrative }, async () => fix, {
    provider: 'glm', signal: controller.signal, onEvent: e => events.push(e), agents: {
      text: async () => { controller.abort(new Error('cancelled')); return '未完成的校正' },
    },
  }, prepared), /cancelled/)
  assert.ok(!events.some(e => e.type === 'business-basis'))
  assert.ok(events.some(e => e.type === 'design-review' && e.review.reason === 'interrupted' && e.review.businessBasisVersion === artifactVersion(prepared)))
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
      assert.ok(body.messages.some((message: any) => message.role === 'tool' && message.content.includes(defectText)))
    }
    assert.ok(requests.length <= 2, 'no handoff/final summary turn')
    return stream(requests.length === 1 ? initial : revised, true)
  })
  let checks = 0
  const result = await runPiModeling({ narrative }, async (prompt, options) => {
    assert.equal(options.outputFormat, 'json')
    assert.ok(prompt.includes(JSON.stringify(prepared)))
    assert.ok(prompt.includes(narrative), 'review can cross-check the basis against saved understanding')
    checks++
    if (checks === 2) {
      assert.ok(prompt.includes(JSON.stringify(revised)))
      assert.ok(prompt.includes(JSON.stringify(defectText)))
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
    assert.ok(userText.includes(narrative))
  }
  assert.equal(requests.length, 2)
  assert.equal(checks, 2)
  assert.ok(!events.some(event => event.type === 'delta' && event.part === 'design-check' && !event.reasoning), 'raw JSON is not streamed into the UI')
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
    if (calls === 2) assert.ok(body.messages.some((m: any) => m.role === 'user' && m.content.includes(defectText)))
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
  const result = await runPiModeling({ narrative }, async () => JSON.stringify(makeReport('clarify')), { provider: 'glm' }, prepared)
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
  assert.equal(result.designReview.rounds[0].rawReport, '这份设计可能还需要补充前提。')
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
  assert.equal(result.designReview.failure, 'must not call')
  assert.equal(readDesignReview(result.designReview)?.failure, 'must not call')
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
