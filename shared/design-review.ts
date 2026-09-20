// Review of the human-readable design, not validation of the compiled model.
export type DesignVerdict = 'sufficient' | 'revise' | 'clarify' | 'unknown'
export interface DesignReview {
  status: 'drafting' | 'checking' | 'completed' | 'attention'
  round: number
  rounds: { design: string; feedback: string; verdict: DesignVerdict }[]
  planVersion?: string
  narrativeVersion?: string
  // New reviews use the derived basis; legacy reviews used the narrative.
  businessBasisVersion?: string
  feedbackDraft?: string
  reason?: 'sufficient' | 'clarify' | 'limit' | 'no-progress' | 'unavailable' | 'unrecognized' | 'interrupted'
}

export const DESIGN_REASONS: Record<NonNullable<DesignReview['reason']>, string> = {
  sufficient: '本轮检查情形可表达',
  clarify: '业务边界待确认，候选已保留',
  limit: '达到迭代上限，剩余意见供审阅',
  'no-progress': '设计未发生变化，剩余意见供审阅',
  unavailable: '表达检查暂不可用，设计已保留',
  unrecognized: '检查意见已保留，结论需人工审阅',
  interrupted: '迭代已中断，已生成内容保留',
}

export function designReviewLabel(review: DesignReview): string {
  if (review.status === 'drafting') return review.round > 1 ? `第 ${review.round} 轮：正在修订设计` : '正在生成设计草案'
  if (review.status === 'checking') return `第 ${review.round} 轮：正在检验业务表达`
  return review.reason ? DESIGN_REASONS[review.reason] : '检查意见供审阅'
}

// Decode application metadata only. Never validate the Markdown it contains.
export function readDesignReview(value: unknown): DesignReview | undefined {
  if (!value || typeof value !== 'object') return undefined
  const item = value as Record<string, unknown>
  if (!['drafting', 'checking', 'completed', 'attention'].includes(String(item.status)) ||
    !Number.isInteger(item.round) || Number(item.round) < 1 || !Array.isArray(item.rounds)) return undefined
  const rounds: DesignReview['rounds'] = []
  for (const entry of item.rounds) {
    if (!entry || typeof entry !== 'object' || typeof entry.design !== 'string' ||
      typeof entry.feedback !== 'string' || !['sufficient', 'revise', 'clarify', 'unknown'].includes(entry.verdict)) return undefined
    rounds.push({ design: entry.design, feedback: entry.feedback, verdict: entry.verdict })
  }
  return {
    status: item.status as DesignReview['status'], round: Number(item.round), rounds,
    ...(typeof item.planVersion === 'string' ? { planVersion: item.planVersion } : {}),
    ...(typeof item.narrativeVersion === 'string' ? { narrativeVersion: item.narrativeVersion } : {}),
    ...(typeof item.businessBasisVersion === 'string' ? { businessBasisVersion: item.businessBasisVersion } : {}),
    ...(typeof item.feedbackDraft === 'string' ? { feedbackDraft: item.feedbackDraft } : {}),
    ...(typeof item.reason === 'string' && Object.hasOwn(DESIGN_REASONS, item.reason) ? { reason: item.reason as DesignReview['reason'] } : {}),
  }
}

export function interruptDesignReview(review: DesignReview | undefined): DesignReview | undefined {
  return review && (review.status === 'drafting' || review.status === 'checking')
    ? { ...review, status: 'attention', reason: 'interrupted' } : review
}
