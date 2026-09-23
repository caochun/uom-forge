// Stable, browser/server-compatible artifact identity. Not an authentication hash.
export function artifactVersion(value: unknown): string {
  const canonical = (item: unknown): string => {
    if (Array.isArray(item)) return `[${item.map(canonical).join(',')}]`
    if (item && typeof item === 'object') return `{${Object.entries(item)
      .filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
    return JSON.stringify(item) ?? 'null'
  }
  const text = canonical(value)
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return `v1-${text.length}-${(hash >>> 0).toString(16)}`
}
