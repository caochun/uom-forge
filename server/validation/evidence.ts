import type { BusinessDocument } from '../../shared/analysis.ts'
import type { Evidence } from '../../shared/model.ts'
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
        typeof citation.quote !== 'string' ||
        typeof citation.blockId !== 'string'
      )
        throw new Error(`${location} 的引文格式无效。`)
      const block = document.blocks.find((item) => item.id === citation.blockId)
      if (
        !block ||
        !normalize(citation.quote) ||
        !normalize(block.text).includes(normalize(citation.quote))
      )
        throw new Error(
          `${location} 的引文不在原文证据块 ${citation.blockId} 中。`,
        )
    }
  for (const [key, child] of Object.entries(value))
    if (key !== 'evidence')
      validateEvidence(child, document, `${location}.${key}`)
}

// Correct an assessment's block id only when the exact quotation is found.
export function groundCitations(
  citations: Evidence[],
  document: BusinessDocument,
): Evidence[] {
  return citations.flatMap((citation) => {
    const quote = normalize(citation.quote)
    if (!quote) return []
    const requested = document.blocks.find(
      (block) => block.id === citation.blockId,
    )
    const block =
      requested && normalize(requested.text).includes(quote)
        ? requested
        : document.blocks.find((item) => normalize(item.text).includes(quote))
    return block ? [{ blockId: block.id, quote: citation.quote }] : []
  })
}
