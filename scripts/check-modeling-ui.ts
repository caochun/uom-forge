import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, type Page } from 'playwright'
import type { AnalysisEvent, AnalysisRequest } from '../shared/analysis.ts'
import type { CandidateModel } from '../shared/model.ts'
import type { Project } from '../src/types.ts'
import { initialRevisions } from '../src/workspace.ts'

// Lightweight browser smoke test for the current four-stage workflow.
// It exercises the same SSE and local-draft boundary as the real page.
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const artifacts = await mkdtemp(path.join(tmpdir(), 'forge-ui-'))
const model: CandidateModel = {
  schemaVersion: '1', name: '订单模型', summary: '客户提交订单。',
  objects: [{ id: 'order', name: '订单', description: '客户提交的订单。', properties: [], evidence: [] }],
  relations: [], actions: [], functions: [], rules: [], boundaries: [],
}
const project: Project = {
  version: 4,
  document: { name: '回归验证.txt', content: '客户提交订单。', blocks: [{ id: 'B1', text: '客户提交订单。' }], size: '20 B', updated: '' },
  understanding: { narrative: '客户提交订单。', questions: [], warnings: [], sources: { documentName: '回归验证.txt', blocks: [{ id: 'B1', text: '客户提交订单。' }], citations: [] }, source: { narrative: '客户提交订单。', questions: [], warnings: [] }, confirmedAnswers: {} },
  answers: {}, questionsSaved: true, feedback: '', feedbackDocumentRevision: null,
  plan: { plan: '## 对象及边界\n订单。', businessBasis: '客户提交订单。', businessBasisComplete: true, complete: true, compiled: true, basis: { narrative: '客户提交订单。' } },
  candidate: { model, revision: 1, documentRevision: 1 },
  outputs: {}, timings: {}, revisions: initialRevisions, messages: [],
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
await page.evaluate(async () => {
  const harness = window as unknown as Harness
  const pending = fetch('/api/analyze/stream', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stage: 'model', provider: 'glm', narrative: '客户提交订单。' }),
  })
  for (let i = 0; i < 20 && !harness.emitModelEvent; i++) await new Promise(resolve => setTimeout(resolve, 10))
  harness.emitModelEvent({ type: 'business-basis', part: 'basis', text: '建模依据流。' })
  harness.emitModelEvent({ type: 'model-design', part: 'design', modelDesign: '模型设计流。', clarifications: [], warnings: [] })
  harness.emitModelEvent({ type: 'result', result: { modelDesign: '模型设计流。', businessBasis: '建模依据流。', clarifications: [], model: { schemaVersion: '1', name: '订单模型', summary: '客户提交订单。', objects: [{ id: 'order', name: '订单', description: '客户提交的订单。', properties: [], evidence: [] }], relations: [], actions: [], functions: [], rules: [], boundaries: [] }, provenance: { basis: 'business-understanding', evidence: 'unlinked' }, validation: { elements: 1, warnings: [] } } })
  await pending
})
assert.deepEqual(await page.evaluate(() => (window as unknown as Harness).lastModelRequest?.stage), 'model')
assert.equal(await page.getByRole('button', { name: /^建模依据/ }).count(), 1)
assert.equal(await page.getByRole('button', { name: /^模型设计/ }).count(), 1)
await page.screenshot({ path: path.join(artifacts, 'workflow.png'), fullPage: true })
await browser.close()
console.log(`UI checks passed. Screenshots: ${artifacts}`)
