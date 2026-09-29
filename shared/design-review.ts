import { readDesignAcceptance, readDesignCheckReport, type DesignAcceptance, type DesignCheckReport } from './design-acceptance.ts'

// Review of the human-readable design, not validation of the compiled model.
export type DesignVerdict = 'sufficient' | 'revise' | 'basis-revise' | 'clarify' | 'unknown'
export interface DesignReview {
  status: 'preparing-checks' | 'drafting' | 'checking' | 'repairing-basis' | 'completed' | 'attention'
  round: number
  rounds: { design: string; feedback: string; verdict: DesignVerdict; businessBasis?: string; businessBasisVersion?: string;
    acceptanceVersion?: string; report?: DesignCheckReport; rawReport?: string; validationError?: string }[]
  acceptance?: DesignAcceptance
  acceptanceVersion?: string
  planVersion?: string
  narrativeVersion?: string
  sourceVersion?: string
  // Reviews are tied to the business basis used for the current design.
  businessBasisVersion?: string
  feedbackDraft?: string
  failure?: string
  reason?: 'sufficient' | 'clarify' | 'limit' | 'no-progress' | 'unavailable' | 'acceptance-unavailable' | 'basis-unavailable' | 'basis-unchanged' | 'unrecognized' | 'interrupted'
}

export const DESIGN_REASONS: Record<NonNullable<DesignReview['reason']>, string> = {
  sufficient: '本轮检查情形可表达',
  clarify: '业务边界待确认，候选已保留',
  limit: '达到迭代上限，剩余意见供审阅',
  'no-progress': '设计未发生变化，剩余意见供审阅',
  unavailable: '表达检查暂不可用，设计已保留',
  'acceptance-unavailable': '业务验收清单未完成，建模依据已保留',
  'basis-unavailable': '依据校正未完成，已有依据和设计已保留',
  'basis-unchanged': '依据未完成校正，剩余意见供审阅',
  unrecognized: '检查意见已保留，结论需人工审阅',
  interrupted: '迭代已中断，已生成内容保留',
}

export function designReviewLabel(review: DesignReview): string {
  if (review.status === 'preparing-checks') return '正在从业务来源确定验收问题'
  if (review.status === 'drafting') return review.round > 1 ? `第 ${review.round} 轮：正在修订设计` : '正在生成设计草案'
  if (review.status === 'checking') return `第 ${review.round} 轮：正在检验业务表达`
  if (review.status === 'repairing-basis') return `第 ${review.round} 轮：正在校正建模依据`
  return review.reason ? DESIGN_REASONS[review.reason] : '检查意见供审阅'
}

// Decode metadata and structured review artifacts; never parse design Markdown.
export function readDesignReview(value: unknown): DesignReview | undefined {
  if (!value || typeof value !== 'object') return undefined
  const item = value as Record<string, unknown>
  if (!['preparing-checks', 'drafting', 'checking', 'repairing-basis', 'completed', 'attention'].includes(String(item.status)) ||
    !Number.isInteger(item.round) || Number(item.round) < 0 || !Array.isArray(item.rounds)) return undefined
  const acceptance = readDesignAcceptance(item.acceptance)
  if (item.acceptance !== undefined && !acceptance) return undefined
  const rounds: DesignReview['rounds'] = []
  for (const entry of item.rounds) {
    if (!entry || typeof entry !== 'object' || typeof entry.design !== 'string' ||
      typeof entry.feedback !== 'string' || !['sufficient', 'revise', 'basis-revise', 'clarify', 'unknown'].includes(entry.verdict)) return undefined
    const report = readDesignCheckReport(entry.report)
    if (entry.report !== undefined && !report) return undefined
    rounds.push({ design: entry.design, feedback: entry.feedback, verdict: entry.verdict,
      ...(typeof entry.businessBasis === 'string' ? { businessBasis: entry.businessBasis } : {}),
      ...(typeof entry.businessBasisVersion === 'string' ? { businessBasisVersion: entry.businessBasisVersion } : {}),
      ...(typeof entry.acceptanceVersion === 'string' ? { acceptanceVersion: entry.acceptanceVersion } : {}),
      ...(report ? { report } : {}),
      ...(typeof entry.rawReport === 'string' ? { rawReport: entry.rawReport } : {}),
      ...(typeof entry.validationError === 'string' ? { validationError: entry.validationError } : {}),
    })
  }
  return {
    status: item.status as DesignReview['status'], round: Number(item.round), rounds,
    ...(acceptance ? { acceptance } : {}),
    ...(typeof item.acceptanceVersion === 'string' ? { acceptanceVersion: item.acceptanceVersion } : {}),
    ...(typeof item.planVersion === 'string' ? { planVersion: item.planVersion } : {}),
    ...(typeof item.narrativeVersion === 'string' ? { narrativeVersion: item.narrativeVersion } : {}),
    ...(typeof item.sourceVersion === 'string' ? { sourceVersion: item.sourceVersion } : {}),
    ...(typeof item.businessBasisVersion === 'string' ? { businessBasisVersion: item.businessBasisVersion } : {}),
    ...(typeof item.feedbackDraft === 'string' ? { feedbackDraft: item.feedbackDraft } : {}),
    ...(typeof item.failure === 'string' ? { failure: item.failure } : {}),
    ...(typeof item.reason === 'string' && Object.hasOwn(DESIGN_REASONS, item.reason) ? { reason: item.reason as DesignReview['reason'] } : {}),
  }
}

export function interruptDesignReview(review: DesignReview | undefined): DesignReview | undefined {
  return review && (review.status === 'preparing-checks' || review.status === 'drafting' || review.status === 'checking' || review.status === 'repairing-basis')
    ? { ...review, status: 'attention', reason: 'interrupted' } : review
}
