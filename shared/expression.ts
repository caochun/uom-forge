import type { BusinessClarification } from './analysis.ts'
import type { CandidateModel } from './model.ts'

// Construction metadata, never part of the ontology or final assessment input.
export interface ExpressionCase {
  id: string
  fact: string
  basis: string
  scenario: string
  status: 'expressed' | 'defect' | 'uncertain'
  elements: string[]
  explanation: string
  gap: string
  suggestion: string
}
export interface ExpressionCheck {
  summary: string
  cases: ExpressionCase[]
  clarifications: BusinessClarification[]
  warnings: string[]
}
export interface ModelChange {
  collection: string
  id: string
  value: unknown
  caseIds: string[]
  reason: string
}
export interface ExpressionReview {
  status: 'checking' | 'repairing' | 'passed' | 'issues' | 'incomplete'
  snapshots: { model: CandidateModel; check?: ExpressionCheck }[]
  selectedSnapshot: number
  changes: ModelChange[]
  warnings: string[]
}
export const EXPRESSION_STATUS = {
  checking: '正在检查业务事实',
  repairing: '正在定点修正',
  passed: '本轮检查用例均可表达',
  issues: '仍有未解决事项',
  incomplete: '检查未完成，候选已保留',
} as const
export const STAGE_PART_LABELS = {
  reading: '理解业务',
  semantic: '形成建模说明',
  compile: '构造候选模型',
  expression: '检查业务事实',
  repair: '定点修正模型',
  recheck: '复查业务事实',
} as const

export function interruptReview(review: ExpressionReview): ExpressionReview {
  return review.status === 'checking' || review.status === 'repairing'
    ? {
        ...review,
        status: 'incomplete',
        warnings: [
          ...review.warnings,
          '任务中断，保留最后一次有效候选和已完成检查。',
        ],
      }
    : review
}
