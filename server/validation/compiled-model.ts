import type { CandidateModel } from '../../shared/model.ts'
import { parseCandidateModel } from './model.ts'
import { isRecord, parseJsonOutput } from './values.ts'

const COLLECTIONS = ['objects', 'relations', 'actions', 'functions', 'rules'] as const

/** Fill omitted arrays; business attribute and input semantics remain in the definitions. */
function normalizeCompiledValue(value: unknown): unknown {
  if (!isRecord(value)) return value
  const model: Record<string, unknown> = {
    schemaVersion: '1',
    ...value,
    boundaries: value.boundaries ?? [],
  }
  for (const key of COLLECTIONS) {
    const items = model[key] ?? []
    model[key] = items
    if (!Array.isArray(items)) continue
    model[key] = items.map((item) => {
      if (!isRecord(item)) return item
      const normalized: Record<string, unknown> = { ...item, evidence: item.evidence ?? [] }
      if (key === 'objects' || key === 'relations') normalized.properties = item.properties ?? []
      if (key === 'actions' || key === 'functions') normalized.inputs = item.inputs ?? []
      return normalized
    })
  }
  return model
}

export function validateCompiledModel(raw: string): CandidateModel {
  const candidate = parseCandidateModel(normalizeCompiledValue(parseJsonOutput(raw)), { blocks: [] })
  // Reject invalid references instead of silently removing objects or edges.
  for (const item of [...candidate.objects, ...candidate.relations]) {
    if (item.properties.length) throw new Error('当前模型不展开属性字段，请将必要属性语义保留在对应 description 或规则中，properties 留空。')
  }
  for (const item of [...candidate.actions, ...candidate.functions]) {
    if (item.inputs.length) throw new Error('当前模型不展开输入字段，请将必要输入语义保留在对应 description、前提或规则中，inputs 留空。')
  }
  return candidate
}
