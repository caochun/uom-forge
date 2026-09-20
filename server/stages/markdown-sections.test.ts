import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeModelPlan, normalizeSectionHeadings } from './markdown-sections.ts'
import { modelingContent, reviewModelClarifications } from '../../shared/clarifications.ts'
import { extractUnderstandingSources } from '../../shared/understanding-sources.ts'

const narrative = '申请审核后办理。'

test('decorated clarification headings still route questions out of compilation', () => {
  const raw = `## 模型概述：申请办理\n## 需要补充的业务信息：\n1. 是否需要复核？\n依据：“${narrative}”\n歧义：通过即办理或仍需复核。\n影响：改变办理前提。\n选项：立即办理；先复核`
  const normalized = normalizeModelPlan(raw)
  assert.equal(reviewModelClarifications(normalized, narrative).clarifications.length, 1)
  assert.equal(modelingContent(normalized), '## 模型概述\n申请办理')
  assert.equal(normalizeModelPlan(normalized), normalized)
})

test('inline understanding paragraphs keep their source citations after heading normalization', () => {
  const raw = `## 业务概述：${narrative} [[source:B1]]`
  const normalized = normalizeSectionHeadings(raw, ['业务概述'])
  const linked = extractUnderstandingSources(normalized, { name: 'test', blocks: [{ id: 'B1', text: narrative }] })
  assert.equal(linked.narrative, `## 业务概述\n${narrative}`)
  assert.deepEqual(linked.sources.citations[0].blockIds, ['B1'])
  assert.equal(linked.warnings.length, 0)
})
