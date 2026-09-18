import type { StagePart } from '../shared/analysis.ts'
import type { ElementMapping } from '../shared/semantic.ts'
import type {
  CandidateDraft,
  ModelViewMode,
  SemanticPlan,
  StageTiming,
} from './types.ts'

export type ModelingStep =
  | 'facts'
  | 'stories'
  | 'decisions'
  | 'compile'
  | 'expression'
  | 'mapping'
export type ProgressState =
  | 'waiting'
  | 'active'
  | 'done'
  | 'attention'
  | 'stale'
export type ModelRunStatus = 'running' | 'completed' | 'failed' | 'stopped'
export type ProgressItem = {
  id: ModelingStep
  tab: ModelViewMode
  label: string
  detail: string
  state: ProgressState
}
export type ModelingProgress = ReturnType<typeof modelingProgress>

export function coverageForFact(factId: string, mappings: ElementMapping[]) {
  const matches = mappings.filter((mapping) => mapping.factId === factId)
  if (matches.some((mapping) => mapping.coverage === 'full')) return 'full'
  if (matches.some((mapping) => mapping.coverage === 'partial'))
    return 'partial'
  return 'missing'
}

// Use validated artifacts and the stage enum, never Chinese progress messages,
// to associate backend work with its destination in the workspace.
export function modelingProgress({
  plan,
  candidate,
  runningPart,
  planStale = false,
  candidateStale = false,
}: {
  plan: SemanticPlan | null
  candidate: CandidateDraft | null
  runningPart?: StagePart | ''
  planStale?: boolean
  candidateStale?: boolean
}) {
  const semantic = plan?.semantic
  const facts = semantic?.facts.length || 0
  const storiesReady =
    semantic?.status === 'stories' || semantic?.status === 'mapped'
  const currentCandidate = Boolean(candidate && (!plan || plan.compiled))
  const oldCandidate = Boolean(
    candidate && (!currentCandidate || candidateStale),
  )
  const reviewStale = oldCandidate || Boolean(candidate?.edited)
  const review = currentCandidate ? candidate?.expressionReview : undefined
  const remaining =
    review?.snapshots[review.selectedSnapshot]?.check?.cases.filter(
      (item) => item.status !== 'expressed',
    ).length || 0
  const counts =
    semantic?.status === 'mapped'
      ? semantic.facts.reduce(
          (result, fact) => {
            result[coverageForFact(fact.id, semantic.mappings)]++
            return result
          },
          { full: 0, partial: 0, missing: 0 },
        )
      : null
  const active: ModelingStep | undefined = !runningPart
    ? undefined
    : runningPart === 'compile'
      ? 'compile'
      : ['expression', 'repair', 'recheck'].includes(runningPart)
        ? 'expression'
        : runningPart === 'semantic'
          ? !facts
            ? 'facts'
            : !storiesReady
              ? 'stories'
              : !plan?.complete
                ? 'decisions'
                : 'mapping'
          : undefined
  const steps: ProgressItem[] = [
    {
      id: 'facts',
      tab: 'evidence',
      label: '业务事实',
      detail: facts ? `${facts} 项事实` : '等待提取',
      state: facts ? 'done' : 'waiting',
    },
    {
      id: 'stories',
      tab: 'evidence',
      label: '业务故事',
      detail: storiesReady
        ? `${semantic?.stories.length || 0} 个故事`
        : '等待组织',
      state: storiesReady ? 'done' : 'waiting',
    },
    {
      id: 'decisions',
      tab: 'decisions',
      label: '模型设计',
      detail: plan?.complete
        ? currentCandidate &&
          (candidate?.edited || candidate?.expressionReview?.changes.length)
          ? '初始设计 · 模型已有调整'
          : '设计草案已生成'
        : '等待生成设计',
      state: plan?.complete ? 'done' : 'waiting',
    },
    {
      id: 'compile',
      tab: 'model',
      label: '候选模型',
      detail: oldCandidate
        ? '保留上轮模型'
        : currentCandidate
          ? `模型 v${candidate!.revision}`
          : '等待编译',
      state: oldCandidate ? 'stale' : currentCandidate ? 'done' : 'waiting',
    },
    {
      id: 'expression',
      tab: 'model',
      label: '表达检查',
      detail: reviewStale
        ? '检查需要更新'
        : review?.status === 'passed'
          ? '本轮用例通过'
          : review?.status === 'issues'
            ? remaining
              ? `${remaining} 项待处理`
              : '检查警告待审阅'
            : currentCandidate
              ? '检查未完成'
              : '等待检查',
      state: reviewStale
        ? 'stale'
        : review?.status === 'passed'
          ? 'done'
          : currentCandidate
            ? 'attention'
            : 'waiting',
    },
    {
      id: 'mapping',
      tab: 'evidence',
      label: '事实覆盖',
      detail: counts
        ? reviewStale
          ? '覆盖需要更新'
          : `完整 ${counts.full} · 部分 ${counts.partial} · 缺失 ${counts.missing}`
        : currentCandidate && semantic && !runningPart
          ? '映射未完成'
          : '等待映射',
      state: counts
        ? reviewStale
          ? 'stale'
          : counts.partial || counts.missing
            ? 'attention'
            : 'done'
        : currentCandidate && semantic && !runningPart
          ? 'attention'
          : 'waiting',
    },
  ]
  for (const step of steps) {
    if (step.tab !== 'model' && planStale && step.state !== 'waiting') {
      step.state = 'stale'
      step.detail =
        step.id === 'decisions' ? '设计需要更新' : '业务依据已变化，需要更新'
    }
    if (step.id === active) {
      step.state = 'active'
      step.detail = {
        facts: '正在提取事实',
        stories: '正在组织故事',
        decisions: '正在生成设计草案',
        compile: '正在编译模型',
        expression:
          runningPart === 'repair'
            ? '正在修正模型'
            : runningPart === 'recheck'
              ? '正在复查'
              : '正在检查',
        mapping: '正在建立覆盖映射',
      }[step.id]
    }
  }
  const tabs = (
    [
      ['evidence', '业务依据'],
      ['decisions', '模型设计'],
      ['model', '模型视图'],
    ] as const
  ).map(([id, label]) => {
    const items = steps.filter((step) => step.tab === id)
    const prioritized = (['active', 'stale', 'attention'] as const)
      .map((state) => items.find((step) => step.state === state))
      .find(Boolean)
    const state: ProgressState =
      prioritized?.state ||
      (items.every((step) => step.state === 'done') ? 'done' : 'waiting')
    const detail =
      prioritized?.detail ||
      (id === 'evidence' && facts
        ? `${facts} 项事实 · ${semantic?.stories.length || 0} 个故事`
        : id === 'model' && currentCandidate
          ? `模型 v${candidate!.revision} · 本轮用例通过`
          : items[0].detail)
    return { id, label, state, detail }
  })
  return {
    steps,
    tabs,
    active: steps.find((step) => step.id === active),
    oldCandidate,
    reviewStale,
    counts,
  }
}

// A compilation retry belongs to the latest run; a later full rebuild must
// not include timings left over from an earlier retry.
export function latestModelTimings(
  timings: Partial<Record<'model' | 'compile', StageTiming[]>>,
) {
  const model = timings.model || []
  const compile = timings.compile || []
  if (!compile.length) return model
  if (!model.length) return compile
  return Date.parse(compile[0].startedAt) > Date.parse(model[0].startedAt)
    ? compile
    : model
}

export function prepareCompilationRetry(plan: SemanticPlan): SemanticPlan {
  return {
    ...plan,
    compiled: false,
    warnings: [],
    ...(plan.semantic
      ? {
          semantic: {
            ...plan.semantic,
            status: plan.semantic.status === 'facts' ? 'facts' : 'stories',
            mappings: [],
          },
        }
      : {}),
  }
}
