import type { BusinessClarification } from '../../shared/analysis.ts'
import { containsBasis, questionKey } from '../../shared/clarifications.ts'

const text = { type: 'string', minLength: 1, pattern: '\\S' }
export const CLARIFICATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'basis', 'ambiguity', 'impact', 'options', 'multiple'],
  properties: {
    text,
    basis: text,
    ambiguity: text,
    impact: text,
    options: { type: 'array', uniqueItems: true, items: text },
    multiple: { type: 'boolean' },
  },
}

function semanticText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(semanticText).join('\n')
  if (value && typeof value === 'object')
    return Object.values(value).map(semanticText).join('\n')
  return ''
}

export function validateClarifications(
  items: BusinessClarification[],
  source: unknown,
): void {
  const text = semanticText(source)
  const seen = new Set<string>()
  for (const item of items) {
    const key = questionKey(item.text)
    if (!key || seen.has(key)) throw new Error('业务澄清问题重复或无效。')
    seen.add(key)
    if (!containsBasis(text, item.basis))
      throw new Error(`业务澄清“${item.text}”的依据不在本次输入中。`)
  }
}
