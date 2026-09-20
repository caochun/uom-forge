import type { ProviderId } from './analysis.ts'

export type ReasoningEffort = 'default' | 'none' | 'enabled' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export const REASONING_LABELS: Record<ReasoningEffort, string> = {
  default: '服务默认',
  none: '关闭思考',
  enabled: '开启思考',
  low: '低（low）',
  medium: '中（medium）',
  high: '高（high）',
  xhigh: '更高（xhigh）',
  max: '最高（max）',
}

/** Only public model settings cross the server/browser boundary. */
export interface ModelReasoningOptions {
  model: string
  efforts: ReasoningEffort[]
  defaultEffort: ReasoningEffort
  description: string
}
export type ModelOptions = Record<ProviderId, ModelReasoningOptions>
