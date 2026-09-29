import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, type Page } from 'playwright'
import type { AnalysisEvent, AnalysisRequest } from '../shared/analysis.ts'
import type { CandidateModel } from '../shared/model.ts'
import type { Project } from '../src/types.ts'
import { initialRevisions } from '../src/workspace.ts'
import type { DesignAcceptance, DesignCheckReport } from '../shared/design-acceptance.ts'
import { artifactVersion } from '../shared/workflow.ts'

// Lightweight browser smoke test for the current four-stage workflow.
// It exercises the same SSE and local-draft boundary as the real page.
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const artifacts = await mkdtemp(path.join(tmpdir(), 'forge-ui-'))
const acceptance: DesignAcceptance = { scope: '订单归属', scenario: '假设甲提交订单。', outcome: '订单归属甲。', questions: [{ id: 'Q1', question: '订单能否归属提交客户？', kind: 'result',
  grounding: 'explicit', sourceQuote: '客户提交订单。', reason: '需要表达提交归属。', expected: '订单与提交客户明确关联。' }] }
const acceptanceState = { acceptance, acceptanceVersion: artifactVersion(acceptance) }
const report: DesignCheckReport = { summary: '已复查订单归属与取消许可。', answers: [{ questionId: 'Q1', status: 'supported',
  sourceQuote: '客户提交订单。', evidence: [{ quote: '模型设计流。', reason: '本浏览器测试模拟定义证据。' }],
  scenario: '假设客户甲提交订单。', result: '订单归属甲。', gap: '' }], issues: [] }
const model: CandidateModel = {
  schemaVersion: '1', name: '订单模型', summary: '客户提交订单。',
  objects: [{ id: 'order', name: '订单', description: '客户提交的订单。', properties: [], evidence: [] }],
  relations: [], actions: [], functions: [], rules: [], boundaries: [],
}
const project: Project = {
  version: 4,
  document: { name: '回归验证.txt', content: '客户提交订单。', blocks: [{ id: 'B1', text: '客户提交订单。' }], size: '20 B', updated: '' },
  understanding: { narrative: '客户提交订单。', questions: [], warnings: [], sources: { documentName: '回归验证.txt', complete: true, blocks: [{ id: 'B1', text: '客户提交订单。' }, { id: 'B2', text: '订单允许取消。' }], citations: [] }, source: { narrative: '客户提交订单。', questions: [], warnings: [], sources: { documentName: '回归验证.txt', complete: true, blocks: [{ id: 'B1', text: '客户提交订单。' }, { id: 'B2', text: '订单允许取消。' }], citations: [] } }, confirmedAnswers: {} },
  answers: {}, questionsSaved: true, feedback: '', feedbackDocumentRevision: null,
  plan: { plan: '## 对象及边界\n订单。', businessBasis: '客户提交订单。', businessBasisComplete: true, complete: true, compiled: true, basis: { narrative: '客户提交订单。' } },
  candidate: { model, revision: 1, documentRevision: 1 },
  outputs: {}, timings: {}, revisions: { ...initialRevisions, understoodDocument: 0, planBasis: 0, candidateBasis: 0 }, messages: [],
}
type Harness = Window & { emitModelEvent: (event: AnalysisEvent) => void; lastModelRequest?: AnalysisRequest }
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
await context.addInitScript(saved => {
  localStorage.setItem('uom-forge-project-v3', JSON.stringify(saved))
  const original = window.fetch.bind(window)
  window.fetch = (input, options) => {
    if (!String(input).includes('/api/analyze/stream')) return original(input, options)
    const harness = window as unknown as Harness
    harness.lastModelRequest = JSON.parse(String(options?.body))
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        harness.emitModelEvent = event => {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
          if (event.type === 'result' || event.type === 'error') controller.close()
        }
      },
    })
    return Promise.resolve(new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
  }
}, project)
const page = await context.newPage()
await page.goto(url)
await page.getByText('业务理解', { exact: true }).click()
await page.getByText('建模', { exact: true }).click()
await page.getByRole('button', { name: /^建模依据/ }).click()
await page.getByRole('button', { name: /^模型设计/ }).click()
await page.getByRole('button', { name: /^模型视图/ }).click()
// Drive the actual React action so the SSE is consumed by the page.
await page.getByRole('button', { name: '重新建模', exact: true }).first().click()
await page.waitForFunction(() => !!(window as unknown as Harness).emitModelEvent)
const emit = (event: AnalysisEvent) => page.evaluate(event => (window as unknown as Harness).emitModelEvent(event), event)
const savedPlan = () => page.evaluate(() => JSON.parse(localStorage.getItem('uom-forge-project-v3') || '{}').plan)
await emit({ type: 'phase', part: 'basis', text: '正在生成建模依据' })
await emit({ type: 'delta', part: 'basis', text: '失败依据片段' })
await page.waitForFunction(() => JSON.parse(localStorage.getItem('uom-forge-project-v3') || '{}').plan?.businessBasis === '失败依据片段')
await emit({ type: 'reset', part: 'basis', text: '连接中断，正在重试 1/2' })
await emit({ type: 'delta', part: 'basis', text: '建模依据流。' })
await emit({ type: 'delta', part: 'basis', text: '旧依据思考。', reasoning: true })
await emit({ type: 'business-basis', part: 'basis', text: '建模依据流。' })
await emit({ type: 'design-review', part: 'design', review: { status: 'preparing-checks', round: 0, rounds: [] } })
await emit({ type: 'phase', part: 'design-check', text: '正在从业务来源确定验收问题' })
await emit({ type: 'design-review', part: 'design', review: { ...acceptanceState, status: 'preparing-checks', round: 0, rounds: [] } })
await page.waitForFunction(() => JSON.parse(localStorage.getItem('uom-forge-project-v3') || '{}').plan?.designReview?.acceptance?.questions.length === 1)
await emit({ type: 'design-review', part: 'design', review: { ...acceptanceState, status: 'drafting', round: 1, rounds: [] } })
await emit({ type: 'phase', part: 'design', text: '正在生成设计草案' })
await emit({ type: 'delta', part: 'design', text: '失败设计片段' })
await page.waitForFunction(() => JSON.parse(localStorage.getItem('uom-forge-project-v3') || '{}').plan?.designDraft === '失败设计片段')
await emit({ type: 'reset', part: 'design', text: '连接中断，正在重试 1/2' })
await emit({ type: 'delta', part: 'design', text: '模型设计流。' })
await page.waitForFunction(() => JSON.parse(localStorage.getItem('uom-forge-project-v3') || '{}').plan?.designDraft === '模型设计流。')
assert.equal((await savedPlan()).businessBasis, '建模依据流。')
assert.equal((await savedPlan()).designReview.round, 1)
await emit({ type: 'design-review', part: 'design', modelDesign: '模型设计流。', review: { ...acceptanceState, status: 'checking', round: 1, rounds: [] } })
await emit({ type: 'phase', part: 'design-check', text: '正在检查设计' })
await emit({ type: 'delta', part: 'design-check', text: '失败检查片段' })
await page.waitForFunction(() => JSON.parse(localStorage.getItem('uom-forge-project-v3') || '{}').plan?.designReview.feedbackDraft === '失败检查片段')
await emit({ type: 'reset', part: 'design-check', text: '连接中断，正在重试 1/2' })
await emit({ type: 'delta', part: 'design-check', text: '结论：可表达' })
await page.waitForFunction(() => JSON.parse(localStorage.getItem('uom-forge-project-v3') || '{}').plan?.designReview.feedbackDraft === '结论：可表达')
assert.equal((await savedPlan()).plan, '模型设计流。')
const firstRound = { design: '模型设计流。', feedback: '结论：需校正依据\n遗漏原文取消许可。', verdict: 'basis-revise' as const, businessBasis: '建模依据流。' }
await emit({ type: 'design-review', part: 'design', review: { ...acceptanceState, status: 'repairing-basis', round: 1, rounds: [firstRound] } })
await emit({ type: 'phase', part: 'basis', text: '正在根据业务来源校正建模依据。' })
await emit({ type: 'delta', part: 'basis', text: '未完成的校正' })
await emit({ type: 'reset', part: 'basis', text: '连接中断，正在重试 1/2' })
assert.equal((await savedPlan()).businessBasis, '建模依据流。', 'a failed correction cannot erase the complete old basis')
await emit({ type: 'business-basis', part: 'basis', text: '校正依据：客户提交订单，允许取消。', revised: true })
await emit({ type: 'design-review', part: 'design', review: { ...acceptanceState, status: 'drafting', round: 2, rounds: [firstRound] } })
await emit({ type: 'phase', part: 'design', text: '正在修订设计。' })
await emit({ type: 'design-review', part: 'design', modelDesign: '模型设计流。', review: { ...acceptanceState, status: 'checking', round: 2, rounds: [firstRound] } })
const finalReview = { ...acceptanceState, status: 'completed' as const, reason: 'sufficient' as const, round: 2,
  rounds: [firstRound, { design: '模型设计流。', feedback: '结论：可表达', verdict: 'sufficient' as const, report, acceptanceVersion: acceptanceState.acceptanceVersion, businessBasis: '校正依据：客户提交订单，允许取消。' }] }
await emit({ type: 'design-review', part: 'design', review: finalReview })
await emit({ type: 'model-design', part: 'design', modelDesign: '模型设计流。', clarifications: [], warnings: [] })
await emit({ type: 'phase', part: 'compile', text: '正在整理候选模型' })
const timing = { provider: 'glm' as const, model: 'test', startedAt: new Date().toISOString(), promptCharacters: 20, outputCharacters: 0, elapsedMs: 0 }
await emit({ type: 'timing', part: 'compile', timing: { ...timing, callId: 'first', status: 'running' } })
await emit({ type: 'delta', part: 'compile', text: '失败编译片段' })
await page.waitForFunction(() => JSON.parse(localStorage.getItem('uom-forge-project-v3') || '{}').plan?.compilation?.text === '失败编译片段')
await emit({ type: 'timing', part: 'compile', timing: { ...timing, callId: 'first', status: 'failed' } })
await emit({ type: 'reset', part: 'compile', text: '连接中断，正在重试 1/2' })
await emit({ type: 'timing', part: 'compile', timing: { ...timing, callId: 'second', status: 'running' } })
await emit({ type: 'delta', part: 'compile', text: JSON.stringify(model) })
await page.waitForFunction(() => JSON.parse(localStorage.getItem('uom-forge-project-v3') || '{}').plan?.compilation?.text.startsWith('{'))
assert.equal((await savedPlan()).plan, '模型设计流。')
assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('uom-forge-project-v3') || '{}').outputs.model.includes('失败')), false)
await emit({ type: 'timing', part: 'compile', timing: { ...timing, callId: 'second', status: 'completed', outputCharacters: JSON.stringify(model).length } })
await emit({ type: 'result', result: { modelDesign: '模型设计流。', businessBasis: '校正依据：客户提交订单，允许取消。', designReview: finalReview, clarifications: [], model, provenance: { basis: 'business-understanding', evidence: 'unlinked' }, validation: { elements: 1, warnings: [] } } })
await page.waitForFunction(() => JSON.parse(localStorage.getItem('uom-forge-project-v3') || '{}').plan?.compilation?.status === 'completed')
assert.equal(await page.getByText('模型生成未完成 · 已保留部分输出', { exact: true }).count(), 0)
assert.deepEqual(await page.evaluate(() => (window as unknown as Harness).lastModelRequest?.stage), 'model')
const request = await page.evaluate(() => (window as unknown as Harness).lastModelRequest)
assert.deepEqual(request?.stage === 'model' && request.sources, project.understanding?.sources)
assert.equal((await savedPlan()).businessBasis, '校正依据：客户提交订单，允许取消。')
assert.equal((await savedPlan()).businessBasisReasoning, undefined, 'old reasoning must not appear as the explanation of a new basis')
assert.deepEqual((await savedPlan()).designReview.rounds, finalReview.rounds)
assert.deepEqual((await savedPlan()).designReview.acceptance, acceptance)
assert.equal(await page.getByRole('button', { name: /^建模依据/ }).count(), 1)
assert.equal(await page.getByRole('button', { name: /^模型设计/ }).count(), 1)
await page.getByRole('button', { name: /^模型设计/ }).click()
await page.locator('summary').filter({ hasText: '本轮检查情形可表达' }).click()
await page.getByText('本次业务验收问题 · 1 项', { exact: true }).click()
await page.getByText('Q1 · 订单能否归属提交客户？', { exact: true }).waitFor({ state: 'visible' })
await page.screenshot({ path: path.join(artifacts, 'workflow.png'), fullPage: true })
await browser.close()
console.log(`UI checks passed. Screenshots: ${artifacts}`)
