import type {
  AnalysisEvent,
  AnalysisResult,
  AnalysisResults,
  DiscussionEvent,
} from '../shared/analysis.ts'
import type { AnalysisStage } from './types.ts'
import { isRecord } from './values.ts'
import { readDesignReview } from '../shared/design-review.ts'

// The server validates business payloads. This boundary checks the SSE envelope
// before it is applied to the current draft.
export function parseAnalysisEvent(value: unknown): AnalysisEvent {
  if (!isRecord(value)) throw new Error('分析服务返回了无效事件')
  switch (value.type) {
    case 'phase':
    case 'delta':
      if (typeof value.text === 'string') return value as AnalysisEvent
      break
    case 'error':
      if (typeof value.error === 'string') return value as AnalysisEvent
      break
    case 'timing':
      if (isRecord(value.timing) && typeof value.timing.callId === 'string')
        return value as AnalysisEvent
      break
    case 'model-design':
      if (
        typeof value.modelDesign === 'string' &&
        value.part === 'design' &&
        Array.isArray(value.clarifications)
      )
        return value as AnalysisEvent
      break
    case 'business-basis':
      if (value.part === 'basis' && typeof value.text === 'string') return value as AnalysisEvent
      break
    case 'design-review': {
      const review = readDesignReview(value.review)
      if (value.part === 'design' && review && (value.modelDesign === undefined || typeof value.modelDesign === 'string'))
        return { type: 'design-review', part: 'design', review, ...(typeof value.modelDesign === 'string' ? { modelDesign: value.modelDesign } : {}) }
      break
    }
    case 'understanding-narrative':
      if (typeof value.narrative === 'string') return value as AnalysisEvent
      break
    case 'result':
      if (isRecord(value.result)) return value as AnalysisEvent
  }
  throw new Error('分析服务返回了无效事件')
}

export function parseDiscussionEvent(value: unknown): DiscussionEvent {
  if (!isRecord(value)) throw new Error('讨论服务返回了无效事件')
  if (value.type === 'delta' && typeof value.text === 'string')
    return { type: 'delta', text: value.text, ...(value.reasoning === true ? { reasoning: true } : {}) }
  if (value.type === 'result' && typeof value.text === 'string')
    return { type: 'result', text: value.text }
  if (value.type === 'error' && typeof value.error === 'string')
    return { type: 'error', error: value.error }
  throw new Error('讨论服务返回了无效事件')
}
export function isStageResult<S extends AnalysisStage>(
  stage: S,
  result: AnalysisResult,
): result is AnalysisResults[S] {
  const fields = {
    understand: ['understanding'],
    model: ['modelDesign', 'model', 'clarifications'],
    compile: ['modelDesign', 'model', 'clarifications'],
    narrate: ['narrative'],
    assess: ['assessment'],
  } as const
  return fields[stage].every((field: string) => field in result)
}
export function discussionText(value: unknown): string {
  if (!isRecord(value)) throw new Error('讨论服务返回了无效结果')
  if (typeof value.error === 'string') throw new Error(value.error)
  if (typeof value.text !== 'string') throw new Error('讨论服务没有返回文本')
  return value.text
}
