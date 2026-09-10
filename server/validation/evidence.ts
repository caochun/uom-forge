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
