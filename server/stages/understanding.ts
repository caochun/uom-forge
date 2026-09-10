import { validateDocument } from '../validation/document.ts'
import { understandingPrompt, UNDERSTANDING_SECTIONS } from './prompts.ts'
import type { BusinessDocument, Understanding } from '../../shared/analysis.ts'
import type { RunTurn } from '../providers/types.ts'
import { scopedTurn, type StageOptions } from './contracts.ts'

import { extractQuestions } from '../../shared/questions.ts'

export function understandingWarnings(narrative: string): string[] {
  const headings = new Set(
    [...narrative.matchAll(/^##[ \t]+(.+?)[ \t]*\r?$/gm)].map(
      (match) => match[1],
    ),
  )
  return UNDERSTANDING_SECTIONS.filter(({ title }) => !headings.has(title)).map(
    ({ title }) => `业务说明未单列“${title}”，请检查相关语义是否有遗漏。`,
  )
}

export async function readBusiness(
  document: BusinessDocument,
  runTurn: RunTurn,
  options: StageOptions = {},
): Promise<{ understanding: Understanding }> {
  validateDocument(document)
  const report = options.onEvent || (() => {})
  options.signal?.throwIfAborted()
  report({
    type: 'phase',
    part: 'reading',
    text: '正在阅读文档，形成业务语义说明。',
  })
  const narrative = await runTurn(
    understandingPrompt(document),
    scopedTurn(options, 'reading'),
  )
  options.signal?.throwIfAborted()
  if (!narrative.trim()) throw new Error('未返回业务说明，请重试。')
  const understanding = {
    narrative,
    questions: extractQuestions(narrative),
    warnings: understandingWarnings(narrative),
  }
  report({ type: 'understanding-narrative', ...understanding })
  return { understanding }
}
