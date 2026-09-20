import type { BusinessClarification } from './analysis.ts'
import type { CandidateModel } from './model.ts'
import type { ModelLineage, REPAIR_TARGET_LABELS } from './workflow.ts'

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
  factIds?: string[]
  repairTarget?: keyof typeof REPAIR_TARGET_LABELS
}
export interface ExpressionBaseline {
  cases: (Pick<ExpressionCase, 'id' | 'fact' | 'basis' | 'scenario'> &
    Partial<Pick<ExpressionCase, 'status' | 'factIds'>>)[]
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
  status: 'not-run' | 'checking' | 'repairing' | 'passed' | 'issues' | 'incomplete'
  snapshots: { model: CandidateModel; check?: ExpressionCheck }[]
  selectedSnapshot: number
  changes: ModelChange[]
  warnings: string[]
  lineage?: ModelLineage
}
export const EXPRESSION_STATUS = {
  'not-run': '尚未进行业务表达检查',
  checking: '正在检查业务事实',
  repairing: '正在定点修正',
  passed: '本轮检查用例均可表达',
  issues: '仍有未解决事项',
  incomplete: '检查未完成，候选已保留',
} as const
export const STAGE_PART_LABELS = {
  reading: '理解业务',
  basis: '整理业务依据',
  semantic: '生成模型设计',
  'design-check': '检验设计的业务表达',
  compile: '构造候选模型',
  expression: '检查业务事实',
  repair: '定点修正模型',
  recheck: '复查业务事实',
  mapping: '建立事实映射',
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
