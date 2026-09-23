import { normalizeSectionHeadings } from './markdown-sections.ts'
import { validateDocument } from '../validation/document.ts'
import { understandingPrompt } from './prompts.ts'
import type { BusinessDocument, Understanding } from '../../shared/analysis.ts'
import type { StageOptions } from './contracts.ts'

import { extractQuestions } from '../../shared/questions.ts'
import { runPiText } from '../agents/pi-text.ts'
import { extractUnderstandingSources } from '../../shared/understanding-sources.ts'

export async function readBusiness(
  document: BusinessDocument,
  options: StageOptions = {},
): Promise<{ understanding: Understanding }> {
  validateDocument(document)
  const report = options.onEvent || (() => {})
  options.signal?.throwIfAborted()
  report({
    type: 'phase',
    part: 'reading',
    text: '正在整理文档内容，检查表述是否清楚、一致。',
  })
  const narrative = await (options.agents?.text || runPiText)(
    understandingPrompt(document),
    'reading',
    options,
  )
  options.signal?.throwIfAborted()
  if (!narrative.trim()) throw new Error('未返回业务文档整理稿，请重试。')
  const linked = extractUnderstandingSources(normalizeSectionHeadings(narrative, ['待确认问题']), document)
  const understanding: Understanding = {
    narrative: linked.narrative,
    sources: linked.sources,
    questions: extractQuestions(linked.narrative),
    warnings: linked.warnings,
  }
  report({ type: 'understanding-narrative', ...understanding })
  return { understanding }
}
