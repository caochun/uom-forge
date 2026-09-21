import { prepareModelResume, resumeNarrative } from './model-resume.ts'
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Activity,
  ArrowRight,
  Bot,
  Check,
  ClipboardCheck,
  FileText,
  Network,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Save,
  Send,
  Square,
} from 'lucide-react'
import { documentToBlocks, readSse } from './document.ts'
import { advanceRevision, freshness, initialRevisions } from './workspace.ts'
import { extractQuestions } from '../shared/questions.ts'
import BusinessUnderstanding from './components/BusinessUnderstanding.tsx'
import ReasoningStream from './components/ReasoningStream.tsx'
import { reviseUnderstandingSources } from '../shared/understanding-sources.ts'
import ModelingRun from './components/ModelingRun.tsx'
import { modelingProgress, latestModelTimings, prepareCompilationRetry, type ModelRunStatus, type ProgressItem } from './modeling-progress.ts'
import {
  CandidateView,
  DocumentView,
  Markdown,
  Notice,
  ReviewView,
  TimingDetails,
} from './components/WorkbenchViews.tsx'
import './styles.css'
import type {
  AnalysisRequest,
  AnalysisResult,
  AnalysisResults,
  DiscussionRequest,
  AgentRuntimeId,
  ProviderId,
  DiscussionEvent,
} from '../shared/analysis.ts'
import {
  DEFAULT_PROVIDER,
  PROVIDERS,
  RUNTIMES,
} from '../shared/analysis.ts'
import type { ModelOptions, ReasoningEffort } from '../shared/reasoning.ts'
import { REASONING_LABELS } from '../shared/reasoning.ts'
import { interruptReview, STAGE_PART_LABELS } from '../shared/expression.ts'
import { designReviewLabel, interruptDesignReview } from '../shared/design-review.ts'
import type {
  AnalysisStage,
  DiscussionSubject,
  ModelViewMode,
  OnEdit,
  Project,
  ReviewViewMode,
  StageJob,
  WorkspaceMessage,
  WorkspacePage,
} from './types.ts'
import { restoreProject } from './persistence.ts'
import { isStageResult, parseDiscussionEvent } from './responses.ts'
import { isRecord } from './values.ts'
import { createId } from './id.ts'
import {
  hasUnsavedAnswers,
  reviseUnderstanding,
  saveUnderstandingAnswers,
  receiveClarifications,
} from './understanding.ts'

const STORAGE = 'uom-forge-project-v3'
const EMPTY_DOCUMENT = {
  name: '尚未上传业务文档',
  content: '',
  blocks: [],
  size: '—',
  updated: '',
}
const PAGES = [
  ['document', '业务文档', FileText],
  ['understanding', '业务理解', Activity],
  ['model', '建模', Network],
  ['review', '模型检验', ClipboardCheck],
] as const
const STAGES = {
  understand: '理解业务',
  model: '建立候选模型',
  compile: '整理候选模型',
  verify: '检查并修正当前候选',
  map: '建立事实映射',
  narrate: '生成模型自述',
  assess: '评估业务过程支撑',
}
const EMPTY_PROJECT: Project = {
  version: 4,
  document: EMPTY_DOCUMENT,
  understanding: null,
  answers: {},
  questionsSaved: false,
  feedback: '',
  feedbackDocumentRevision: null,
  plan: null,
  candidate: null,
  narration: '',
  assessment: null,
  outputs: {},
  timings: {},
  revisions: initialRevisions,
  messages: [
    {
      role: 'assistant',
      content:
        '上传文档后先整理内容、发现表述问题。你可以修订整理稿或确认问题，再开始建模：提炼业务依据、设计并检查模型，最后生成模型视图。',
    },
  ],
}
function loadProject(): Project {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE) || 'null')
    return restoreProject(saved, EMPTY_PROJECT)
  } catch {
    return EMPTY_PROJECT
  }
}

function App() {
  const [project, setProject] = useState(loadProject)
  const [view, setView] = useState<WorkspacePage>('document')
  const [modelMode, setModelMode] = useState<ModelViewMode>('evidence')
  const [evidenceMode, setEvidenceMode] = useState<'facts' | 'stories'>('facts')
  const [expressionFocus, setExpressionFocus] = useState(0)
  const [modelRunStatus, setModelRunStatus] = useState<ModelRunStatus>()
  const [reviewMode, setReviewMode] = useState<ReviewViewMode>('narration')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [assistantOpen, setAssistantOpen] = useState(
    () => window.innerWidth > 1050,
  )
  const [discussionContext, setDiscussionContext] =
    useState<DiscussionSubject | null>(null)
  const [draft, setDraft] = useState('')
  const [discussing, setDiscussing] = useState(false)
  const [discussionStream, setDiscussionStream] = useState({ text: '', reasoning: '' })
  const [editing, setEditing] = useState(false)
  const [editedNarrative, setEditedNarrative] = useState('')
  const [comparison, setComparison] = useState(false)
  const [readingStream, setReadingStream] = useState({ narrative: '', reasoning: '', complete: true })
  const [narratingText, setNarratingText] = useState('')
  const [narrationReasoning, setNarrationReasoning] = useState('')
  const [assessmentStream, setAssessmentStream] = useState({ text: '', reasoning: '' })
  const [expressionStream, setExpressionStream] = useState({ text: '', reasoning: '', part: '' })
  const [modelActivity, setModelActivity] = useState<string[]>([])
  const [job, setJob] = useState<StageJob | null>(null)
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  // The workbench defaults to the iterative local workflow. The shared
  // constants remain the protocol/server defaults for API callers.
  const [provider, setProvider] = useState<ProviderId>(DEFAULT_PROVIDER)
  const runtime: AgentRuntimeId = 'pi'
  const [modelOptions, setModelOptions] = useState<ModelOptions | null>(null)
  const [modelOptionsError, setModelOptionsError] = useState(false)
  const [modelOptionsAttempt, setModelOptionsAttempt] = useState(0)
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('default')
  const busyRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const cancelled = useRef(false)
  const projectRef = useRef(project)
  const messagesRef = useRef<HTMLDivElement | null>(null)
  const followMessages = useRef(true)
  projectRef.current = project
  useEffect(() => {
    const controller = new AbortController()
    setModelOptionsError(false)
    void fetch('/api/models', { signal: controller.signal })
      .then(response => response.ok ? response.json() as Promise<ModelOptions> : Promise.reject(new Error('model options unavailable')))
      .then(options => {
        if (controller.signal.aborted) return
        setModelOptions(options)
        setReasoningEffort(options[provider].defaultEffort)
      })
      .catch(() => { if (!controller.signal.aborted) setModelOptionsError(true) })
    return () => controller.abort()
  }, [modelOptionsAttempt])
  const stale = freshness(project.revisions)
  const unsavedAnswers = hasUnsavedAnswers(project)
  const pendingQuestions = project.understanding?.questions.length || 0
  const openQuestions = () => {
    setView('understanding')
    setEditing(false)
    window.setTimeout(
      () =>
        document
          .getElementById('business-questions')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      0,
    )
  }
  const model = project.candidate?.model
  const providerLabel = PROVIDERS[provider].label
  const runtimeLabel = RUNTIMES[runtime].label
  const currentLabel = PAGES.find(([id]) => id === view)?.[1]
  const canModel =
    Boolean(project.understanding?.narrative) &&
    !stale.understanding &&
    !unsavedAnswers &&
    !editing
  const canRetry =
    Boolean(project.plan?.complete && !project.plan?.compiled) &&
    !stale.plan &&
    !unsavedAnswers
  const canCheck =
    Boolean(model) && !stale.candidate && !unsavedAnswers && !editing
  const addMessage = (message: WorkspaceMessage) =>
    setProject((current) => ({
      ...current,
      messages: [...current.messages, { id: createId(), ...message }],
    }))

  const saveProject = (notify = false) => {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(projectRef.current))
      if (notify) setToast('项目已保存')
    } catch {
      setToast('浏览器存储空间不足，草稿未能保存。请先导出或释放空间。')
    }
  }
  useEffect(() => {
    const timer = setTimeout(() => saveProject(), 800)
    return () => clearTimeout(timer)
  }, [project])
  useEffect(() => {
    const save = () => saveProject()
    window.addEventListener('beforeunload', save)
    return () => window.removeEventListener('beforeunload', save)
  }, [])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 4500)
    return () => clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    if (!job) return
    const update = () =>
      setElapsed(Math.floor((Date.now() - job.started) / 1000))
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [job?.started])
  useEffect(() => {
    if (followMessages.current && messagesRef.current)
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
  }, [project.messages, discussing, assistantOpen])

  const execute = async (task: () => Promise<void>) => {
    if (busyRef.current) return
    if (!modelOptions) {
      setError('模型选项尚未加载，请稍后重试。')
      return
    }
    busyRef.current = true
    cancelled.current = false
    setBusy(true)
    setError('')
    try {
      await task()
    } catch (failure) {
      const stopped =
        cancelled.current ||
        (failure instanceof Error && failure.name === 'AbortError')
      const message = stopped
        ? '已停止当前任务，已完成结果和部分输出均已保留。'
        : failure instanceof Error
          ? failure.message
          : String(failure)
      setModelRunStatus((status) => status === 'running' ? stopped ? 'stopped' : 'failed' : status)
      if (!stopped) setError(message)
      addMessage({ role: 'assistant', content: message })
    } finally {
      setProject((current) => ({
        ...current,
        plan: current.plan ? { ...current.plan, designReview: interruptDesignReview(current.plan.designReview),
          ...(current.plan.compilation?.status === 'streaming'
            ? { compilation: { ...current.plan.compilation, status: 'interrupted' as const } } : {}),
        } : null,
        candidate: current.candidate?.expressionReview
          ? {
              ...current.candidate,
              expressionReview: interruptReview(
                current.candidate.expressionReview,
              ),
            }
          : current.candidate,
        timings: Object.fromEntries(
          Object.entries(current.timings || {}).map(([stage, records]) => [
            stage,
            records.map((record) =>
              record.status === 'running'
                ? {
                    ...record,
                    status: cancelled.current ? 'cancelled' : 'failed',
                  }
                : record,
            ),
          ]),
        ),
        messages: current.messages.map((message) =>
          message.progress
            ? {
                ...message,
                progress: false,
                content:
                  message.content +
                  (cancelled.current ? '已停止。' : '未完成。'),
              }
            : message,
        ),
      }))
      busyRef.current = false
      setBusy(false)
      setJob(null)
      abortRef.current = null
    }
  }
  const runStage = async <S extends AnalysisStage>(
    stage: S,
    body: Omit<Extract<AnalysisRequest, { stage: S }>, 'stage' | 'provider'>,
  ): Promise<AnalysisResults[S]> => {
    if (cancelled.current) throw new DOMException('已停止', 'AbortError')
    const controller = new AbortController()
    abortRef.current = controller
    const id = createId()
    const started = Date.now()
    const basis = projectRef.current.revisions.business
    const modelRevision = projectRef.current.revisions.model + 1
    const tracksModeling = stage === 'model' || stage === 'compile' || stage === 'verify' || stage === 'map'
    const addModelActivity = (text: string) => {
      if (!tracksModeling || !text.trim()) return
      setModelActivity((current) =>
        current.at(-1) === text ? current : [...current, text].slice(-100),
      )
    }
    if (tracksModeling) {
      setModelActivity([`${STAGES[stage]}已开始。`])
      setModelRunStatus('running')
    }
    setJob({
      stage,
      started,
      part: stage === 'compile' ? 'compile' : stage === 'verify' ? 'expression' : stage === 'map' ? 'mapping' : '',
      text: STAGES[stage],
    })
    setView(
      stage === 'understand'
        ? 'understanding'
        : stage === 'model' || stage === 'compile' || stage === 'verify' || stage === 'map'
          ? 'model'
          : 'review',
    )
    if (stage === 'narrate') {
      setReviewMode('narration')
      setNarratingText('')
      setNarrationReasoning('')
    }
    if (stage === 'assess') {
      setReviewMode('assessment')
      setAssessmentStream({ text: '', reasoning: '' })
    }
    if (stage === 'verify' || stage === 'map')
      setExpressionStream({ text: '', reasoning: '', part: '' })
    if (stage === 'understand')
      setReadingStream({ narrative: '', reasoning: '', complete: false })
    if (stage === 'model') {
      setProject((current) => ({
        ...current,
        plan: {
          plan: '', complete: false, compiled: false,
          basis: current.understanding ? {
            narrative: current.understanding.narrative,
            sources: current.understanding.sources,
          } : undefined,
        },
        outputs: { ...current.outputs, compile: '' },
        timings: { ...current.timings, model: [], compile: [] },
      }))
    } else if (stage === 'compile') {
      setProject((current) => ({
        ...current,
        plan: current.plan ? prepareCompilationRetry(current.plan) : null,
        timings: { ...current.timings, model: [], compile: [] },
      }))
    }
    setProject((current) => ({
      ...current,
      outputs: { ...current.outputs, [stage]: '' },
      timings: { ...current.timings, [stage]: [] },
      messages: [
        ...current.messages,
        {
          id,
          role: 'assistant',
          content: STAGES[stage],
          progress: true,
          stage,
        },
      ],
    }))
    const response = await fetch('/api/analyze/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, stage, provider, runtime, reasoningEffort }),
      signal: controller.signal,
    })
    if (!response.ok) {
      addModelActivity(`任务中断：分析服务返回 HTTP ${response.status}`)
      throw new Error('分析服务返回 HTTP ' + response.status)
    }
    const received: { result?: AnalysisResult } = {}
    let output = ''
    let part: import('../shared/analysis.ts').StagePart | '' = ''
    await readSse(response, (event) => {
      if (controller.signal.aborted)
        throw new DOMException('已停止', 'AbortError')
      if (event.type === 'timing') {
        setJob((current) =>
          current ? { ...current, timing: event.timing } : current,
        )
        setProject((current) => {
          const records = current.timings?.[stage] || []
          const record = { ...event.timing, part: event.part }
          return {
            ...current,
            ...(event.part === 'compile' && event.timing.status === 'running' && current.plan && current.plan.compilation?.callId !== event.timing.callId ? {
              plan: { ...current.plan, compilation: {
                text: '', reasoning: '', status: 'streaming' as const, callId: event.timing.callId,
                attempt: current.plan.compilation?.callId ? current.plan.compilation.attempt + 1 : 1,
              } },
            } : {}),
            timings: {
              ...current.timings,
              [stage]: records.some((item) => item.callId === record.callId)
                ? records.map((item) =>
                    item.callId === record.callId ? record : item,
                  )
                : [...records, record],
            },
          }
        })
      }
      if (event.type === 'phase') {
        addModelActivity(event.text)
        if (event.part === 'compile') setProject(current => current.plan && !current.plan.compilation ? ({
          ...current, plan: { ...current.plan, compilation: { text: '', reasoning: '', attempt: 1, status: 'streaming' } },
        }) : current)
        setJob((current) =>
          current
            ? {
                ...current,
                part: event.part || current.part,
                text: event.text,
              }
            : current,
        )
        if (stage === 'model' && event.part === 'semantic') {
          const semanticReasoningPart = event.text.includes('提取业务事实')
            ? 'facts' as const
            : event.text.includes('组织业务故事')
              ? 'stories' as const
              : undefined
          if (semanticReasoningPart) setProject(current => current.plan ? ({
            ...current,
            plan: { ...current.plan, semanticReasoning: '', semanticReasoningPart },
          }) : current)
          else setProject(current => current.plan ? ({
            ...current,
            plan: { ...current.plan, semanticReasoningPart: undefined },
          }) : current)
        }
        if ((stage === 'model' || stage === 'map') && event.part === 'mapping')
          setProject(current => current.plan ? ({
            ...current,
            plan: { ...current.plan, semanticReasoning: '', semanticReasoningPart: 'mapping' },
          }) : current)
        if (event.part === 'expression' || event.part === 'repair' || event.part === 'recheck')
          setExpressionStream(current => ({ ...current, part: event.part || current.part }))
      }
      if (event.type === 'delta') {
        if (event.part === 'compile') setProject(current => current.plan ? ({
          ...current, plan: { ...current.plan, compilation: {
            ...(current.plan.compilation || { text: '', reasoning: '', attempt: 1 }),
            status: 'streaming',
            [event.reasoning ? 'reasoning' : 'text']: (current.plan.compilation?.[event.reasoning ? 'reasoning' : 'text'] || '') + event.text,
          } },
        }) : current)
        if (
          event.part &&
          event.part !== part &&
          (stage === 'model' || stage === 'compile' || stage === 'verify' || stage === 'map')
        ) {
          part = event.part
          output += '\n\n—— ' + STAGE_PART_LABELS[part] + ' ——\n\n'
        }
        output += event.text || ''
        setProject((current) => ({
          ...current,
          outputs: { ...current.outputs, [stage]: output },
        }))
        if (stage === 'understand') {
          const field = event.reasoning ? 'reasoning' : 'narrative'
          setReadingStream(current => ({ ...current, [field]: current[field] + event.text }))
        }
        if (stage === 'narrate') {
          if (event.reasoning) setNarrationReasoning(current => current + event.text)
          else setNarratingText(current => current + event.text)
        }
        if (stage === 'assess') {
          setAssessmentStream(current => ({
            ...current,
            [event.reasoning ? 'reasoning' : 'text']: current[event.reasoning ? 'reasoning' : 'text'] + event.text,
          }))
        }
        if (event.part === 'expression' || event.part === 'repair' || event.part === 'recheck')
          setExpressionStream(current => ({
            ...current,
            part: event.part || current.part,
            [event.reasoning ? 'reasoning' : 'text']: current[event.reasoning ? 'reasoning' : 'text'] + event.text,
          }))
        if (stage === 'model' && event.part === 'basis') {
          const field = event.reasoning ? 'businessBasisReasoning' : 'businessBasis'
          setProject(current => current.plan && !current.plan.businessBasisComplete ? ({
            ...current, plan: { ...current.plan, [field]: (current.plan[field] || '') + event.text },
          }) : current)
        }
        if (stage === 'model' && event.reasoning && event.part === 'semantic')
          setProject(current => current.plan ? ({
            ...current,
            plan: current.plan.semanticReasoningPart
              ? { ...current.plan, semanticReasoning: (current.plan.semanticReasoning || '') + event.text }
              : { ...current.plan, designReasoning: (current.plan.designReasoning || '') + event.text },
          }) : current)
        if ((stage === 'model' || stage === 'map') && event.reasoning && event.part === 'mapping')
          setProject(current => current.plan ? ({
            ...current,
            plan: { ...current.plan, semanticReasoning: (current.plan.semanticReasoning || '') + event.text },
          }) : current)
        if (stage === 'model' && event.reasoning && event.part === 'design-check')
          setProject(current => current.plan ? ({
            ...current,
            plan: { ...current.plan, designCheckReasoning: (current.plan.designCheckReasoning || '') + event.text },
          }) : current)
        if (!event.reasoning) {
          if (stage === 'model' && event.part === 'semantic')
            setProject((current) => current.plan?.designReview?.status === 'drafting' ? ({
              ...current, plan: { ...current.plan, designDraft: (current.plan.designDraft || '') + event.text },
            }) : current.plan && (current.plan.businessBasisComplete || current.plan.semantic?.status === 'stories') && !current.plan.complete ? ({
              ...current,
              plan: {
                ...current.plan,
                plan: (current.plan?.plan || '') + (event.text || ''),
              },
            }) : current)
          if (stage === 'model' && event.part === 'design-check')
            setProject(current => current.plan?.designReview ? ({
              ...current, plan: { ...current.plan, designReview: { ...current.plan.designReview,
                feedbackDraft: (current.plan.designReview.feedbackDraft || '') + event.text } },
            }) : current)
        }
      }
      if (event.type === 'design-review') {
        setProject(current => ({ ...current, plan: {
          ...(current.plan || { plan: '', complete: false, compiled: false }),
          designReview: event.review,
          ...(event.semanticPlan !== undefined
            ? { plan: event.semanticPlan, complete: true, compiled: false, designDraft: undefined }
            : event.review.status === 'drafting' && event.review.round !== current.plan?.designReview?.round
              ? { designDraft: '', designReasoning: '', designCheckReasoning: '' }
              : event.review.status === 'checking'
                ? { designCheckReasoning: '' } : {}),
        }, revisions: { ...current.revisions, planBasis: basis } }))
      }
      if (event.type === 'business-basis') {
        addModelActivity('业务依据已生成。')
        setProject(current => ({ ...current, plan: {
          ...(current.plan || { plan: '', complete: false, compiled: false }),
          businessBasis: event.text, businessBasisComplete: true,
        }, revisions: { ...current.revisions, planBasis: basis } }))
      }
      if (event.type === 'model-plan') {
        addModelActivity('设计草案已生成，正在编译候选模型。')
        setProject((current) =>
          receiveClarifications(
            {
              ...current,
              plan: {
                plan: event.semanticPlan,
                designReview: current.plan?.designReview,
                designDraft: current.plan?.designReview?.reason === 'interrupted' ? current.plan.designDraft : undefined,
                designReasoning: current.plan?.designReasoning,
                designCheckReasoning: current.plan?.designCheckReasoning,
                semanticReasoning: current.plan?.semanticReasoning,
                semanticReasoningPart: current.plan?.semanticReasoningPart,
                basis: current.plan?.basis,
                businessBasis: current.plan?.businessBasis,
                businessBasisReasoning: current.plan?.businessBasisReasoning,
                businessBasisComplete: current.plan?.businessBasisComplete,
                complete: true,
                compiled: false,
                warnings: event.warnings,
                ...(current.plan?.semantic
                  ? { semantic: current.plan.semantic }
                  : {}),
              },
              revisions: { ...current.revisions, planBasis: basis },
            },
            event.clarifications,
            'model',
          ),
        )
      }
      if (event.type === 'semantic-plan') {
        const semantic = event.semantic
        addModelActivity(
          semantic.status === 'facts'
            ? `已提取 ${semantic.facts.length} 项业务事实。`
            : semantic.status === 'stories'
              ? `已组织 ${semantic.stories.length} 个业务故事。`
              : `已完成 ${semantic.facts.length} 项事实的模型覆盖映射。`,
        )
        setProject((current) =>
          receiveClarifications(
            {
              ...current,
              plan: current.plan
                ? { ...current.plan, semantic: event.semantic }
                : {
                    plan: '',
                    complete: false,
                    compiled: false,
                    semantic: event.semantic,
                  },
            },
            event.semantic.clarifications,
            'model',
          ),
        )
      }
      if (event.type === 'model-checkpoint') {
        const elementCount =
          event.model.objects.length + event.model.relations.length +
          event.model.actions.length + event.model.functions.length +
          event.model.rules.length + event.model.activities.length
        addModelActivity(`候选模型已生成，共 ${elementCount} 个模型元素。`)
        setProject((current) => ({
          ...current,
          candidate: {
            model: event.model,
            revision: modelRevision,
            documentRevision: current.revisions.document,
            expressionReview: event.expressionReview,
          },
          plan: current.plan
            ? { ...current.plan, compiled: true, ...(current.plan.compilation ? { compilation: { ...current.plan.compilation, status: 'completed' as const } } : {}) }
            : current.plan,
          revisions: {
            ...current.revisions,
            candidateBasis: basis,
            model: modelRevision,
          },
        }))
      }
      if (event.type === 'error') {
        addModelActivity(`任务中断：${event.error || '分析失败'}`)
        throw new Error(event.error || '分析失败')
      }
      if (event.type === 'result') {
        received.result = event.result
        addModelActivity('本次执行已结束，产物已保存。')
      }
    })
    const result = received.result
    if (!result) {
      addModelActivity('任务中断：本阶段未返回完整结果')
      throw new Error('本阶段未返回完整结果')
    }
    if (!isStageResult(stage, result))
      throw new Error('服务返回的结果与当前阶段不匹配')
    if (tracksModeling) setModelRunStatus('completed')
    setProject((current) => ({
      ...current,
      messages: current.messages.map((message) =>
        message.id === id
          ? { ...message, progress: false, content: STAGES[stage] + '已完成。' }
          : message,
      ),
    }))
    return result
  }
  const resume = (step: 'verify' | 'map') => execute(async () => {
    const saved = prepareModelResume(project, step)
    const result = await runStage(step, { narrative: resumeNarrative(project), result: saved })
    setProject(current => receiveClarifications({
      ...current,
      plan: current.plan ? { ...current.plan, semantic: result.semantic, warnings: result.validation.warnings, compiled: true } : null,
      candidate: current.candidate ? { ...current.candidate, model: result.model, edited: false, expressionReview: result.expressionReview } : null,
    }, result.clarifications, 'model'))
  })
  const stop = () => {
    cancelled.current = true
    if (job?.stage === 'model' || job?.stage === 'compile' || job?.stage === 'verify' || job?.stage === 'map')
      setModelActivity((current) =>
        current.at(-1) === '任务已停止。'
          ? current
          : [...current, '任务已停止。'].slice(-100),
      )
    abortRef.current?.abort()
  }
  const readBusiness = () =>
    execute(async () => {
      const result = await runStage('understand', {
        document: project.document,
      })
      setProject((current) => ({
        ...current,
        understanding: reviseUnderstanding(result.understanding),
        answers: {},
        questionsSaved: false,
        revisions: advanceRevision(current.revisions, 'understanding'),
      }))
      setReadingStream(current => ({ ...current, narrative: '', complete: true }))
      addMessage({
        role: 'assistant',
        content:
          '文档整理已完成。请结合原文审阅整理稿和文档问题；点击“开始建模”后，将提炼业务依据并设计模型。',
      })
    })
  const build = (retry = false) =>
    execute(async () => {
      if (retry && !project.plan) throw new Error('请先完成建模说明')
      if (!retry && !project.understanding) throw new Error('请先理解业务')
      if (unsavedAnswers)
        throw new Error('请先保存问题答案，将补充说明并入业务理解。')
      const basis = project.revisions.business
      const result =
        retry && project.plan
          ? await runStage('compile', {
              semanticPlan: project.plan.plan,
              narrative: resumeNarrative(project),
              semantic: project.plan.semantic,
              businessBasis: project.plan.businessBasis,
              designReview: project.plan.designReview,
            })
          : await runStage('model', {
              narrative: project.understanding?.narrative || '',
              understandingReview: project.understanding?.review,
              instruction:
                project.feedbackDocumentRevision === project.revisions.document
                  ? project.feedback
                  : '',
              model:
                project.candidate?.documentRevision ===
                project.revisions.document
                  ? model
                  : null,
            })
      if (!result.model) throw new Error('未返回候选模型')
      setProject((current) => {
        const revisions = {
          ...current.revisions,
          planBasis: basis,
          candidateBasis: basis,
          model: current.revisions.model,
        }
        return receiveClarifications(
          {
            ...current,
            plan: {
              plan: result.semanticPlan,
              designReview: result.designReview,
              compilation: current.plan?.compilation,
              designDraft: result.designReview?.reason === 'interrupted' ? current.plan?.designDraft : undefined,
              designReasoning: current.plan?.designReasoning,
              designCheckReasoning: current.plan?.designCheckReasoning,
              semanticReasoning: current.plan?.semanticReasoning,
              semanticReasoningPart: current.plan?.semanticReasoningPart,
              basis: current.plan?.basis,
              businessBasis: result.businessBasis ?? current.plan?.businessBasis,
              businessBasisReasoning: current.plan?.businessBasisReasoning,
              businessBasisComplete: result.businessBasis !== undefined || current.plan?.businessBasisComplete,
              complete: true,
              compiled: true,
              warnings: [...new Set(result.validation.warnings)],
              ...(result.semantic
                ? { semantic: result.semantic }
                : current.plan?.semantic
                  ? { semantic: current.plan.semantic }
                  : {}),
            },
            candidate: {
              model: result.model,
              revision: revisions.model,
              documentRevision: current.revisions.document,
              expressionReview: result.expressionReview,
            },
            revisions,
          },
          result.clarifications,
          'model',
        )
      })
      setSelectedId(null)
      addMessage({
        role: 'assistant',
        content:
          (result.expressionReview.status === 'not-run'
            ? '候选模型已生成，结构和引用检查通过。'
            : result.expressionReview.status === 'passed'
            ? '候选模型已生成，本轮候选模型复核用例均可表达。'
            : '候选模型已保留，请查看候选模型复核中的剩余事项。') +
          (result.designReview?.status === 'attention' ? '设计仍有待审阅意见，请查看“模型设计”。' : '') +
          '可点击“检验模型”查看自述和业务过程支撑。',
      })
    })
  const checkModel = (only?: 'assess' | 'narrate') =>
    execute(async () => {
      if (!model) throw new Error('请先生成候选模型')
      if (unsavedAnswers)
        throw new Error('请先保存问题答案，并根据更新后的业务理解重新建模。')
      const basis = project.revisions.model
      if (only !== 'assess') {
        const result = await runStage('narrate', { model })
        setProject((current) => ({
          ...current,
          narration: result.narrative,
          revisions: { ...current.revisions, narrationBasis: basis },
        }))
        setNarratingText('')
      }
      if (only !== 'narrate') {
        const result = await runStage('assess', { model })
        setProject((current) =>
          receiveClarifications(
            {
              ...current,
              assessment: result.assessment,
              revisions: { ...current.revisions, assessmentBasis: basis },
            },
            result.assessment.clarifications,
            'assess',
          ),
        )
      }
      addMessage({
        role: 'assistant',
        content:
          '本次模型检验已完成。请根据自述和支撑结果提出反馈，下一轮可以从建模开始。',
      })
    })
  const upload = async (file?: File) => {
    if (!file || busyRef.current) return
    if (!/\.(docx|md|markdown|txt|html?)$/i.test(file.name)) {
      setToast('请上传 DOCX、Markdown、TXT 或 HTML')
      return
    }
    await execute(async () => {
      const content = /\.docx$/i.test(file.name)
        ? (
            await (
              await import('mammoth')
            ).default.convertToHtml({ arrayBuffer: await file.arrayBuffer() })
          ).value
        : await file.text()
      setProject((current) => ({
        ...current,
        document: {
          name: file.name,
          size: (file.size / 1024).toFixed(1) + ' KB',
          content,
          blocks: documentToBlocks(content),
          updated: new Date().toISOString(),
        },
        revisions: advanceRevision(current.revisions, 'document'),
      }))
      setReadingStream({ narrative: '', reasoning: '', complete: true })
      setEditing(false)
      setView('document')
      addMessage({
        role: 'assistant',
        content:
          '已载入“' + file.name + '”。点击“理解业务”开始阅读，已有结果已保留。',
      })
    })
  }
  const updateFeedback = (value: string) =>
    setProject((current) => ({
      ...current,
      feedback: value,
      feedbackDocumentRevision: current.revisions.document,
      revisions: advanceRevision(current.revisions, 'business'),
    }))
  const discussElement = (element: DiscussionSubject) => {
    setDiscussionContext(element)
    setAssistantOpen(true)
    setDraft('请解释“' + element.name + '”的业务含义与建模边界。')
  }
  const appendAssessmentFeedback = (text: string) => {
    setProject((current) => {
      if (current.feedback.includes(text)) return current
      return {
        ...current,
        feedback: [current.feedback.trim(), text].filter(Boolean).join('\n\n'),
        feedbackDocumentRevision: current.revisions.document,
        revisions: advanceRevision(current.revisions, 'business'),
      }
    })
    setToast('已加入下一轮建模反馈；审阅后再开始建模。')
  }
  const editElement: OnEdit = (kind, id, changes) =>
    setProject((current) => {
      if (!current.candidate) return current
      const revisions = advanceRevision(current.revisions, 'model')
      return {
        ...current,
        candidate: {
          ...current.candidate,
          edited: true,
          revision: revisions.model,
          model: {
            ...current.candidate.model,
            [kind]: current.candidate.model[kind].map((item) =>
              item.id === id ? { ...item, ...changes } : item,
            ),
          },
        },
        revisions,
      }
    })
  const addObject = (name: string, description: string) => {
    const id = 'object-' + Date.now()
    setProject((current) => {
      if (!current.candidate) return current
      const revisions = advanceRevision(current.revisions, 'model')
      return {
        ...current,
        candidate: {
          ...current.candidate,
          edited: true,
          revision: revisions.model,
          model: {
            ...current.candidate.model,
            objects: [
              ...current.candidate.model.objects,
              { id, name, description, properties: [], evidence: [] },
            ],
          },
        },
        revisions,
      }
    })
    setSelectedId(id)
  }
  const send = async () => {
    if (!draft.trim() || discussing) return
    if (!modelOptions) {
      setError('模型选项尚未加载，请稍后重试。')
      return
    }
    const user: WorkspaceMessage = {
      role: 'user',
      content: draft.trim(),
      context: discussionContext,
    }
    setDraft('')
    addMessage(user)
    setDiscussing(true)
    setDiscussionStream({ text: '', reasoning: '' })
    try {
      const history = [
        ...project.messages.filter((message) => !message.stage),
        user,
      ].map((message) => ({
        role: message.role,
        content:
          message.content +
          (message.context
            ? '\n讨论对象：' + JSON.stringify(message.context)
            : ''),
      }))
      const response = await fetch('/api/discuss/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          document: project.document,
          provider,
          reasoningEffort,
          model: {
            candidate: model,
            understanding: project.understanding?.narrative,
            review: currentLabel,
          },
          messages: history,
        } satisfies DiscussionRequest),
      })
      if (!response.ok)
        throw new Error('讨论服务返回 HTTP ' + response.status)
      let result = ''
      let streamedText = ''
      await readSse<DiscussionEvent>(response, event => {
        if (event.type === 'error') throw new Error(event.error)
        if (event.type === 'result') result = event.text
        if (event.type === 'delta') {
          if (!event.reasoning) streamedText += event.text
          setDiscussionStream(current => ({
            ...current,
            [event.reasoning ? 'reasoning' : 'text']: current[event.reasoning ? 'reasoning' : 'text'] + event.text,
          }))
        }
      }, parseDiscussionEvent)
      addMessage({ role: 'assistant', content: result || streamedText })
    } catch (failure) {
      addMessage({
        role: 'assistant',
        content:
          '讨论失败：' +
          (failure instanceof Error ? failure.message : String(failure)),
      })
    } finally {
      setDiscussing(false)
    }
  }
  const modelRunning = job?.stage === 'model' || job?.stage === 'compile' || job?.stage === 'verify' || job?.stage === 'map'
  const runPart = modelRunning
    ? job.part || (job.stage === 'compile' ? 'compile' : job.stage === 'verify' ? 'expression' : job.stage === 'map' ? 'mapping' : 'semantic')
    : undefined
  const visibleStages: AnalysisStage[] =
    view === 'understanding'
      ? ['understand']
      : view === 'review'
        ? ['narrate', 'assess']
        : []
  const modelTimingRecords = latestModelTimings(project.timings || {}).map((record) => ({
    ...record,
    label: record.part ? STAGE_PART_LABELS[record.part] : '建模',
  }))
  const progress = modelingProgress({
    plan: project.plan,
    candidate: project.candidate,
    runningPart: runPart,
    planStale: !modelRunning && stale.plan,
    candidateStale: stale.candidate,
  })
  const viewModelStep = (step: ProgressItem) => {
    setView('model')
    setModelMode(step.tab)
    if (step.tab === 'evidence') setEvidenceMode(step.id === 'stories' ? 'stories' : 'facts')
    if (step.id === 'expression') setExpressionFocus((count) => count + 1)
  }
  type TodoItem = {
    key: string
    text: string
    action?: { label: string; run: () => void; disabled?: boolean }
  }
  const todos: TodoItem[] = []
  if (unsavedAnswers && !stale.understanding)
    todos.push({
      key: 'answers',
      text: '问题答案有尚未保存的修改；当前正文和讨论仍使用已保存的业务理解。',
      action: {
        label: '保存并更新整理稿',
        disabled: busy,
        run: () => {
          setProject(saveUnderstandingAnswers)
          setToast('补充说明已并入业务理解，请根据更新后的说明建模。')
        },
      },
    })
  if (
    (view === 'model' || view === 'review') &&
    pendingQuestions > 0 &&
    !stale.understanding
  )
    todos.push({
      key: 'questions',
      text: `${pendingQuestions} 项业务信息待确认，候选模型保留当前不确定边界。`,
      action: { label: '到业务理解确认', run: openQuestions },
    })
  if (view === 'understanding' && project.understanding && stale.understanding)
    todos.push({
      key: 'stale-understanding',
      text: '文档已更换，以下说明来自先前文档。',
      action: { label: '重新理解业务', disabled: busy, run: readBusiness },
    })
  if (view === 'model' && model && stale.candidate)
    todos.push({
      key: 'stale-model',
      text: '业务理解或反馈已变化，当前是旧模型，需要重新建模。',
      action: { label: '重新建模', disabled: busy || !canModel, run: () => build() },
    })
  if (view === 'model' && project.plan?.complete && !project.plan.compiled)
    todos.push({
      key: 'retry-compile',
      text: stale.plan
        ? '建模依据已变化，这份说明不能直接重试整理，请重新建模。'
        : modelRunning
          ? project.plan?.designReview && ['drafting', 'checking'].includes(project.plan.designReview.status)
            ? `完整设计已保留，${designReviewLabel(project.plan.designReview)}。`
            : '设计草案已生成，正在整理候选模型。'
          : '建模说明已保留，候选模型尚未更新。',
      ...(canRetry && !busy
        ? { action: { label: '重新整理模型', run: () => build(true) } }
        : {}),
    })
  if (view === 'model' && canCheck && project.plan?.compiled) {
    if (project.candidate?.expressionReview?.status !== 'not-run' && (project.candidate?.edited || project.candidate?.expressionReview?.status !== 'passed')) todos.push({ key: 'resume-check', text: '使用当前候选检查具体业务情形，保留已有模型及修正记录。',
      action: { label: '检查并修正当前候选', disabled: busy, run: () => resume('verify') } })
    if (project.plan.semantic && !project.candidate?.edited && project.plan.semantic.status !== 'mapped')
      todos.push({ key: 'resume-map', text: '事实与候选已经保留，可以单独继续映射。',
        action: { label: '仅重试事实映射', disabled: busy, run: () => resume('map') } })
    const cases = project.candidate?.expressionReview?.snapshots[project.candidate.expressionReview.selectedSnapshot]?.check?.cases || []
    if (cases.some(item => item.status !== 'expressed' && item.repairTarget === 'understanding'))
      todos.push({ key: 'return-understanding', text: '检查发现业务依据需要核对；修改模型不能代替澄清业务。',
        action: { label: '核对业务理解', run: () => setView('understanding') } })
  }
  if (view === 'model')
    for (const [index, warning] of (project.plan?.warnings || []).entries())
      todos.push({ key: `warning-${index}`, text: warning })
  if (
    view === 'review' &&
    (reviewMode === 'narration'
      ? project.narration && stale.narration
      : project.assessment && stale.assessment)
  )
    todos.push({
      key: 'stale-review',
      text: '以下检验来自旧版本，业务依据或候选模型已变化。',
      action: stale.candidate
        ? { label: '先重新建模', disabled: busy || !canModel, run: () => build() }
        : { label: '重新检验模型', disabled: busy || !canCheck, run: () => checkModel() },
    })
  const primary =
    view === 'document'
      ? {
          label: project.understanding ? '重新理解业务' : '理解业务',
          action: readBusiness,
          disabled: !project.document.content,
        }
      : view === 'understanding'
        ? {
            label: project.candidate ? '基于此说明重新建模' : '开始建模',
            action: () => build(),
            disabled: !canModel,
          }
        : view === 'model'
          ? {
              label: canRetry
                ? '重新整理模型'
                : canCheck
                  ? '检验模型'
                  : '重新建模',
              action: () =>
                canRetry ? build(true) : canCheck ? checkModel() : build(),
              disabled: canRetry ? false : canCheck ? false : !canModel,
            }
          : {
              label: '重新检验模型',
              action: () => checkModel(),
              disabled: !canCheck,
            }

  return (
    <div className={'app-shell ' + (assistantOpen ? 'assistant-open' : '')}>
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Network size={21} />
          </div>
          <strong>领域建模工作台</strong>
        </div>
        <div className="topbar-actions">
          <div className="runtime-choice">
            <span className="choice-label">运行时</span>
            <div className="provider-switch" aria-label="Agent 运行时">
              {(['pi', 'direct'] as AgentRuntimeId[]).map((value) => (
                <button
                  key={value}
                  disabled={value === 'direct' || busy || discussing}
                  aria-pressed={runtime === value}
                  className={runtime === value ? 'active' : ''}
                  title={
                    value === 'pi'
                      ? 'Pi Agent 用于业务理解、语义建模和模型 JSON 质量检查。'
                      : '直接调用已停用，请使用 Pi Agent。'
                  }
                >
                  {RUNTIMES[value].name}
                </button>
              ))}
            </div>
          </div>
          <div className="runtime-choice">
            <span className="choice-label">模型</span>
            <div className="provider-switch" aria-label="推理提供方">
              {(['deepseek', 'gpt', 'qwen', 'glm'] as const).map((value) => (
                <button
                  key={value}
                  disabled={busy || discussing || !modelOptions}
                  aria-pressed={provider === value}
                  className={provider === value ? 'active' : ''}
                  title={modelOptions?.[value].model}
                  onClick={() => {
                    setProvider(value)
                    setReasoningEffort(modelOptions![value].defaultEffort)
                  }}
                >
                  {PROVIDERS[value].name}
                </button>
              ))}
            </div>
          </div>
          <label className="runtime-choice reasoning-choice">
            <span className="choice-label">推理强度</span>
            <select
              className="reasoning-select"
              aria-label="模型推理强度"
              value={reasoningEffort}
              disabled={busy || discussing || !modelOptions || modelOptions[provider].efforts.length < 2}
              title={modelOptions ? `${modelOptions[provider].model}：${modelOptions[provider].description}` : '正在加载模型可用档位'}
              onChange={(event) => setReasoningEffort(event.target.value as ReasoningEffort)}
            >
              {!modelOptions && <option value="default">{modelOptionsError ? '加载失败' : '加载中…'}</option>}
              {modelOptions?.[provider].efforts.map((effort) => (
                <option key={effort} value={effort}>{REASONING_LABELS[effort]}</option>
              ))}
            </select>
          </label>
          {modelOptionsError && <button className="text-button" onClick={() => setModelOptionsAttempt(value => value + 1)}>重试加载</button>}
          <button
            className="icon-button"
            aria-label="保存草稿"
            onClick={() => saveProject(true)}
          >
            <Save size={18} />
          </button>
          <button
            className="assistant-toggle secondary-button"
            aria-expanded={assistantOpen}
            onClick={() => setAssistantOpen(!assistantOpen)}
          >
            {assistantOpen ? (
              <PanelRightClose size={17} />
            ) : (
              <PanelRightOpen size={17} />
            )}
            建模助手
          </button>
        </div>
      </header>
      <div className="app-body">
        <main className="main-content">
          <nav className="workspace-nav" aria-label="工作区">
            {PAGES.map(([id, label, Icon], index) => {
              const old =
                id === 'understanding'
                  ? project.understanding && stale.understanding
                  : id === 'model'
                    ? model && stale.candidate
                    : id === 'review'
                      ? (project.narration && stale.narration) ||
                        (project.assessment && stale.assessment)
                      : false
              return (
                <button
                  key={id}
                  aria-current={view === id ? 'page' : undefined}
                  className={view === id ? 'active' : ''}
                  onClick={() => setView(id)}
                >
                  <span className="nav-step">0{index + 1}</span>
                  <Icon size={16} />
                  <span>{label}</span>
                  {old && <span className="nav-stale" title="需要更新" />}
                </button>
              )
            })}
          </nav>
          <div className="workspace-heading">
            <div>
              <h1>{currentLabel}</h1>
              <p>
                {project.document.name}
                {project.candidate
                  ? ' · 模型 v' + project.candidate.revision
                  : ''}
              </p>
            </div>
            <div className="button-row">
              {view === 'understanding' && project.understanding && (
                <button
                  className="secondary-button"
                  disabled={busy || unsavedAnswers || stale.understanding}
                  onClick={() => {
                    setEditedNarrative(project.understanding?.narrative || '')
                    setEditing(!editing)
                  }}
                >
                  {editing ? '取消修改' : '修正整理稿'}
                </button>
              )}
              {view === 'model' && (project.plan || model) && (
                <button className="secondary-button" disabled={busy || !canModel} onClick={() => build()}>
                  <RefreshCw size={14} />重新建模
                </button>
              )}
              <button
                className="primary-button"
                disabled={busy || primary.disabled}
                onClick={primary.action}
              >
                {primary.label}
                <ArrowRight size={15} />
              </button>
            </div>
          </div>
          {todos.length > 0 && (
            <div className="todo-bar" role="status">
              {todos.map((item) => (
                <span className="todo-item" key={item.key}>
                  {item.text}
                  {item.action && (
                    <button
                      className="text-button"
                      disabled={item.action.disabled}
                      onClick={item.action.run}
                    >
                      {item.action.label}
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
          {(modelRunning || (!job && view === 'model' && (project.plan || model || modelActivity.length > 0))) && (
            <ModelingRun
              progress={progress}
              running={modelRunning}
              text={modelRunning ? job.text : ''}
              elapsed={elapsed}
              status={modelRunStatus}
              activities={modelActivity}
              records={modelTimingRecords}
              onStop={stop}
              onView={viewModelStep}
            />
          )}
          {job && !modelRunning && (
            <div className="run-status" role="status">
              <span className="typing-indicator">
                <i />
                <i />
                <i />
              </span>
              <div>
                <strong>{STAGES[job.stage]}</strong>
                <small>
                  {runtimeLabel} · {providerLabel} · {elapsed} 秒 · {job.stage === 'understand'
                    ? readingStream.narrative ? '正在生成文档整理稿。'
                      : readingStream.reasoning ? '正在梳理文档，思考过程实时显示中。' : job.text
                    : job.text}
                </small>
                {job.timing && (
                  <small>
                    {job.timing.model}
                    {job.timing.reasoningEffort
                      ? ` / ${job.timing.reasoningEffort}`
                      : ''}
                    {' · '}
                    {job.timing.firstTextMs == null
                      ? '等待首段正文'
                      : `首段正文 ${(job.timing.firstTextMs / 1000).toFixed(1)} 秒`}
                  </small>
                )}
              </div>
              <button className="stop-button" onClick={stop}>
                <Square size={13} />
                停止
              </button>
            </div>
          )}
          <TimingDetails
            records={visibleStages.flatMap((stage) =>
              (project.timings?.[stage] || []).map((record) => ({
                ...record,
                label: record.part
                  ? STAGE_PART_LABELS[record.part]
                  : STAGES[stage],
              })),
            )}
          />
          {error && (
            <div className="error-notice" role="alert">
              <strong>任务未完成</strong>
              <p>{error}</p>
              {canRetry && (
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => build(true)}
                >
                  仅重试模型整理
                </button>
              )}
            </div>
          )}
          {view === 'document' && (
            <DocumentView
              document={project.document}
              onUpload={upload}
              disabled={busy}
            />
          )}
          {view === 'understanding' && (
            <>
              {editing ? (
                <form
                  className="narrative-editor panel-surface"
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (!editedNarrative.trim()) return
                    setProject((current) => ({
                      ...current,
                      understanding: reviseUnderstanding({
                        narrative: editedNarrative,
                        questions: extractQuestions(editedNarrative),
                        warnings: [],
                        sources: reviseUnderstandingSources(
                          current.understanding?.sources,
                          current.understanding?.narrative || '',
                          editedNarrative,
                        ),
                      }),
                      answers: {},
                      questionsSaved: false,
                      revisions: advanceRevision(current.revisions, 'business'),
                    }))
                    setReadingStream({ narrative: '', reasoning: '', complete: true })
                    setEditing(false)
                  }}
                >
                  <label htmlFor="business-narrative">修正文档整理稿</label>
                  <textarea
                    id="business-narrative"
                    rows={24}
                    value={editedNarrative}
                    onChange={(event) => setEditedNarrative(event.target.value)}
                  />
                  <p>
                    保存后，业务依据、模型和检验结果会标记需要更新。请保留必要的条件、公式和未决说法；待确认问题将按编辑后的内容重新解析。
                  </p>
                  <button
                    className="primary-button"
                    disabled={busy || !editedNarrative.trim()}
                  >
                    保存整理稿
                  </button>
                </form>
              ) : (
                <BusinessUnderstanding
                  understanding={project.understanding}
                  stream={readingStream}
                  isLive={job?.stage === 'understand'}
                  questionAnswers={project.answers}
                  onQuestionAnswerChange={(index, value) =>
                    setProject((current) => ({
                      ...current,
                      answers: { ...current.answers, [index]: value },
                      questionsSaved: false,
                    }))
                  }
                  onSubmitAnswers={() => {
                    setProject(saveUnderstandingAnswers)
                    setToast(
                      '补充说明已并入业务理解，请重新建模以更新后续检验的依据。',
                    )
                  }}
                  questionsSubmitted={project.questionsSaved}
                  isSubmitting={busy || stale.understanding}
                />
              )}
            </>
          )}
          {view === 'model' && (
            <>
              <CandidateView
                candidate={project.candidate}
                plan={project.plan}
                mode={modelMode}
                onMode={setModelMode}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onDiscuss={discussElement}
                onEdit={editElement}
                onAdd={addObject}
                onRebuild={() => build()}
                canRebuild={canModel}
                disabled={busy}
                running={modelRunning}
                progress={progress}
                evidenceMode={evidenceMode}
                onEvidenceMode={setEvidenceMode}
                expressionFocus={expressionFocus}
                expressionStream={expressionStream}
              />
            </>
          )}
          {view === 'review' && (
            <>
              <div className="review-actions">
                <button
                  className="text-button"
                  disabled={busy || !canCheck}
                  onClick={() => checkModel('narrate')}
                >
                  仅生成自述
                </button>
                <button
                  className="text-button"
                  disabled={busy || !canCheck}
                  onClick={() => checkModel('assess')}
                >
                  仅评估业务过程支撑
                </button>
              </div>
              <ReviewView
                mode={reviewMode}
                onMode={setReviewMode}
                narration={narratingText || project.narration}
                narrationReasoning={narrationReasoning}
                assessment={project.assessment}
                assessmentStream={assessmentStream}
                running={job?.stage}
                model={model}
                onAddFeedback={appendAssessmentFeedback}
                feedback={project.feedback}
                feedbackDisabled={
                  busy ||
                  stale.understanding ||
                  project.revisions.assessmentBasis !==
                    project.revisions.model ||
                  Boolean(
                    project.feedback &&
                    project.feedbackDocumentRevision !==
                      project.revisions.document,
                  )
                }
                onDiscuss={discussElement}
                onCompare={() => setComparison(!comparison)}
                comparison={comparison ? project.understanding?.narrative : ''}
              />
            </>
          )}
          {view === 'review' && project.understanding && (
            <section className="feedback-panel panel-surface">
              <label htmlFor="model-feedback">下一轮建模反馈</label>
              <p>
                填写对模型设计的调整建议。业务事实或文档含义的修改请先保存到整理稿；重新建模时会重新提炼业务依据，再结合这里的反馈设计模型。
              </p>
              {project.feedback &&
                project.feedbackDocumentRevision !==
                  project.revisions.document && (
                  <Notice>
                    这份反馈来自先前文档，当前建模不会采用。
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => updateFeedback(project.feedback)}
                    >
                      用于当前文档
                    </button>
                  </Notice>
                )}
              <textarea
                id="model-feedback"
                rows={3}
                placeholder="例如：说明需要合并、拆分或补充的概念及理由…"
                value={project.feedback}
                disabled={busy}
                onChange={(event) => updateFeedback(event.target.value)}
              />
              <button
                className="primary-button"
                disabled={busy || !canModel}
                onClick={() => build()}
              >
                按反馈重新建模
                <ArrowRight size={14} />
              </button>
            </section>
          )}
        </main>
        {assistantOpen && (
          <aside className="assistant-rail" aria-label="建模助手">
            <div className="assistant-header">
              <div>
                <Bot size={19} />
                <strong>建模助手</strong>
              </div>
              <button
                className="icon-button"
                aria-label="收起建模助手"
                onClick={() => setAssistantOpen(false)}
              >
                <PanelRightClose size={18} />
              </button>
            </div>
            <div className="assistant-context">
              正在审阅：{discussionContext?.name || currentLabel}
              {discussionContext && (
                <button
                  className="text-button"
                  onClick={() => setDiscussionContext(null)}
                >
                  清除
                </button>
              )}
            </div>
            <div
              className="message-list"
              ref={messagesRef}
              onScroll={(event) => {
                const node = event.currentTarget
                followMessages.current =
                  node.scrollHeight - node.scrollTop - node.clientHeight < 60
              }}
            >
              {project.messages.map((message, index) => (
                <div
                  className={'chat-message ' + message.role}
                  key={message.id || index}
                >
                  <span className="message-role">
                    {message.role === 'user' ? '你' : '建模助手'}
                  </span>
                  <Markdown>{message.content}</Markdown>
                  {message.progress && busy && (
                    <span className="typing-indicator">
                      <i />
                      <i />
                      <i />
                    </span>
                  )}
                  {message.role === 'user' && (
                    <button
                      className="text-button"
                      disabled={busy || !project.understanding}
                      onClick={() => {
                        updateFeedback(
                          [
                            project.feedbackDocumentRevision ===
                            project.revisions.document
                              ? project.feedback
                              : '',
                            message.content,
                          ]
                            .filter(Boolean)
                            .join('\n'),
                        )
                        setView('model')
                        setToast('已加入下一轮建模反馈')
                      }}
                    >
                      加入建模反馈
                    </button>
                  )}
                </div>
              ))}
              {discussing && (discussionStream.text || discussionStream.reasoning) ? (
                <div className="chat-message">
                  <span className="message-role">建模助手</span>
                  {discussionStream.reasoning && <ReasoningStream
                    text={discussionStream.reasoning}
                    active={!discussionStream.text}
                    complete={!!discussionStream.text}
                  />}
                  {discussionStream.text && <Markdown>{discussionStream.text}</Markdown>}
                </div>
              ) : discussing && (
                <div className="chat-message">
                  <span className="typing-indicator">
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
              )}
            </div>
            <form
              className="composer"
              onSubmit={(event) => {
                event.preventDefault()
                send()
              }}
            >
              <textarea
                aria-label="与建模助手讨论"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="讨论业务含义或模型边界…"
                rows={3}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault()
                    send()
                  }
                }}
              />
              <div>
                <small>Enter 发送 · Shift+Enter 换行</small>
                <button
                  className="primary-button"
                  aria-label="发送消息"
                  disabled={
                    discussing || !draft.trim() || !project.document.content
                  }
                >
                  <Send size={16} />
                </button>
              </div>
            </form>
          </aside>
        )}
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          {toast}
        </div>
      )}
    </div>
  )
}
export default App
const root = document.getElementById('root')
if (!root) throw new Error('缺少应用挂载节点')
createRoot(root).render(<App />)
