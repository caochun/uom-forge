import { designReviewLabel } from '../shared/design-review.ts'
import type { StagePart } from '../shared/analysis.ts'
import type { CandidateDraft, ModelViewMode, ModelDesign, StageTiming } from './types.ts'

export type ModelingStep = 'basis' | 'decisions' | 'compile'
export type ProgressState = 'waiting' | 'active' | 'done' | 'attention' | 'stale'
export type ModelRunStatus = 'running' | 'completed' | 'failed' | 'stopped'
export type ProgressItem = { id: ModelingStep; tab: ModelViewMode; label: string; detail: string; state: ProgressState }
export type ModelingProgress = ReturnType<typeof modelingProgress>

// The modeling workspace has one progress item per current workflow tab.
export function modelingProgress({ plan, candidate, runningPart, planStale, candidateStale }: {
  plan: ModelDesign | null; candidate: CandidateDraft | null; runningPart?: StagePart | '';
  planStale?: boolean; candidateStale?: boolean;
}) {
  planStale ??= false
  candidateStale ??= false
  const currentCandidate = Boolean(candidate && (!plan || plan.compiled))
  const oldCandidate = Boolean(candidate && (!currentCandidate || candidateStale))
  const active = runningPart === 'basis' ? 'basis' : runningPart === 'design' || runningPart === 'design-check' ? 'decisions'
    : runningPart === 'compile' ? 'compile' : undefined
  const steps: ProgressItem[] = [
    { id: 'basis', tab: 'evidence', label: '建模依据',
      detail: plan?.businessBasisComplete ? '建模依据已生成' : plan?.businessBasis ? '部分内容已保留' : '等待整理',
      state: plan?.businessBasisComplete ? 'done' : 'waiting' },
    { id: 'decisions', tab: 'decisions', label: '模型设计',
      detail: plan?.designReview ? designReviewLabel(plan.designReview) : plan?.complete ? '设计草案已生成' : plan?.plan ? '部分设计已保留' : '等待生成设计',
      state: plan?.designReview?.status === 'attention' ? 'attention' : plan?.complete ? 'done' : 'waiting' },
    { id: 'compile', tab: 'model', label: '模型视图',
      detail: oldCandidate ? '保留上轮模型' : currentCandidate ? `模型 v${candidate!.revision} · 结构检查通过` : '等待生成模型',
      state: oldCandidate ? 'stale' : currentCandidate ? 'done' : 'waiting' },
  ]
  for (const step of steps) {
    if (planStale && step.tab !== 'model' && step.state !== 'waiting') {
      step.state = 'stale'; step.detail = step.id === 'basis' ? '建模依据需要更新' : '设计需要更新'
    }
    if (step.id === active) {
      step.state = 'active'
      step.detail = step.id === 'basis' ? '正在整理建模依据' : step.id === 'decisions'
        ? plan?.designReview ? designReviewLabel(plan.designReview) : '正在生成设计草案' : '正在生成模型'
    }
  }
  return {
    steps,
    tabs: steps.map(step => ({ id: step.tab, label: step.label, state: step.state, detail: step.detail })),
    active: steps.find(step => step.id === active), oldCandidate,
    counts: null,
  }
}

// A compilation retry belongs to the latest run; a later full rebuild must
// not include timings left over from an earlier retry.
export function latestModelTimings(
  timings: Partial<Record<'model' | 'compile', StageTiming[]>>,
) {
  const runs = [timings.model, timings.compile].filter((items): items is StageTiming[] => Boolean(items?.length))
  return runs.sort((a, b) => Date.parse(b[0].startedAt) - Date.parse(a[0].startedAt))[0] || []
}

export function prepareCompilationRetry(plan: ModelDesign): ModelDesign {
  return {
    ...plan,
    compiled: false,
    compilation: undefined,
    warnings: [],
  }
}
