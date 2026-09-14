import type { BusinessDocument } from '../../shared/analysis.ts'
import { isRecord } from './values.ts'

const normalize = (text: string) => text.replace(/\s+/g, '')
export function validateEvidence(
  value: unknown,
  document: Pick<BusinessDocument, 'blocks'>,
  location = 'model',
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validateEvidence(item, document, `${location}[${index}]`),
    )
    return
  }
  if (!isRecord(value)) return
  if (Array.isArray(value.evidence))
    for (const citation of value.evidence) {
      if (
        !isRecord(citation) ||
        typeof citation.quote !== 'string'
      )
        throw new Error(`${location} 的引文格式无效。`)
      if (!normalize(citation.quote)) throw new Error(`${location} 的引文不能为空。`)
      const source = document.blocks.map((item) => item.text).join('\n')
      if (!normalize(source).includes(normalize(citation.quote)))
        throw new Error(`${location} 的引文不在原文中。`)
    }
  for (const [key, child] of Object.entries(value))
    if (key !== 'evidence')
      validateEvidence(child, document, `${location}.${key}`)
}
