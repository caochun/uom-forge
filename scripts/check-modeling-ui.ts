import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, type Page } from 'playwright'
import { expect } from 'playwright/test'
import type { AnalysisEvent, AnalysisRequest, ModelingResult } from '../shared/analysis.ts'
import type { CandidateModel } from '../shared/model.ts'
import type { ExpressionReview } from '../shared/expression.ts'
import type { SemanticPlanV2 } from '../shared/semantic.ts'
import type { Project } from '../src/types.ts'
import type { DesignReview } from '../shared/design-review.ts'
import { artifactVersion } from '../shared/workflow.ts'
import { reviseUnderstanding } from '../src/understanding.ts'
import { extractUnderstandingSources } from '../shared/understanding-sources.ts'

// Exercise the actual React/SSE/storage boundaries without calling an LLM.
// Start Vite first; an alternative local URL can be passed as the first argument.
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const artifacts = await mkdtemp(path.join(tmpdir(), 'forge-ui-'))
const model: CandidateModel = {
  schemaVersion: '1',
  name: '订单模型',
  summary: '客户提交订单。',
  objects: [
    {
      id: 'order',
      name: '订单',
      description: '客户提交的订单。',
      properties: [],
      evidence: [],
    },
  ],
  relations: [],
  actions: [],
  functions: [],
  rules: [],
  activities: [],
  boundaries: [],
}
const review: ExpressionReview = {
  status: 'passed',
  selectedSnapshot: 0,
  changes: [],
  warnings: [],
  snapshots: [
    {
      model,
      check: {
        summary: '订单可以表达。',
        clarifications: [],
        warnings: [],
        cases: [
          {
            id: 'C1',
            fact: '客户提交订单',
            basis: '客户提交订单。',
            scenario: '客户提交一份订单',
            status: 'expressed',
            elements: ['order'],
            explanation: '以订单实例区分。',
            gap: '',
            suggestion: '',
          },
        ],
      },
    },
  ],
}
const semantic: SemanticPlanV2 = {
  schemaVersion: '2',
  status: 'stories',
  boundaries: [],
  clarifications: [],
  mappings: [],
  facts: [
    {
      id: 'F1',
      statement: '客户提交订单',
      kind: 'event',
      actors: ['客户'],
      objects: ['订单'],
      conditions: [],
      source: '客户提交订单。',
      certainty: 'explicit',
    },
  ],
  stories: [
    {
      id: 'S1',
      name: '下单',
      goal: '提交订单',
      factIds: ['F1'],
      steps: [
        {
          order: 1,
          actor: '客户',
          action: '提交',
          object: '订单',
          factIds: ['F1'],
        },
      ],
    },
  ],
}
const mapped: SemanticPlanV2 = {
  ...semantic,
  status: 'mapped',
  mappings: [
    {
      factId: 'F1',
      elementIds: ['order'],
      mappingType: 'object',
      explanation: '订单实例表达该事实。',
      coverage: 'full',
    },
  ],
}
const originalText = '订单由客户提交，提交后进入审核。'
const linkedUnderstanding = extractUnderstandingSources(
  '客户提交订单。 [[source:B1]]',
  {
    name: '回归验证.txt',
    blocks: [{ id: 'B1', text: originalText }],
  },
)
const project: Project = {
  version: 4,
  document: {
    name: '回归验证.txt',
    content: originalText,
    blocks: [{ id: 'B1', text: originalText }],
    size: '24 B',
    updated: '',
  },
  understanding: reviseUnderstanding({
    ...linkedUnderstanding,
    questions: [],
    warnings: [],
  }),
  answers: {},
  questionsSaved: false,
  feedback: '',
  feedbackDocumentRevision: 1,
  plan: {
    plan: '## 模型概述\n订单。',
    complete: true,
    compiled: true,
    semantic,
    warnings: ['事实到模型元素的映射未完成：先前失败。'],
  },
  candidate: {
    model,
    revision: 1,
    documentRevision: 1,
    expressionReview: { ...review, status: 'incomplete' },
  },
  narration: '',
  assessment: null,
  outputs: {},
  timings: {},
  messages: [],
  revisions: {
    document: 1,
    understoodDocument: 1,
    business: 1,
    planBasis: 1,
    candidateBasis: 1,
    model: 1,
    narrationBasis: null,
    assessmentBasis: null,
  },
}
const result: ModelingResult = {
  semanticPlan: project.plan!.plan,
  semantic: mapped,
  clarifications: [],
  model,
  expressionReview: review,
  provenance: { basis: 'business-understanding', evidence: 'unlinked' },
  validation: { elements: 1, warnings: [] },
}
type Harness = Window & {
  emitModelEvent: (event: AnalysisEvent) => void
  lastModelRequest: AnalysisRequest
}
const browser = await chromium.launch({ headless: true })
const errors: string[] = []
async function open(draft: Project) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  })
  await context.addInitScript((saved) => {
    if (!localStorage.getItem('uom-forge-project-v3'))
      localStorage.setItem('uom-forge-project-v3', JSON.stringify(saved))
    const original = window.fetch.bind(window)
    window.fetch = (input, options) => {
      if (!String(input).includes('/api/analyze/stream'))
        return original(input, options)
      const harness = window as unknown as Harness
      harness.lastModelRequest = JSON.parse(String(options?.body))
      const body = new ReadableStream({
        start(controller) {
          harness.emitModelEvent = (event) => {
            controller.enqueue(
              new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
            )
            if (event.type === 'result' || event.type === 'error')
              controller.close()
          }
          options?.signal?.addEventListener('abort', () =>
            controller.error(new DOMException('Stopped', 'AbortError')),
          )
        },
      })
      return Promise.resolve(
        new Response(body, {
          headers: { 'content-type': 'text/event-stream' },
        }),
      )
    }
  }, draft)
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(url)
  await expect(page.getByRole('combobox', { name: '模型推理强度' })).toBeEnabled()
  await page
    .getByRole('navigation', { name: '工作区', exact: true })
    .getByRole('button', { name: '03 建模' })
    .click()
  return { context, page }
}
const emit = (page: Page, event: AnalysisEvent) =>
  page.evaluate(
    (value) => (window as unknown as Harness).emitModelEvent(value),
    event,
  )
const tabs = (page: Page) => page.getByRole('group', { name: '建模工作区内容' })
const nav = (page: Page) =>
  page.getByRole('navigation', { name: '工作区', exact: true })
const compilationTiming = (callId: string): AnalysisEvent => ({
  type: 'timing', part: 'compile', timing: {
    callId, provider: 'glm', model: 'glm-5.3-flash', reasoningEffort: 'low',
    startedAt: new Date().toISOString(), promptCharacters: 10, outputCharacters: 0,
    elapsedMs: 0, status: 'running',
  },
})
try {
  const selection = await open(project)
  const effort = selection.page.getByRole('combobox', { name: '模型推理强度' })
  await expect(selection.page.getByRole('button', { name: '直接调用', exact: true })).toBeDisabled()
  await expect(selection.page.getByRole('button', { name: 'Pi Agent', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const profiles = await (await selection.page.request.get(new URL('/api/models', url).href)).json()
  for (const [provider, label] of [['gpt', 'GPT'], ['deepseek', 'DeepSeek'], ['qwen', 'Qwen'], ['glm', 'GLM']] as const) {
    await selection.page.getByRole('button', { name: label, exact: true }).click()
    await expect(effort).toHaveValue(profiles[provider].defaultEffort)
    assert.deepEqual(await effort.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value)), profiles[provider].efforts)
    await effort.selectOption(profiles[provider].efforts.at(-1))
  }
  await selection.page.getByRole('button', { name: 'GPT', exact: true }).click()
  await selection.page.getByRole('button', { name: 'GLM', exact: true }).click()
  await expect(effort).toHaveValue('low')
  await effort.selectOption('high')
  await nav(selection.page).getByRole('button', { name: '01 业务文档' }).click()
  await selection.page.getByRole('button', { name: '重新理解业务', exact: true }).click()
  const chosen = await selection.page.evaluate(() => (window as unknown as Harness).lastModelRequest)
  assert.equal(chosen.runtime, 'pi')
  assert.equal(chosen.provider, 'glm')
  assert.equal(chosen.reasoningEffort, 'high')
  await expect(effort).toBeDisabled()
  await selection.page.getByRole('button', { name: '停止', exact: true }).click()
  await expect(effort).toBeEnabled()
  await selection.page.screenshot({ path: path.join(artifacts, 'model-reasoning-options.png'), fullPage: true })
  await selection.page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await selection.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'model controls must fit mobile width')
  await selection.page.screenshot({ path: path.join(artifacts, 'model-reasoning-options-mobile.png'), fullPage: true })
  await selection.page.reload()
  await expect(effort).toHaveValue('low')
  await selection.context.close()

  // Show reasoning before the first body delta, then stream the business text
  // separately. A restarted/cancelled run must not masquerade as a saved result.
  const reading = await open(project)
  await nav(reading.page).getByRole('button', { name: '01 业务文档' }).click()
  await reading.page.getByRole('button', { name: '重新理解业务', exact: true }).click()
  const thought = reading.page.locator('.reading-reasoning')
  const narrative = reading.page.locator('.reading-narrative > .narrative-body')
  await expect(narrative).not.toContainText('客户提交订单。')
  await emit(reading.page, { type: 'delta', part: 'reading', reasoning: true, text: '先梳理参与者。\n' })
  await emit(reading.page, { type: 'delta', part: 'reading', reasoning: true, text: '再检查订单的条件与结果。' })
  await expect(thought).toHaveAttribute('open', '')
  await expect(reading.page.getByRole('region', { name: '模型思考过程' })).toHaveText('先梳理参与者。\n再检查订单的条件与结果。')
  await expect(reading.page.locator('.run-status')).toContainText('思考过程实时显示中')
  await expect(narrative).not.toContainText('先梳理参与者')
  await thought.locator('summary').click()
  await emit(reading.page, { type: 'delta', part: 'reading', reasoning: true, text: '\n现在整理说明。' })
  await expect(thought).not.toHaveAttribute('open', '')
  await thought.locator('summary').click()
  await emit(reading.page, { type: 'delta', part: 'reading', reasoning: true, text: '\n' + '继续检查业务条件与结果。\n'.repeat(40) })
  const reasoningBody = reading.page.getByRole('region', { name: '模型思考过程' })
  await expect.poll(() => reasoningBody.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
  await expect.poll(() => reasoningBody.evaluate(element =>
    element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(2)
  await reasoningBody.evaluate(element => {
    element.scrollTop = 0
    // Synchronize the simulated user scroll before emitting another SSE chunk.
    element.dispatchEvent(new Event('scroll'))
  })
  await expect.poll(() => reasoningBody.evaluate(element => element.scrollTop)).toBe(0)
  await emit(reading.page, { type: 'delta', part: 'reading', reasoning: true, text: '继续输出时不打断用户回看。' })
  await expect(reasoningBody).toContainText('继续输出时不打断用户回看。')
  assert.equal(await reasoningBody.evaluate(element => element.scrollTop), 0)
  await reading.page.screenshot({ path: path.join(artifacts, 'understanding-thinking.png'), fullPage: true })
  await reading.page.setViewportSize({ width: 390, height: 844 })
  await reading.page.getByRole('button', { name: '收起建模助手', exact: true }).click()
  await reading.page.screenshot({ path: path.join(artifacts, 'understanding-thinking-mobile.png'), fullPage: true })
  assert.ok(await reading.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'live reasoning must not overflow horizontally on mobile')
  await reading.page.setViewportSize({ width: 1440, height: 1000 })
  await emit(reading.page, { type: 'delta', part: 'reading', text: '## 新业务说明\n订单提交后' })
  await expect(thought).not.toHaveAttribute('open', '')
  await expect(narrative).toContainText('订单提交后')
  await expect(reading.page.locator('.run-status')).toContainText('正在生成文档整理稿')
  await thought.locator('summary').click()
  await emit(reading.page, { type: 'delta', part: 'reading', text: '进入审核。 [[source:B1]]' })
  await expect(thought).toHaveAttribute('open', '')
  await expect(narrative).toContainText('订单提交后进入审核。')
  await expect(narrative).not.toContainText('[[source:')
  const finalNarrative = '## 新业务说明\n订单提交后进入审核。'
  await emit(reading.page, { type: 'result', result: { understanding: { narrative: finalNarrative, questions: [], warnings: [] } } })
  await expect(reading.page.getByRole('button', { name: '停止', exact: true })).toHaveCount(0)
  await expect(narrative).toContainText('订单提交后进入审核。')
  await expect(thought.locator('summary')).toContainText('已结束')
  await reading.page.getByRole('button', { name: '基于此说明重新建模', exact: true }).click()
  const modelingRequest = await reading.page.evaluate(() => (window as unknown as Harness).lastModelRequest)
  assert.equal(modelingRequest.stage, 'model')
  assert.ok(modelingRequest.stage === 'model' && modelingRequest.narrative === finalNarrative,
    'only the completed narrative enters modeling, never reasoning')
  await reading.page.getByRole('button', { name: '停止', exact: true }).click()
  await expect(reading.page.getByRole('button', { name: '停止', exact: true })).toHaveCount(0)
  await nav(reading.page).getByRole('button', { name: '01 业务文档' }).click()
  await reading.page.getByRole('button', { name: '重新理解业务', exact: true }).click()
  await expect(thought).toHaveCount(0)
  await expect(narrative).not.toContainText('订单提交后进入审核。')
  await emit(reading.page, { type: 'delta', part: 'reading', reasoning: true, text: '新一轮尚在阅读。' })
  await reading.page.getByRole('button', { name: '停止', exact: true }).click()
  await expect(reading.page.getByRole('button', { name: '停止', exact: true })).toHaveCount(0)
  await expect(thought.locator('summary')).toContainText('本次输出已保留')
  await expect(thought).not.toContainText('先梳理参与者')
  await thought.locator('summary').click()
  await expect(reading.page.getByRole('region', { name: '模型思考过程' })).toContainText('新一轮尚在阅读。')
  await expect(narrative).toContainText('订单提交后进入审核。')
  await nav(reading.page).getByRole('button', { name: '01 业务文档' }).click()
  await reading.page.getByRole('button', { name: '重新理解业务', exact: true }).click()
  await emit(reading.page, { type: 'delta', part: 'reading', text: '这是一份未完成的说明。' })
  await expect(thought).toHaveCount(0)
  await emit(reading.page, { type: 'error', error: '测试流中断' })
  await expect(reading.page.getByRole('alert')).toContainText('测试流中断')
  await expect(narrative).toContainText('这是一份未完成的说明。')
  await expect(reading.page.locator('.reading-narrative .stage-badge')).toHaveText('整理稿尚未完成')
  await reading.context.close()

  const { context, page } = await open(project)
  await expect(page.locator('.fact-detail')).toBeHidden()
  await page.locator('.fact-row > summary').click()
  await expect(page.locator('.fact-basis')).toContainText('业务说明依据')
  await expect(page.locator('.source-references')).toContainText('尚未关联原文')
  await expect(page.locator('.source-references')).not.toContainText(
    originalText,
  )
  await page.locator('.fact-row > summary').click()
  await expect(
    page.getByRole('button', { name: '重新建模并更新覆盖', exact: true }),
  ).toBeEnabled()
  await expect(
    tabs(page).getByRole('button', { name: /业务依据/ }),
  ).toContainText('映射未完成')
  await page.getByRole('button', { name: '重新建模', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '停止', exact: true }),
  ).toBeVisible()
  await page.screenshot({ path: path.join(artifacts, 'running.png') })
  await expect(
    tabs(page).getByRole('button', { name: /模型视图/ }),
  ).toContainText('保留上轮模型')
  await expect(page.locator('.modeling-workflow')).toBeHidden()
  await nav(page).getByRole('button', { name: '02 业务理解' }).click()
  await expect(
    page.getByRole('button', { name: '停止', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: '停止', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '停止', exact: true }),
  ).toHaveCount(0)
  await nav(page).getByRole('button', { name: '03 建模' }).click()
  await expect(page.getByLabel('建模运行状态')).toContainText('已停止')

  await page.getByRole('button', { name: '重新建模', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '停止', exact: true }),
  ).toBeVisible()
  await emit(page, {
    type: 'semantic-plan',
    part: 'semantic',
    semantic: { ...semantic, status: 'facts', stories: [] },
  })
  await expect(
    tabs(page).getByRole('button', { name: /业务依据/ }),
  ).toContainText('正在组织故事')
  await emit(page, { type: 'delta', part: 'semantic', text: '{"stories":' })
  await page.getByRole('button', { name: '查看当前产物' }).click()
  await expect(
    page
      .getByRole('group', { name: '业务依据内容' })
      .getByRole('button', { name: /业务故事/ }),
  ).toHaveAttribute('aria-pressed', 'true')
  await emit(page, { type: 'semantic-plan', part: 'semantic', semantic })
  await expect(
    tabs(page).getByRole('button', { name: /模型设计/ }),
  ).toHaveAttribute('data-state', 'active')
  await page.getByRole('button', { name: '查看当前产物' }).click()
  await expect(page.locator('.reading-narrative')).toBeVisible()
  await expect(page.locator('.reading-narrative')).not.toContainText(
    '{"stories":',
  )
  await emit(page, {
    type: 'model-plan',
    part: 'semantic',
    semanticPlan: result.semanticPlan,
    clarifications: [],
    warnings: [],
  })
  await emit(page, {
    type: 'phase',
    part: 'compile',
    text: '正在整理候选模型。',
  })
  await expect(
    tabs(page).getByRole('button', { name: /模型设计/ }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    tabs(page).getByRole('button', { name: /模型视图/ }),
  ).toHaveAttribute('data-state', 'active')
  await tabs(page).getByRole('button', { name: /模型视图/ }).click()
  await expect(page.locator('.compilation-stream')).toBeVisible()
  await expect(page.locator('.expression-review')).toHaveCount(0)
  await expect(page.locator('.model-summary')).toContainText('订单模型')
  await emit(page, {
    type: 'model-checkpoint',
    model,
    expressionReview: { ...review, status: 'checking' },
  })
  await emit(page, { type: 'phase', part: 'expression', text: '正在检查。' })
  await page.getByRole('button', { name: '查看当前产物' }).click()
  await expect(page.locator('.expression-review')).toHaveAttribute('open', '')
  await emit(page, {
    type: 'model-checkpoint',
    model,
    expressionReview: review,
  })
  await emit(page, { type: 'phase', part: 'mapping', text: '正在映射。' })
  await expect(
    tabs(page).getByRole('button', { name: /业务依据/ }),
  ).toContainText('正在建立覆盖映射')
  await page.getByRole('button', { name: '查看当前产物' }).click()
  await expect(
    page
      .getByRole('group', { name: '业务依据内容' })
      .getByRole('button', { name: /业务事实/ }),
  ).toHaveAttribute('aria-pressed', 'true')
  await emit(page, {
    type: 'semantic-plan',
    part: 'semantic',
    semantic: mapped,
  })
  await emit(page, { type: 'result', result })
  await expect(
    page.getByRole('button', { name: '停止', exact: true }),
  ).toHaveCount(0)
  await expect(
    tabs(page).getByRole('button', { name: /业务依据/ }),
  ).toHaveAttribute('data-state', 'done')
  await expect(page.locator('.fact-detail')).toBeHidden()
  await page.screenshot({ path: path.join(artifacts, 'collapsed.png') })
  await page.locator('.fact-row > summary').click()
  await expect(page.locator('.fact-expression')).toContainText(
    '订单实例表达该事实。',
  )
  await expect(page.locator('.source-references')).toContainText(originalText)
  await expect(page.locator('.fact-basis')).not.toContainText('原文依据')
  await expect(page.locator('.todo-bar')).toHaveCount(0)
  await page.screenshot({ path: path.join(artifacts, 'desktop.png') })
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await page.reload()
  await nav(page).getByRole('button', { name: '03 建模' }).click()
  await expect(
    tabs(page).getByRole('button', { name: /业务依据/ }),
  ).toHaveAttribute('data-state', 'done')
  await page.locator('.fact-row > summary').click()
  await expect(page.locator('.source-references')).toContainText(originalText)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '收起建模助手', exact: true }).click()
  await page.screenshot({
    path: path.join(artifacts, 'mobile.png'),
    fullPage: true,
  })
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    'mobile page must not overflow horizontally',
  )
  await page.setViewportSize({ width: 1440, height: 1000 })
  await nav(page).getByRole('button', { name: '02 业务理解' }).click()
  await page.locator('.source-catalogue > summary').click()
  await expect(page.locator('.source-catalogue')).toContainText(originalText)
  await page.getByRole('button', { name: '修正整理稿', exact: true }).click()
  await page.getByLabel('修正文档整理稿', { exact: true }).fill('客户撤回订单。')
  await page.getByRole('button', { name: '保存整理稿', exact: true }).click()
  await expect(page.locator('.source-catalogue')).toContainText(
    '用户补充或修订',
  )
  await expect(page.locator('.source-catalogue')).not.toContainText(
    originalText,
  )
  await nav(page).getByRole('button', { name: '03 建模' }).click()
  await expect(
    tabs(page).getByRole('button', { name: /模型设计/ }),
  ).toContainText('设计需要更新')
  await page.locator('.fact-row > summary').click()
  await expect(page.locator('.source-references')).toContainText(originalText)
  await context.close()

  // Design iteration streams in the existing design tab and preserves both
  // reviewed snapshots and the complete design while a revision is streaming.
  const simpleDraft = structuredClone(project)
  simpleDraft.plan = null
  simpleDraft.candidate = null
  const simple = await open(simpleDraft)
  await simple.page.getByRole('button', { name: '重新建模', exact: true }).click()
  await expect(simple.page.getByRole('button', { name: '停止', exact: true })).toBeVisible()
  await emit(simple.page, { type: 'phase', part: 'basis', text: '正在整理业务依据。' })
  await emit(simple.page, { type: 'delta', part: 'basis', text: '事实：客户提交订单。' })
  await expect(simple.page.locator('.business-basis')).toContainText('事实：客户提交订单。')
  await emit(simple.page, { type: 'delta', part: 'basis', text: 'PRIVATE_REASONING', reasoning: true })
  await expect(simple.page.locator('.business-basis')).not.toContainText('PRIVATE_REASONING')
  const textBasis = '事实：客户提交订单。\n故事：提交后进入审核。'
  await emit(simple.page, { type: 'business-basis', part: 'basis', text: textBasis })
  let designReview: DesignReview = { status: 'drafting', round: 1, rounds: [], narrativeVersion: artifactVersion(project.understanding!.narrative), businessBasisVersion: artifactVersion(textBasis) }
  await emit(simple.page, { type: 'design-review', part: 'semantic', review: designReview })
  await emit(simple.page, { type: 'phase', part: 'semantic', text: '正在生成模型设计。' })
  await emit(simple.page, { type: 'delta', part: 'semantic', text: '订单是需要独立保存的业务对象。' })
  await tabs(simple.page).getByRole('button', { name: /模型设计/ }).click()
  await expect(simple.page.locator('.reading-narrative')).toContainText('订单是需要独立保存的业务对象。')
  const firstDesign = '订单是需要独立保存的业务对象。'
  designReview = { ...designReview, status: 'checking', planVersion: artifactVersion(firstDesign) }
  await emit(simple.page, { type: 'design-review', part: 'semantic', semanticPlan: firstDesign, review: designReview })
  await emit(simple.page, { type: 'phase', part: 'design-check', text: '正在检验业务表达。' })
  await emit(simple.page, { type: 'delta', part: 'design-check', text: '缺口：没有明确订单属于哪位客户。' })
  await emit(simple.page, { type: 'delta', part: 'design-check', text: 'PRIVATE_CHECK_REASONING', reasoning: true })
  await expect(simple.page.locator('.design-review')).toContainText('缺口：没有明确订单属于哪位客户。')
  await expect(simple.page.locator('.design-review')).not.toContainText('PRIVATE_CHECK_REASONING')
  await expect(tabs(simple.page).getByRole('button', { name: /模型设计/ })).toHaveAttribute('data-state', 'active')
  designReview = { ...designReview, status: 'drafting', round: 2, rounds: [{ design: firstDesign, feedback: '缺口：没有明确订单属于哪位客户。', verdict: 'revise' }] }
  await emit(simple.page, { type: 'design-review', part: 'semantic', review: designReview })
  await emit(simple.page, { type: 'phase', part: 'semantic', text: '正在修订设计。' })
  const finalDesign = '每个订单通过提交关系绑定一位客户。'
  await emit(simple.page, { type: 'delta', part: 'semantic', text: finalDesign })
  await expect(simple.page.locator('.reading-narrative > .narrative-body')).toHaveText(finalDesign)
  designReview = { ...designReview, status: 'completed', reason: 'sufficient', planVersion: artifactVersion(finalDesign),
    rounds: [...designReview.rounds, { design: finalDesign, feedback: '结论：可表达\n客户甲提交订单乙，可通过提交关系确定所属客户。', verdict: 'sufficient' }] }
  await emit(simple.page, { type: 'design-review', part: 'semantic', semanticPlan: finalDesign, review: designReview })
  await emit(simple.page, { type: 'model-plan', part: 'semantic', semanticPlan: finalDesign, clarifications: [], warnings: [] })
  await emit(simple.page, { type: 'phase', part: 'compile', text: '正在生成模型。' })
  await simple.page.getByRole('button', { name: '查看当前产物', exact: true }).click()
  await emit(simple.page, compilationTiming('compile-1'))
  await emit(simple.page, { type: 'delta', part: 'compile', reasoning: true, text: '正在转录既有定义。' })
  await expect(simple.page.getByRole('region', { name: '模型思考过程' })).toContainText('正在转录既有定义。')
  await expect(simple.page.locator('.model-summary')).toHaveCount(0)
  const unfinishedJson = '{"name":"订单模型","objects":['
  await emit(simple.page, { type: 'delta', part: 'compile', text: unfinishedJson })
  await expect(simple.page.getByRole('region', { name: '模型 JSON 实时输出' })).toHaveText(unfinishedJson)
  await expect(simple.page.locator('.reading-reasoning')).not.toHaveAttribute('open', '')
  await expect(simple.page.getByRole('region', { name: '模型 JSON 实时输出' })).not.toContainText('正在转录')
  await simple.page.screenshot({ path: path.join(artifacts, 'compilation-stream.png'), fullPage: true })
  await simple.page.setViewportSize({ width: 390, height: 844 })
  await simple.page.getByRole('button', { name: '收起建模助手', exact: true }).click()
  await simple.page.screenshot({ path: path.join(artifacts, 'compilation-stream-mobile.png'), fullPage: true })
  assert.ok(await simple.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'streaming JSON must wrap on mobile')
  await simple.page.setViewportSize({ width: 1440, height: 1000 })
  await emit(simple.page, { type: 'phase', part: 'compile', text: '模型 JSON 未通过程序校验，正在进行一次修复。' })
  await emit(simple.page, compilationTiming('compile-2'))
  await expect(simple.page.locator('.compilation-stream')).toContainText('第 2 次输出')
  await expect(simple.page.getByRole('region', { name: '模型 JSON 实时输出' })).toHaveCount(0)
  await expect(simple.page.locator('.compilation-stream')).not.toContainText('正在转录既有定义。')
  await emit(simple.page, { type: 'delta', part: 'compile', text: JSON.stringify(model) })
  await expect(simple.page.locator('.model-summary')).toHaveCount(0)
  const unreviewed: ExpressionReview = { status: 'not-run', selectedSnapshot: 0, snapshots: [{ model }], changes: [], warnings: [] }
  await emit(simple.page, { type: 'model-checkpoint', model, expressionReview: unreviewed })
  await emit(simple.page, { type: 'result', result: { ...result, semantic: undefined, businessBasis: textBasis, semanticPlan: finalDesign, designReview, expressionReview: unreviewed } })
  await expect(simple.page.getByRole('button', { name: '停止', exact: true })).toHaveCount(0)
  await expect(tabs(simple.page).locator('[data-state="done"]')).toHaveCount(6)
  await expect(simple.page.locator('.todo-bar')).toHaveCount(0)
  await tabs(simple.page).getByRole('button', { name: /模型视图/ }).click()
  await expect(simple.page.locator('.model-summary')).toContainText('订单模型')
  await expect(simple.page.locator('.compilation-stream')).not.toHaveAttribute('open', '')
  await expect(simple.page.locator('.compilation-stream > summary')).toContainText('结构和引用检查通过')
  await expect(simple.page.locator('.expression-review')).toHaveCount(0)
  await simple.page.getByRole('button', { name: '展开运行记录', exact: true }).click()
  await expect(simple.page.locator('.modeling-workflow > li')).toHaveCount(3)
  await tabs(simple.page).getByRole('button', { name: /业务依据/ }).click()
  await expect(simple.page.locator('.business-basis .panel-subtitle')).toContainText('设计与表达检查共同使用本份依据')
  await simple.page.getByText('本轮依据来自的文档整理稿', { exact: true }).click()
  await simple.page.locator('.business-basis .source-catalogue .source-catalogue > summary').click()
  await expect(simple.page.locator('.business-basis > .source-catalogue')).toContainText(originalText)
  await simple.page.screenshot({ path: path.join(artifacts, 'simplified-basis.png') })
  await simple.page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await simple.page.reload()
  await nav(simple.page).getByRole('button', { name: '03 建模' }).click()
  await tabs(simple.page).getByRole('button', { name: /模型设计/ }).click()
  await expect(simple.page.locator('.design-review')).toContainText('已检查 2 轮')
  await simple.page.locator('.design-review > summary').click()
  await expect(simple.page.locator('.design-review')).toContainText('客户甲提交订单乙')
  await expect(simple.page.locator('.design-review')).toContainText('沿用本轮业务依据中的检验情形')
  await simple.page.screenshot({ path: path.join(artifacts, 'design-review.png') })
  await tabs(simple.page).getByRole('button', { name: /业务依据/ }).click()
  await expect(simple.page.locator('.business-basis')).toContainText('故事：提交后进入审核。')
  await expect(simple.page.locator('.todo-bar')).toHaveCount(0)
  await simple.page.setViewportSize({ width: 390, height: 844 })
  if (await simple.page.getByRole('button', { name: '收起建模助手', exact: true }).count())
    await simple.page.getByRole('button', { name: '收起建模助手', exact: true }).click()
  await simple.page.screenshot({ path: path.join(artifacts, 'simplified-mobile.png'), fullPage: true })
  assert.ok(await simple.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await simple.context.close()

  const interruptedCompile = await open({ ...simpleDraft, plan: {
    plan: finalDesign, businessBasis: textBasis, businessBasisComplete: true, complete: true, compiled: false,
  } })
  await interruptedCompile.page.locator('.workspace-heading').getByRole('button', { name: '重新整理模型', exact: true }).click()
  await emit(interruptedCompile.page, { type: 'phase', part: 'compile', text: '正在生成模型。' })
  await emit(interruptedCompile.page, { type: 'delta', part: 'compile', text: unfinishedJson })
  await tabs(interruptedCompile.page).getByRole('button', { name: /模型视图/ }).click()
  await interruptedCompile.page.getByRole('button', { name: '停止', exact: true }).click()
  await expect(interruptedCompile.page.locator('.compilation-stream')).toContainText('已保留部分输出')
  await interruptedCompile.page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await interruptedCompile.page.reload()
  await nav(interruptedCompile.page).getByRole('button', { name: '03 建模' }).click()
  await tabs(interruptedCompile.page).getByRole('button', { name: /模型视图/ }).click()
  await expect(interruptedCompile.page.getByRole('region', { name: '模型 JSON 实时输出' })).toHaveText(unfinishedJson)
  await expect(interruptedCompile.page.locator('.model-summary')).toHaveCount(0)
  await interruptedCompile.page.locator('.workspace-heading').getByRole('button', { name: '重新整理模型', exact: true }).click()
  await emit(interruptedCompile.page, { type: 'phase', part: 'compile', text: '正在生成模型。' })
  await expect(interruptedCompile.page.locator('.compilation-stream')).toContainText('第 1 次输出')
  await expect(interruptedCompile.page.getByRole('region', { name: '模型 JSON 实时输出' })).toHaveCount(0)
  await interruptedCompile.page.getByRole('button', { name: '停止', exact: true }).click()
  await interruptedCompile.context.close()

  // A question derived from the basis is not an original-document quote.
  // Appending that question must not change the reading snapshot used by a
  // compilation retry, or silently drop the matching design review.
  const clarificationRun = await open(simpleDraft)
  await clarificationRun.page.getByRole('button', { name: '重新建模', exact: true }).click()
  const questionBasis = textBasis + '\n审核能否重复尚未明确。'
  const clarification = {
    text: '订单是否允许重复审核？', basis: '审核能否重复尚未明确。',
    basisSource: 'business-basis' as const, ambiguity: '一次审核或可以复核。',
    impact: '影响审核过程与结果的表达。', options: ['仅一次', '允许复核'], multiple: false,
  }
  const clarificationReview: DesignReview = {
    ...designReview, status: 'attention', reason: 'clarify', businessBasisVersion: artifactVersion(questionBasis),
  }
  await emit(clarificationRun.page, { type: 'business-basis', part: 'basis', text: questionBasis })
  await emit(clarificationRun.page, { type: 'design-review', part: 'semantic', semanticPlan: finalDesign, review: clarificationReview })
  await emit(clarificationRun.page, { type: 'model-plan', part: 'semantic', semanticPlan: finalDesign, clarifications: [clarification], warnings: [] })
  await emit(clarificationRun.page, { type: 'error', error: '测试编译中断' })
  await expect(clarificationRun.page.getByRole('alert')).toContainText('测试编译中断')
  await nav(clarificationRun.page).getByRole('button', { name: '02 业务理解' }).click()
  await expect(clarificationRun.page.getByRole('heading', { name: '业务文档整理稿' })).toBeVisible()
  await expect(clarificationRun.page.locator('.question-context')).toContainText('业务依据中的引文（提炼内容）')
  await expect(clarificationRun.page.locator('.question-context')).toContainText(clarification.basis)
  await clarificationRun.page.screenshot({ path: path.join(artifacts, 'reading-clarification.png'), fullPage: true })
  await clarificationRun.page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await clarificationRun.page.reload()
  await nav(clarificationRun.page).getByRole('button', { name: '02 业务理解' }).click()
  await expect(clarificationRun.page.locator('.question-context')).toContainText('业务依据中的引文（提炼内容）')
  await nav(clarificationRun.page).getByRole('button', { name: '03 建模' }).click()
  await clarificationRun.page.locator('.workspace-heading').getByRole('button', { name: '重新整理模型', exact: true }).click()
  const retryInput = await clarificationRun.page.evaluate(() => (window as unknown as Harness).lastModelRequest)
  assert.ok(retryInput.stage === 'compile')
  assert.equal(retryInput.narrative, project.understanding!.narrative)
  assert.equal(retryInput.businessBasis, questionBasis)
  assert.deepEqual(retryInput.designReview, clarificationReview)
  await emit(clarificationRun.page, { type: 'result', result: {
    ...result, semantic: undefined, semanticPlan: finalDesign, businessBasis: questionBasis,
    designReview: clarificationReview, expressionReview: unreviewed, clarifications: [clarification],
  } })
  await expect(clarificationRun.page.getByRole('button', { name: '停止', exact: true })).toHaveCount(0)
  await clarificationRun.context.close()

  const interrupted = await open(simpleDraft)
  await interrupted.page.getByRole('button', { name: '重新建模', exact: true }).click()
  await expect(interrupted.page.getByRole('button', { name: '停止', exact: true })).toBeVisible()
  await emit(interrupted.page, { type: 'business-basis', part: 'basis', text: textBasis })
  await emit(interrupted.page, { type: 'design-review', part: 'semantic', semanticPlan: firstDesign,
    review: { status: 'checking', round: 1, rounds: [], planVersion: artifactVersion(firstDesign) } })
  await emit(interrupted.page, { type: 'design-review', part: 'semantic', review: {
    status: 'drafting', round: 2, rounds: [designReview.rounds[0]], planVersion: artifactVersion(firstDesign),
  } })
  await emit(interrupted.page, { type: 'phase', part: 'semantic', text: '正在修订设计。' })
  await emit(interrupted.page, { type: 'delta', part: 'semantic', text: '尚未生成完整的修订' })
  await tabs(interrupted.page).getByRole('button', { name: /模型设计/ }).click()
  await expect(interrupted.page.locator('.reading-narrative > .narrative-body')).toHaveText('尚未生成完整的修订')
  await interrupted.page.getByRole('button', { name: '停止', exact: true }).click()
  await expect(interrupted.page.getByRole('button', { name: '停止', exact: true })).toHaveCount(0)
  await expect(interrupted.page.locator('.reading-narrative > .narrative-body')).toHaveText(firstDesign)
  await expect(interrupted.page.locator('.design-review')).toContainText('迭代已中断')
  await interrupted.page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await interrupted.page.reload()
  await nav(interrupted.page).getByRole('button', { name: '03 建模' }).click()
  await tabs(interrupted.page).getByRole('button', { name: /模型设计/ }).click()
  await expect(interrupted.page.locator('.reading-narrative > .narrative-body')).toHaveText(firstDesign)
  await interrupted.page.getByText('中断前的部分修订（尚未替换完整设计）', { exact: true }).click()
  await expect(interrupted.page.locator('.reading-narrative')).toContainText('尚未生成完整的修订')
  await interrupted.context.close()

  const resumeDraft = structuredClone(project)
  resumeDraft.plan!.semantic!.scenarios = [{ id: 'Q1', factIds: ['F1'], statement: '客户提交订单', scenario: '客户 A 提交订单 X。', distinction: '确定订单的提交者。' }]
  const recovery = await open(resumeDraft)
  await recovery.page.getByRole('button', { name: '仅重试事实映射', exact: true }).click()
  await expect(recovery.page.getByRole('button', { name: '停止', exact: true })).toBeVisible()
  assert.equal(await recovery.page.evaluate(() => (window as unknown as Harness).lastModelRequest.stage), 'map')
  await emit(recovery.page, { type: 'phase', part: 'mapping', text: '正在建立事实映射。' })
  await expect(tabs(recovery.page).getByRole('button', { name: /业务依据/ })).toHaveAttribute('data-state', 'active')
  await emit(recovery.page, { type: 'result', result: { ...result, semantic: { ...mapped, scenarios: resumeDraft.plan!.semantic!.scenarios }, expressionReview: { ...review, status: 'incomplete' } } })
  await recovery.page.getByText('代表性业务情形 · 1 项', { exact: true }).click()
  await expect(recovery.page.getByText('客户 A 提交订单 X。', { exact: true })).toBeVisible()
  await recovery.page.getByRole('button', { name: '检查并修正当前候选', exact: true }).click()
  await expect(recovery.page.getByRole('button', { name: '停止', exact: true })).toBeVisible()
  assert.equal(await recovery.page.evaluate(() => (window as unknown as Harness).lastModelRequest.stage), 'verify')
  await emit(recovery.page, { type: 'model-checkpoint', model, expressionReview: review })
  await emit(recovery.page, { type: 'result', result })
  await expect(recovery.page.locator('.todo-bar')).toHaveCount(0)
  await recovery.page.screenshot({ path: path.join(artifacts, 'resumed.png') })
  await recovery.context.close()

  const staleDraft = structuredClone(project)
  staleDraft.revisions.document += 1
  const stale = await open(staleDraft)
  await expect(
    stale.page.getByRole('button', { name: '重新建模并更新覆盖', exact: true }),
  ).toBeDisabled()
  await stale.context.close()

  const retryDraft = structuredClone(project)
  retryDraft.plan = { ...retryDraft.plan!, semantic: mapped, compiled: false }
  retryDraft.timings.model = [
    {
      callId: 'previous-run',
      provider: 'deepseek',
      model: 'test',
      startedAt: '2026-09-17T01:00:00Z',
      status: 'completed',
      elapsedMs: 123000,
      promptCharacters: 1,
      outputCharacters: 1,
    },
  ]
  const retry = await open(retryDraft)
  await retry.page
    .locator('.workspace-heading')
    .getByRole('button', { name: '重新整理模型', exact: true })
    .click()
  await expect(
    retry.page.getByRole('button', { name: '停止', exact: true }),
  ).toBeVisible()
  assert.equal(
    await retry.page.evaluate(
      () => (window as unknown as Harness).lastModelRequest.stage,
    ),
    'compile',
  )
  await expect(retry.page.locator('.fact-row > summary')).toContainText(
    '待映射',
  )
  await expect(retry.page.locator('.todo-bar')).not.toContainText('先前失败')
  await emit(retry.page, {
    type: 'model-checkpoint',
    model,
    expressionReview: review,
  })
  await emit(retry.page, { type: 'result', result })
  await expect(
    tabs(retry.page).getByRole('button', { name: /业务依据/ }),
  ).toHaveAttribute('data-state', 'done')
  await expect(retry.page.locator('.todo-bar')).toHaveCount(0)
  await expect(retry.page.getByLabel('建模运行状态')).not.toContainText(
    '本次调用',
  )
  await retry.context.close()
  assert.deepEqual(errors, [])
  console.log(`UI checks passed. Screenshots: ${artifacts}`)
} finally {
  await browser.close()
}
