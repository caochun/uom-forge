import type { StagePart } from '../shared/analysis.ts'
import type { ModelDesign } from './types.ts'

/** Drop a failed generation's preview without erasing completed artifacts. */
export function resetPlanStream(plan: ModelDesign, part?: StagePart): ModelDesign {
  if (part === 'basis' && !plan.businessBasisComplete)
    return { ...plan, businessBasis: '', businessBasisReasoning: '' }
  if (part === 'design') return {
    ...plan, designDraft: '', designReasoning: '',
    ...(!plan.complete ? { plan: '' } : {}),
  }
  if (part === 'design-check') return {
    ...plan, designCheckReasoning: '',
    ...(plan.designReview ? { designReview: { ...plan.designReview, feedbackDraft: '' } } : {}),
  }
  if (part === 'compile' && plan.compilation) return {
    ...plan, compilation: { ...plan.compilation, text: '', reasoning: '' },
  }
  return plan
}
