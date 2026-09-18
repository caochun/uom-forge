import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, type Page } from 'playwright'
import { expect } from 'playwright/test'
import type { AnalysisEvent, ModelingResult } from '../shared/analysis.ts'
import type { CandidateModel } from '../shared/model.ts'
import type { ExpressionReview } from '../shared/expression.ts'
import type { SemanticPlanV2 } from '../shared/semantic.ts'
import type { Project } from '../src/types.ts'
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
  lastModelRequest: { stage: string }
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
try {
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
  await emit(page, { type: 'phase', part: 'semantic', text: '正在映射。' })
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
  await page.getByRole('button', { name: '修正业务说明', exact: true }).click()
  await page.getByLabel('修正业务说明', { exact: true }).fill('客户撤回订单。')
  await page.getByRole('button', { name: '保存业务说明', exact: true }).click()
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
