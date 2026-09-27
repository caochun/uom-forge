import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, type BrowserContext, type Page } from 'playwright'
import type { Assessment } from '../shared/analysis.ts'
import type { CandidateModel } from '../shared/model.ts'
import type { Project } from '../src/types.ts'

const url = process.argv[2] || 'http://127.0.0.1:5173/'
const artifacts = await mkdtemp(path.join(tmpdir(), 'forge-assessment-ui-'))
const model: CandidateModel = {
  schemaVersion: '1', name: '申请模型', summary: '独立申请及审核结果。',
  objects: [{ id: 'application', name: '申请', description: '申请与属于本申请的审核结果。', properties: [], evidence: [] }],
  relations: [], actions: [], functions: [], rules: [], boundaries: ['撤回条件未明确。'],
}
const basis = '申请的结果归属于该申请。审核通过才能办理。撤回条件未明确。'
const assessment: Assessment = {
  summary: '三个独立案例：归属可表达，办理前提缺失，撤回待确认。', recommendations: [], clarifications: [],
  caseAssessments: [
    { caseId: 'C1', scenario: '申请 A 的审核结果归属于 A。', basis: '申请的结果归属于该申请。', status: 'supported',
      elements: ['application'], explanation: '申请对象承载自身审核结果。', gap: '', suggestion: '' },
    { caseId: 'C2', scenario: '未审核的申请不得办理。', basis: '审核通过才能办理。', status: 'partial',
      elements: ['application'], explanation: '已有申请，缺少办理前提。', gap: '未表达审核通过的办理条件。', suggestion: '为办理操作补充审核前提。' },
    { caseId: 'C3', scenario: '办理中的申请是否可撤回。', basis: '撤回条件未明确。', status: 'clarify',
      elements: [], explanation: '规则未决，不能判定可表达。', gap: '撤回条件尚未确定。', suggestion: '回到业务理解确认撤回边界。' },
  ],
}
const project: Project = {
  version: 4,
  document: { name: '申请.txt', content: basis, blocks: [{ id: 'B1', text: basis }], size: '80 B', updated: '' },
  understanding: { narrative: basis, questions: [], warnings: [], source: { narrative: basis, questions: [], warnings: [] }, confirmedAnswers: {} },
  answers: {}, questionsSaved: true, feedback: '', feedbackDocumentRevision: null,
  plan: { plan: '## 对象\n申请及其审核结果。', businessBasis: basis, businessBasisComplete: true, complete: true, compiled: true, basis: { narrative: basis } },
  candidate: { model, revision: 1, documentRevision: 1 }, outputs: {}, timings: {}, messages: [],
  revisions: { document: 1, understoodDocument: 1, business: 1, planBasis: 1, candidateBasis: 1, model: 1, narrationBasis: null, assessmentBasis: null },
}
const browser = await chromium.launch({ headless: true })
const errors: string[] = []
async function open(context: BrowserContext, saved: unknown): Promise<Page> {
  await context.addInitScript(value => {
    if (!localStorage.getItem('uom-forge-project-v3')) localStorage.setItem('uom-forge-project-v3', JSON.stringify(value))
  }, saved)
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url)
  await page.getByRole('navigation', { name: '工作区' }).getByRole('button', { name: /模型检验/ }).click()
  await page.getByRole('button', { name: '业务案例检查', exact: true }).click()
  return page
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  let requests = 0
  await context.route('**/api/analyze/stream', async route => {
    const request = route.request().postDataJSON()
    assert.equal(request.stage, 'assess')
    assert.equal(request.businessBasis, basis)
    requests++
    await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ type: 'result', result: { assessment } })}\n\n` })
  })
  const page = await open(context, project)
  await page.getByRole('button', { name: '检查业务案例', exact: true }).click()
  await page.getByRole('heading', { name: '业务案例检查', exact: true }).waitFor()
  const report = page.getByRole('region', { name: '业务案例检查结果' })
  assert.equal(await report.locator('.support-process').count(), 3)
  assert.equal(requests, 1)
  await report.getByRole('button', { name: '加入下一轮反馈', exact: true }).click()
  await report.getByRole('button', { name: '已加入反馈', exact: true }).waitFor()
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('uom-forge-project-v3') || '{}').feedback?.includes('未审核的申请不得办理。'))
  await report.locator('.support-element-chips button').click()
  await page.getByRole('button', { name: '返回业务案例检查' }).click()
  await report.getByRole('button', { name: /^业务待澄清/ }).click()
  assert.equal(await report.locator('.support-process').count(), 1)
  await report.getByRole('button', { name: /^C3/ }).click()
  assert.equal(await report.getByRole('button', { name: '加入下一轮反馈', exact: true }).count(), 0)
  await page.screenshot({ path: path.join(artifacts, 'clarification.png'), fullPage: true })
  await report.getByRole('button', { name: /^全部业务案例/ }).click()
  await page.screenshot({ path: path.join(artifacts, 'cases-desktop.png'), fullPage: true })
  await page.reload()
  await page.getByRole('navigation', { name: '工作区' }).getByRole('button', { name: /模型检验/ }).click()
  await page.getByRole('button', { name: '业务案例检查', exact: true }).click()
  assert.equal(await page.locator('.support-process').count(), 3)
  assert.ok(await page.getByRole('button', { name: '已加入反馈', exact: true }).isDisabled())
  await page.setViewportSize({ width: 760, height: 1000 })
  await page.screenshot({ path: path.join(artifacts, 'cases-narrow.png'), fullPage: true })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await context.close()

  const legacy = { ...project, assessment: {
    summary: '旧版评估。', recommendations: [], clarifications: [],
    processAssessments: [{ processId: 'review', processName: '旧审核计划', status: 'partial', reason: '原有结论。', requirements: [
      { requirement: '通过才办理', status: 'partial', elements: ['application'], explanation: '已有申请。', gap: '旧缺口。', suggestion: '旧建议。' },
    ] }],
  } }
  const legacyContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const legacyPage = await open(legacyContext, legacy)
  await legacyPage.getByText('旧版计划评估 · 仅供查看', { exact: true }).click()
  assert.equal(await legacyPage.locator('.support-process').count(), 0)
  await legacyPage.getByText('旧审核计划', { exact: true }).waitFor()
  await legacyPage.screenshot({ path: path.join(artifacts, 'legacy.png'), fullPage: true })
  await legacyContext.close()
  assert.deepEqual(errors, [])
  console.log(`Assessment UI passed: streaming result, independent cases, filter, model preview, feedback, reload, narrow layout, legacy report. Screenshots: ${artifacts}`)
} finally {
  await browser.close()
}
