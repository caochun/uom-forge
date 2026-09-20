export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
export function parseJsonOutput(text: string, label = '分析结果'): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    // A model may emit an incomplete closing Markdown fence after a complete
    // JSON value. Remove only a standalone fence line, never business content.
    .replace(/\r?\n[ \t]*`{1,2}[ \t]*$/, '')
  try {
    return JSON.parse(cleaned) as unknown
  } catch {
    throw new Error(`${label}不是有效的 JSON。`)
  }
}
