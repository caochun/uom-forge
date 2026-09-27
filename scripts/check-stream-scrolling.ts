import assert from 'node:assert/strict'
import { chromium, type Locator } from 'playwright'
import type { AnalysisEvent } from '../shared/analysis.ts'
import type { Project } from '../src/types.ts'

// Drive the real workbench through its SSE reader without calling a model API.
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const narrative = '客户提交申请，审核通过后办理。'
const project: Project = {
  version: 4,
  document: { name: '滚动验证.txt', content: narrative, blocks: [{ id: 'B1', text: narrative }], size: '40 B', updated: '' },
  understanding: { narrative, questions: [], warnings: [], source: { narrative, questions: [], warnings: [] }, confirmedAnswers: {} },
  answers: {}, questionsSaved: true, feedback: '', feedbackDocumentRevision: null,
  plan: null, candidate: null, outputs: {}, timings: {}, messages: [],
  revisions: { document: 1, understoodDocument: 1, business: 1, planBasis: null, candidateBasis: null, model: 0 },
}
type Harness = Window & { emitModelEvent: (event: AnalysisEvent) => void }
const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 800 } })
  await context.addInitScript(saved => {
    localStorage.setItem('uom-forge-project-v3', JSON.stringify(saved))
    const original = window.fetch.bind(window)
    window.fetch = (input, options) => {
      if (!String(input).includes('/api/analyze/stream')) return original(input, options)
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          (window as unknown as Harness).emitModelEvent = event => {
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
            if (event.type === 'result' || event.type === 'error') controller.close()
          }
        },
      })
      return Promise.resolve(new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
    }
  }, project)
  const page = await context.newPage()
  page.setDefaultTimeout(5000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url)
  await page.getByRole('navigation', { name: '工作区' }).getByRole('button', { name: /业务理解/ }).click()
  await page.getByRole('button', { name: '开始建模', exact: true }).click()
  await page.waitForFunction(() => typeof (window as unknown as Harness).emitModelEvent === 'function')
  const emit = async (event: AnalysisEvent) => {
    await page.evaluate(event => (window as unknown as Harness).emitModelEvent(event), event)
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  }
  await emit({ type: 'business-basis', part: 'basis', text: narrative })
  await emit({ type: 'phase', part: 'design', text: '正在生成模型设计。' })
  const review = { status: 'drafting' as const, round: 1, rounds: [], narrativeVersion: 'test' }
  await emit({ type: 'design-review', part: 'design', review })
  await page.getByRole('group', { name: '建模工作区内容' }).getByRole('button', { name: /^模型设计/ }).click()
  await emit({ type: 'delta', part: 'design', reasoning: true, text: '思考申请的主体、前提和结果归属。\n'.repeat(100) })

  const main = page.locator('.main-content')
  const thinking = page.getByRole('region', { name: '模型思考过程', exact: true })
  const top = (element: Locator) => element.evaluate(node => node.scrollTop)
  const bottom = (element: Locator) => element.evaluate(node => node.scrollTop = node.scrollHeight)
  const wheel = async (element: Locator, amount: number) => {
    await element.hover()
    await page.mouse.wheel(0, amount)
    // Wait for the browser's asynchronous wheel/scroll events to settle.
    await page.waitForTimeout(120)
  }
  const failures: string[] = []
  const check = async (name: string, run: () => Promise<void>) => {
    try { await run(); console.log(`PASS ${name}`) }
    catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`) }
  }

  await check('small upward scroll stays in place when more reasoning arrives', async () => {
    await bottom(thinking)
    await wheel(thinking, -12)
    const before = await top(thinking)
    await emit({ type: 'delta', part: 'design', reasoning: true, text: '新增思考输出。\n'.repeat(10) })
    assert.ok(Math.abs(await top(thinking) - before) <= 1, 'new output pulled the reader back to the bottom')
  })
  await check('returning to the bottom resumes following reasoning', async () => {
    await wheel(thinking, 100000)
    await emit({ type: 'delta', part: 'design', reasoning: true, text: '继续思考。\n' })
    const remaining = await thinking.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)
    assert.ok(remaining <= 1)
  })

  const design = Array.from({ length: 100 }, (_, index) => `### 业务定义 ${index + 1}\n\n申请应保留审核条件和结果归属。\n\n`).join('')
  await emit({ type: 'delta', part: 'design', text: design })
  const details = page.locator('.reading-reasoning')
  await details.locator('summary').click()
  await check('wheel at the top of reasoning scrolls the outer workbench', async () => {
    await main.evaluate(node => node.scrollTop = 200)
    await thinking.evaluate(node => node.scrollTop = 0)
    const before = await top(main)
    await wheel(thinking, -100)
    assert.ok(await top(main) < before - 20, 'reasoning panel trapped upward page scrolling')
  })
  await check('wheel at the bottom of reasoning scrolls the outer workbench', async () => {
    await main.evaluate(node => node.scrollTop = 200)
    await wheel(thinking, 100000)
    await page.waitForTimeout(300)
    const before = await top(main)
    await wheel(thinking, 100)
    const after = await top(main)
    assert.ok(after > before + 20, `reasoning panel trapped downward page scrolling (${before} -> ${after})`)
  })
  await check('design text remains scrollable and keeps the reading position during streaming', async () => {
    await main.evaluate(node => node.scrollTop = 900)
    await page.mouse.move(500, 600)
    await page.mouse.wheel(0, 200)
    await page.waitForTimeout(120)
    const before = await top(main)
    assert.ok(before > 1000)
    await emit({ type: 'delta', part: 'design', text: '\n\n新的模型定义。\n'.repeat(10) })
    assert.ok(Math.abs(await top(main) - before) <= 1)
  })

  await emit({ type: 'model-design', part: 'design', modelDesign: design, clarifications: [], warnings: [] })
  await emit({ type: 'phase', part: 'compile', text: '正在编译模型。' })
  await emit({ type: 'delta', part: 'compile', text: '{"description":"部分模型输出"}\n'.repeat(100) })
  await page.getByRole('group', { name: '建模工作区内容' }).getByRole('button', { name: /^模型视图/ }).click()
  const compiled = page.getByRole('region', { name: '模型 JSON 实时输出', exact: true })
  await check('small upward scroll pauses following compilation output', async () => {
    await wheel(compiled, -12)
    const before = await top(compiled)
    await emit({ type: 'delta', part: 'compile', text: '{"description":"新增输出"}\n'.repeat(10) })
    assert.ok(Math.abs(await top(compiled) - before) <= 1)
  })

  const model = { schemaVersion: '1' as const, name: '申请', summary: narrative, objects: [], relations: [], actions: [], functions: [], rules: [], boundaries: [] }
  await emit({ type: 'result', result: { modelDesign: design, businessBasis: narrative, model, clarifications: [],
    provenance: { basis: 'business-understanding', evidence: 'unlinked' }, validation: { elements: 0, warnings: [] } } })
  await page.getByRole('navigation', { name: '工作区' }).getByRole('button', { name: /模型检验/ }).click()
  await page.getByRole('button', { name: '检查业务案例', exact: true }).click()
  await emit({ type: 'delta', part: 'assess', text: '{"scenario":"部分案例输出"}\n'.repeat(100) })
  const assessment = page.getByRole('region', { name: '业务案例检查实时输出', exact: true })
  await check('small upward scroll pauses following assessment output', async () => {
    await wheel(assessment, -12)
    const before = await top(assessment)
    await emit({ type: 'delta', part: 'assess', text: '{"scenario":"新增案例"}\n'.repeat(10) })
    assert.ok(Math.abs(await top(assessment) - before) <= 1)
  })

  assert.deepEqual(errors, [], 'browser page errors')
  assert.deepEqual(failures, [], 'stream scrolling regressions')
  console.log('Stream scrolling checks passed without model API calls.')
} finally {
  await browser.close()
}
