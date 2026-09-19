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

export interface UnderstandingReview {
  status: 'passed' | 'issues' | 'incomplete'
  narrativeVersion: string
  sourceVersion: string
  findings: {
    kind: 'omission' | 'unsupported' | 'conflict'
    blockIds: string[]
    passage: string
    note: string
  }[]
  warnings: string[]
}

export interface ModelLineage {
  narrativeVersion: string
  planVersion: string
  compiledModelVersion: string
  candidateVersion: string
}
export function readLineage(value: unknown): ModelLineage | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  return ['narrativeVersion', 'planVersion', 'compiledModelVersion', 'candidateVersion'].every(k => typeof record[k] === 'string')
    ? record as unknown as ModelLineage : undefined
}

export function readUnderstandingReview(value: unknown): UnderstandingReview | undefined {
  if (value === undefined) return undefined
  const r = value as UnderstandingReview
  if (!r || !['passed', 'issues', 'incomplete'].includes(r.status) ||
    typeof r.narrativeVersion !== 'string' || typeof r.sourceVersion !== 'string' ||
    !Array.isArray(r.warnings) || r.warnings.some(x => typeof x !== 'string') ||
    !Array.isArray(r.findings) || r.findings.some(x => !x || !['omission', 'unsupported', 'conflict'].includes(x.kind) ||
      !Array.isArray(x.blockIds) || x.blockIds.some(id => typeof id !== 'string') || typeof x.passage !== 'string' || typeof x.note !== 'string'))
    throw new Error('业务理解核对结果结构无效。')
  return r
}

export const REPAIR_TARGET_LABELS = {
  model: '修正候选模型',
  understanding: '回到业务理解核对',
  clarification: '补充业务事实',
} as const
