import { readUnderstandingReview } from '../shared/workflow.ts'
import type {
  AnalysisEvent,
  AnalysisResult,
  AnalysisResults,
} from '../shared/analysis.ts'
import type { AnalysisStage } from './types.ts'
import { isRecord } from './values.ts'
import { validateSemanticPlan } from '../shared/semantic-validation.ts'

// The server validates business payloads. This boundary checks the SSE envelope
// and revalidates the persisted semantic handoff before it reaches UI state.
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
    case 'model-plan':
      if (
        typeof value.semanticPlan === 'string' &&
        value.part === 'semantic' &&
        Array.isArray(value.clarifications)
      )
        return value as AnalysisEvent
      break
    case 'semantic-plan':
      if (value.part === 'semantic' && isRecord(value.semantic))
        return {
          type: 'semantic-plan',
          part: 'semantic',
          semantic: validateSemanticPlan(value.semantic),
        }
      break
    case 'model-checkpoint':
      if (
        isRecord(value.model) &&
        isRecord(value.expressionReview) &&
        Array.isArray(value.expressionReview.snapshots)
      )
        return value as AnalysisEvent
      break
    case 'understanding-review':
      if (value.review !== undefined) return { type: 'understanding-review', review: readUnderstandingReview(value.review)! }
      break
    case 'understanding-narrative':
      if (typeof value.narrative === 'string') return value as AnalysisEvent
      break
    case 'result':
      if (isRecord(value.result)) return value as AnalysisEvent
  }
  throw new Error('分析服务返回了无效事件')
}
export function isStageResult<S extends AnalysisStage>(
  stage: S,
  result: AnalysisResult,
): result is AnalysisResults[S] {
  const fields = {
    understand: ['understanding'],
    model: ['semanticPlan', 'model', 'clarifications', 'expressionReview'],
    compile: ['semanticPlan', 'model', 'clarifications', 'expressionReview'],
    verify: ['semanticPlan', 'model', 'clarifications', 'expressionReview'],
    map: ['semanticPlan', 'model', 'clarifications', 'expressionReview'],
    narrate: ['narrative'],
    assess: ['assessment'],
  } as const
  return fields[stage].every((field) => field in result)
}
export function discussionText(value: unknown): string {
  if (!isRecord(value)) throw new Error('讨论服务返回了无效结果')
  if (typeof value.error === 'string') throw new Error(value.error)
  if (typeof value.text !== 'string') throw new Error('讨论服务没有返回文本')
  return value.text
}
