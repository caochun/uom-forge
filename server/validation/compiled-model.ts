import type { CandidateModel } from '../../shared/model.ts'
import { parseCandidateModel } from './model.ts'
import { isRecord, parseJsonOutput } from './values.ts'

const COLLECTIONS = ['objects', 'relations', 'actions', 'functions', 'rules', 'activities'] as const

/** Add fields that carry no semantics in the plan-only compilation round. */
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
      if (key === 'activities' && Array.isArray(item.requirements)) {
        normalized.requirements = item.requirements.map((requirement) =>
          isRecord(requirement)
            ? {
                ...requirement,
                status: requirement.status ?? 'partial',
                reason: requirement.reason ?? '待支撑评估',
                evidence: requirement.evidence ?? [],
              }
            : requirement,
        )
      }
      return normalized
    })
  }
  return model
}

export function validateCompiledModel(raw: string): CandidateModel {
  const candidate = parseCandidateModel(normalizeCompiledValue(parseJsonOutput(raw)), { blocks: [] })
  // Reject invalid references instead of silently removing objects or edges.
  for (const item of [...candidate.objects, ...candidate.relations]) {
    if (item.properties.length) throw new Error('本轮只识别概念，不细化属性。')
  }
  for (const item of [...candidate.actions, ...candidate.functions]) {
    if (item.inputs.length) throw new Error('本轮不细化操作和能力的输入字段。')
  }
  for (const activity of candidate.activities)
    for (const requirement of activity.requirements) {
      if (
        requirement.status !== 'partial' ||
        requirement.reason !== '待支撑评估'
      )
        throw new Error('模型整理阶段不能代替支撑评估。')
    }
  return candidate
}
