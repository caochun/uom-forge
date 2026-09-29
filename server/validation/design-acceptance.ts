import { readDesignAcceptance, readDesignCheckReport, type DesignAcceptance, type DesignCheckReport } from '../../shared/design-acceptance.ts'
import type { DesignVerdict } from '../../shared/design-review.ts'
import type { BusinessContext } from '../stages/business-context.ts'
import { parseJsonOutput } from './values.ts'
import { fromMarkdown } from 'mdast-util-from-markdown'

const normalized = (text: string) => text.replace(/\s+/g, ' ').trim()
const contains = (text: string, quote: string) => !!quote.trim() && normalized(text).includes(normalized(quote))

type SourceEntry = { id: string; text: string }

function sourceEntries(context: BusinessContext): SourceEntry[] {
  const document = context.sources?.blocks || []
  const entries = document.map((block) => ({ id: block.id, text: block.text }))
  // Legacy drafts may not carry an original snapshot. Give narrative lines
  // stable IDs so the same locator protocol still works in that case.
  if (!document.length) {
    entries.push(...context.narrative
      .split(/\r?\n/)
      .map((text, index) => ({ id: `narrative-${index + 1}`, text: text.trim() }))
      .filter((entry) => entry.text))
  }
  return entries
}

export function sourceQuoteForBlocks(
  context: BusinessContext,
  ids: string[] | undefined,
): string | undefined {
  if (!ids?.length) return undefined
  const entries = sourceEntries(context)
  const byId = new Map(entries.map((entry) => [entry.id, entry.text]))
  const texts = ids.map((id) => byId.get(id.trim()))
  return texts.every((text): text is string => !!text && !!text.trim())
    ? texts[0]
    : undefined
}

export function canonicalizeAcceptanceSources(
  context: BusinessContext,
  acceptance: DesignAcceptance,
): { acceptance: DesignAcceptance; invalid: DesignAcceptance['questions'] } {
  const invalid: DesignAcceptance['questions'] = []
  const questions = acceptance.questions.map((question) => {
    const refs = question.sourceBlockIds?.map((id) => id.trim()).filter(Boolean)
    const referencedQuote = sourceQuoteForBlocks(context, refs)
    if (question.sourceBlockIds !== undefined) {
      if (!referencedQuote) {
        invalid.push(question)
        return { ...question, sourceBlockIds: refs }
      }
      // The locator is authoritative. Replace any paraphrased or truncated
      // quote with exact text copied from the source snapshot.
      return { ...question, sourceBlockIds: refs, sourceQuote: referencedQuote }
    }
    if (!sourceContains(context, question.sourceQuote)) {
      invalid.push(question)
      return question
    }
    // Keep legacy quote-only drafts unchanged. New generations carry an
    // explicit locator and are canonicalized above.
    return question
  })
  return { acceptance: { ...acceptance, questions }, invalid }
}

// Accept a quotation of rendered Markdown without deleting literal operators,
// negation or words. Only parsed emphasis/code delimiters and quote styles differ.
function definitionQuoteText(text: string): string {
  type Node = { type: string; position?: { start: { offset?: number }; end: { offset?: number } }; children?: Node[] }
  const cuts: [number, number][] = []
  const visit = (node: Node) => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start !== undefined && end !== undefined) {
      const width = node.type === 'strong' ? 2 : node.type === 'emphasis' ? 1
        : node.type === 'inlineCode' ? text.slice(start, end).match(/^`+/)?.[0].length || 0 : 0
      if (width) cuts.push([start, start + width], [end - width, end])
    }
    node.children?.forEach(visit)
  }
  visit(fromMarkdown(text))
  let cursor = 0
  let plain = ''
  for (const [start, end] of cuts.sort((a, b) => a[0] - b[0])) {
    plain += text.slice(cursor, start)
    cursor = end
  }
  return normalized((plain + text.slice(cursor)).replace(/[“”]/g, '"').replace(/[‘’]/g, "'"))
}
export function sourceContains(context: BusinessContext, quote: string): boolean {
  return contains(context.narrative, quote) || !!context.sources?.blocks.some(b => contains(b.text, quote))
}
function unique(ids: string[], label: string) {
  if (new Set(ids.map(id => id.trim())).size !== ids.length) throw new Error(`${label}编号重复。`)
}

export function parseAcceptanceShape(raw: string): DesignAcceptance {
  const result = readDesignAcceptance(parseJsonOutput(raw, '业务验收清单'))
  if (!result) throw new Error('业务验收清单结构不完整。')
  unique(result.questions.map(q => q.id), '验收问题')
  return result
}

export function parseDesignAcceptance(raw: string, context: BusinessContext): DesignAcceptance {
  const result = parseAcceptanceShape(raw)
  for (const q of result.questions) {
    if (q.sourceBlockIds !== undefined && !sourceQuoteForBlocks(context, q.sourceBlockIds))
      throw new Error(`验收问题 ${q.id} 的来源块编号无效。`)
    if (!sourceContains(context, q.sourceQuote)) throw new Error(`验收问题 ${q.id} 的引文不在业务来源中。`)
  }
  return result
}

export function parseDesignCheckReport(raw: string, acceptance: DesignAcceptance, design: string, businessBasis: string,
  context: BusinessContext, previous: DesignCheckReport[] = []): DesignCheckReport {
  const result = readDesignCheckReport(parseJsonOutput(raw, '设计验收报告'))
  if (!result) throw new Error('设计验收报告结构不完整。')
  unique(result.answers.map(a => a.questionId), '验收回答')
  unique(result.issues.map(i => i.id), '审阅问题')
  const expected = new Set(acceptance.questions.map(q => q.id))
  const actual = new Set(result.answers.map(a => a.questionId))
  if (actual.size !== expected.size || [...expected].some(id => !actual.has(id)))
    throw new Error('验收回答必须恰好覆盖固定清单中的全部问题，不得遗漏或增加未知编号。')
  const artifacts = { design, basis: businessBasis }
  const definitionTexts = { design: definitionQuoteText(design), basis: definitionQuoteText(businessBasis) }
  const definitionContains = (artifact: 'design' | 'basis', quote: string) =>
    contains(artifacts[artifact], quote) || contains(definitionTexts[artifact], definitionQuoteText(quote))
  for (const a of result.answers) {
    if (!sourceContains(context, a.sourceQuote)) throw new Error(`${a.questionId} 的业务引文不存在。`)
    for (const e of a.evidence) {
      if (!definitionContains('design', e.quote)) throw new Error(`${a.questionId} 引用了当前设计中不存在的定义。`)
    }
    if ((a.status === 'supported' || a.status === 'bounded') && !a.evidence.length)
      throw new Error(`${a.questionId} 缺少当前设计的定义证据。`)
    if (a.status === 'supported' ? !!a.gap.trim() : !a.gap.trim())
      throw new Error(`${a.questionId} 的状态与缺口或边界说明不一致。`)
  }
  for (const i of result.issues) {
    if (!sourceContains(context, i.sourceQuote)) throw new Error(`${i.id} 的业务引文不存在。`)
    for (const e of i.evidence) {
      if (!definitionContains(e.artifact, e.quote))
        throw new Error(`${i.id} 的修复证据不在当前${e.artifact === 'design' ? '设计' : '依据'}中。`)
    }
    if (i.status === 'resolved' && !i.evidence.length) throw new Error(`${i.id} 宣称解决但没有修复证据。`)
    if (i.status === 'resolved' && i.type === 'model' && !i.evidence.some(e => e.artifact === 'design'))
      throw new Error(`${i.id} 的模型修复需要当前设计证据。`)
    if (i.status === 'resolved' && i.type === 'basis' && !i.evidence.some(e => e.artifact === 'basis'))
      throw new Error(`${i.id} 的依据修复需要当前依据证据。`)
  }
  for (const prior of previous.flatMap(r => r.issues)) {
    const current = result.issues.find(i => i.id === prior.id)
    if (!current) throw new Error(`历史问题 ${prior.id} 未复查。`)
    for (const key of ['type', 'sourceQuote', 'problem', 'acceptance'] as const) {
      if (current[key] !== prior[key]) throw new Error(`历史问题 ${prior.id} 的 ${key} 被改变，不能改弱问题或验收条件。`)
    }
  }
  return result
}

export function checkedDesignVerdict(report: DesignCheckReport): DesignVerdict {
  const open = report.issues.filter(i => i.status === 'open')
  if (open.some(i => i.type === 'basis')) return 'basis-revise'
  if (report.answers.some(a => a.status === 'gap') || open.some(i => i.type === 'model')) return 'revise'
  if (report.answers.some(a => a.status === 'clarify') || open.some(i => i.type === 'business')) return 'clarify'
  // A report that only rejects the checklist has demonstrated no model support.
  if (!report.answers.some(a => a.status === 'supported')) return 'unknown'
  return 'sufficient'
}

export function designCheckMarkdown(report: DesignCheckReport, acceptance: DesignAcceptance): string {
  const verdict = checkedDesignVerdict(report)
  const labels = { sufficient: '可表达', revise: '需修改', 'basis-revise': '需校正依据', clarify: '业务待澄清', unknown: '需人工审阅' }
  const statuses = { supported: '有定义支持', gap: '模型缺口', clarify: '业务待澄清', bounded: '已保留未决边界', 'not-applicable': '验收预期不适用' }
  return `结论：${labels[verdict]}\n\n${report.summary}\n\n${report.answers.map(a => {
    const q = acceptance.questions.find(q => q.id === a.questionId)!
    return `### ${a.questionId} · ${q.question} · ${statuses[a.status]}\n\n业务来源：${a.sourceQuote}\n\n验收预期：${q.expected}\n\n场景：${a.scenario}\n\n定义证据：\n${a.evidence.map(e => `- ${e.quote}\n  ${e.reason}`).join('\n') || '无'}\n\n实际结果：${a.result}${a.gap ? `\n\n缺口或边界：${a.gap}` : ''}`
  }).join('\n\n')}\n\n${report.issues.map(i =>
    `### ${i.id} · ${{ basis: '依据错误', model: '模型缺口', business: '业务未知' }[i.type]} · ${i.status === 'open' ? '未解决' : '已解决'}\n\n业务来源：${i.sourceQuote}\n\n问题及受影响场景：${i.problem}\n\n修复验收：${i.acceptance}\n\n复查：${i.resolution}\n\n${i.evidence.map(e => `- ${e.artifact === 'design' ? '设计' : '依据'}：${e.quote}\n  ${e.reason}`).join('\n')}`,
  ).join('\n\n')}`.trim()
}
