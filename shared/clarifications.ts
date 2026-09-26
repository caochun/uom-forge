import type { BusinessClarification } from './analysis.ts'

export const CLARIFICATION_SECTION = '需要补充的业务信息'

function sectionRange(
  plan: string,
): { start: number; end: number; body: string } | null {
  const heading = /^##[ \t]+需要补充的业务信息[ \t]*\r?$/m.exec(plan)
  if (!heading) return null
  const start = heading.index
  const bodyStart = start + heading[0].length
  const next = /^##[ \t]+/m.exec(plan.slice(bodyStart))
  const end = next ? bodyStart + next.index : plan.length
  return { start, end, body: plan.slice(bodyStart, end) }
}

export function modelingContent(plan: string): string {
  const range = sectionRange(plan)
  return range
    ? (plan.slice(0, range.start) + plan.slice(range.end)).trim()
    : plan
}

export const questionKey = (text: string): string =>
  text.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase()

export function containsBasis(source: string, basis: string): boolean {
  const normalize = (text: string) => text.replace(/[\s*_`“”‘’「」『』"']/g, '')
  const original = normalize(source)
  const quoted = normalize(basis)
  if (!quoted) return false
  if (original.includes(quoted)) return true
  // Contradictions can cite multiple source sentences. Formatting quotes may
  // change, but every semicolon-separated excerpt must still occur in the input.
  const excerpts = normalize(
    basis.replace(/[”」"]\s*(?:[；;]\s*)?[“「"]/g, '\u0000'),
  )
    .split(/[；;\u0000]/)
    .filter(Boolean)
  if (
    excerpts.length > 1 &&
    excerpts.every((excerpt) => original.includes(excerpt))
  )
    return true
  // A rationale may connect actual quoted excerpts with a short explanation.
  // Validate each quoted span; that check does not prove the interpretation.
  const quotes = [
    ...basis.matchAll(/“([^”]+)”|「([^」]+)」|"([^"]+)"|‘([^’]+)’/g),
  ].map((match) =>
    normalize(match[1] || match[2] || match[3] || match[4] || ''),
  )
  return (
    quotes.length > 0 &&
    quotes.every((quote) => quote && original.includes(quote))
  )
}

// The optional Markdown section carries review metadata, never ontology elements.
// Invalid requests are reported rather than silently becoming user questions.
export function parseModelClarifications(
  plan: string,
): BusinessClarification[] {
  const range = sectionRange(plan)
  if (!range || /^(?:无[。.]?|无需补充[。.]?)?$/.test(range.body.trim()))
    return []
  const result: BusinessClarification[] = []
  let current: BusinessClarification | undefined
  let field: 'basis' | 'ambiguity' | 'impact' | undefined
  for (const raw of range.body.split(/\r?\n/)) {
    const line = raw.trim().replace(/\*\*/g, '').replace(/\\$/, '').trim()
    if (!line) continue
    const item = /^\d+[.)、][ \t]+(.+)$/.exec(line)
    if (item) {
      current = {
        text: item[1],
        basis: '',
        ambiguity: '',
        impact: '',
        options: [],
        multiple: false,
      }
      result.push(current)
      field = undefined
      continue
    }
    if (!current)
      throw new Error('业务澄清需使用编号列表，并说明依据、歧义和影响。')
    const detail =
      /^(?:[-*][ \t]+)?(依据|歧义|影响|选项|多选)[ \t]*[:：][ \t]*(.*)$/.exec(
        line,
      )
    if (detail) {
      if (detail[1] === '选项' || detail[1] === '多选') {
        current.options = [
          ...new Set(
            detail[2]
              .split(/[；;]/)
              .map((item) => item.trim())
              .filter(Boolean),
          ),
        ]
        current.multiple = detail[1] === '多选'
        field = undefined
      } else {
        field =
          detail[1] === '依据'
            ? 'basis'
            : detail[1] === '歧义'
              ? 'ambiguity'
              : 'impact'
        current[field] = detail[2]
      }
    } else if (field) current[field] += '\n' + line
    else
      throw new Error(
        `业务澄清“${current.text}”存在无法识别的说明，请按依据、歧义和影响组织。`,
      )
  }
  const seen = new Set<string>()
  for (const item of result) {
    if (
      ![item.text, item.basis, item.ambiguity, item.impact].every((text) =>
        text.trim(),
      )
    )
      throw new Error(`业务澄清“${item.text}”缺少依据、歧义或对模型的影响。`)
    const key = questionKey(item.text)
    if (!key || seen.has(key)) throw new Error('业务澄清问题重复或无效。')
    seen.add(key)
  }
  return result
}

export interface ClarificationReview {
  clarifications: BusinessClarification[]
  warnings: string[]
}

// Quarantine optional questions individually. Never change the saved plan or
// let a malformed/questionable excerpt become a confirmed business premise.
export function reviewModelClarifications(
  plan: string,
  narrative?: string,
  businessBasis?: string,
): ClarificationReview {
  const result: ClarificationReview = { clarifications: [], warnings: [] }
  const range = sectionRange(plan)
  if (!range || /^(?:无[。.]?|无需补充[。.]?)?$/.test(range.body.trim()))
    return result
  if (narrative === undefined && businessBasis === undefined) {
    result.warnings.push(
      '本次仅整理已有建模说明，未重新校验其中的澄清依据；不新增待确认问题，已有问题仍保留在业务理解中。',
    )
    return result
  }
  const seen = new Set<string>()
  const items = range.body.trim().split(/(?=^[ \t]*\d+[.)、][ \t]+)/m)
  for (const body of items.filter((item) => item.trim())) {
    try {
      const parsed = parseModelClarifications(`## ${CLARIFICATION_SECTION}\n${body}`)
      if (parsed.length !== 1) throw new Error('业务澄清需使用编号列表。')
      const item = parsed[0]
      if (businessBasis !== undefined && containsBasis(businessBasis, item.basis))
        item.basisSource = 'business-basis'
      else if (narrative === undefined || !containsBasis(narrative, item.basis))
        throw new Error(`业务澄清“${item.text}”的依据不在${businessBasis === undefined ? '当前业务说明' : '本轮建模依据或文档整理稿'}中。`)
      const key = questionKey(item.text)
      if (seen.has(key)) throw new Error(`业务澄清“${item.text}”重复。`)
      seen.add(key)
      result.clarifications.push(item)
    } catch (error) {
      result.warnings.push(
        `${error instanceof Error ? error.message : String(error)}该项未加入待确认问题，原输出已保留；模型中已说明的不确定边界仍需审阅。`,
      )
    }
  }
  return result
}
