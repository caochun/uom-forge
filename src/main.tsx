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
import {
  CandidateView,
  DocumentView,
  Markdown,
  Notice,
  RawOutput,
  ReviewView,
  TimingDetails,
} from './components/WorkbenchViews.tsx'
import './styles.css'
import type {
  AnalysisRequest,
  AnalysisResult,
  AnalysisResults,
  DiscussionRequest,
  ProviderId,
} from '../shared/analysis.ts'
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
import { discussionText, isStageResult } from './responses.ts'
import { isRecord } from './values.ts'
import { createId } from './id.ts'

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
  ['model', '候选模型', Network],
  ['review', '模型检验', ClipboardCheck],
] as const
const STAGES = {
  understand: '理解业务',
  model: '建立候选模型',
  compile: '整理候选模型',
  narrate: '生成模型自述',
  assess: '评估过程支撑',
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
        '上传业务文档后先理解业务。你可以审阅说明、补充问题答案，再开始建模。模型生成后，再通过自述和过程支撑检查其表达是否准确。',
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
  const [modelMode, setModelMode] = useState<ModelViewMode>('model')
  const [reviewMode, setReviewMode] = useState<ReviewViewMode>('narration')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [assistantOpen, setAssistantOpen] = useState(
    () => window.innerWidth > 1050,
  )
  const [discussionContext, setDiscussionContext] =
    useState<DiscussionSubject | null>(null)
  const [draft, setDraft] = useState('')
  const [discussing, setDiscussing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editedNarrative, setEditedNarrative] = useState('')
  const [comparison, setComparison] = useState(false)
  const [readingText, setReadingText] = useState('')
  const [narratingText, setNarratingText] = useState('')
  const [job, setJob] = useState<StageJob | null>(null)
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [provider, setProvider] = useState<ProviderId>(() =>
    localStorage.getItem('uom-forge-provider') === 'codex'
      ? 'codex'
      : 'deepseek',
  )
  const busyRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const cancelled = useRef(false)
  const projectRef = useRef(project)
  const messagesRef = useRef<HTMLDivElement | null>(null)
  const followMessages = useRef(true)
  projectRef.current = project
  const stale = freshness(project.revisions)
  const model = project.candidate?.model
  const providerLabel = provider === 'codex' ? 'Codex ACP' : 'DeepSeek API'
  const currentLabel = PAGES.find(([id]) => id === view)?.[1]
  const canModel =
    Boolean(project.understanding?.narrative) &&
    !stale.understanding &&
    !editing
  const canRetry =
    Boolean(project.plan?.complete && !project.plan?.compiled) && !stale.plan
  const canCheck = Boolean(model) && !stale.candidate
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
      if (!stopped) setError(message)
      addMessage({ role: 'assistant', content: message })
    } finally {
      setProject((current) => ({
        ...current,
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
    setJob({
      stage,
      started,
      part: stage === 'compile' ? 'compile' : '',
      text: STAGES[stage],
    })
    setView(
      stage === 'understand'
        ? 'understanding'
        : stage === 'model' || stage === 'compile'
          ? 'model'
          : 'review',
    )
    if (stage === 'narrate') {
      setReviewMode('narration')
      setNarratingText('')
    }
    if (stage === 'assess') setReviewMode('assessment')
    if (stage === 'understand') setReadingText('')
    if (stage === 'model') {
      setModelMode('plan')
      setProject((current) => ({
        ...current,
        plan: { plan: '', complete: false, compiled: false },
        outputs: { ...current.outputs, compile: '' },
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
      body: JSON.stringify({ ...body, stage, provider }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error('分析服务返回 HTTP ' + response.status)
    const received: { result?: AnalysisResult } = {}
    let output = ''
    let part = ''
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
      if (event.type === 'phase')
        setJob((current) =>
          current
            ? {
                ...current,
                part: event.part || current.part,
                text: event.text,
              }
            : current,
        )
      if (event.type === 'delta') {
        if (
          event.part &&
          event.part !== part &&
          (stage === 'model' || stage === 'compile')
        ) {
          part = event.part
          output +=
            '\n\n—— ' +
            (part === 'semantic' ? '建模说明' : '模型整理') +
            ' ——\n\n'
        }
        output += event.text || ''
        setProject((current) => ({
          ...current,
          outputs: { ...current.outputs, [stage]: output },
        }))
        if (!event.reasoning) {
          if (stage === 'understand')
            setReadingText((current) => current + (event.text || ''))
          if (stage === 'narrate')
            setNarratingText((current) => current + (event.text || ''))
          if (stage === 'model' && event.part === 'semantic')
            setProject((current) => ({
              ...current,
              plan: {
                complete: false,
                compiled: false,
                ...current.plan,
                plan: (current.plan?.plan || '') + (event.text || ''),
              },
            }))
        }
      }
      if (event.type === 'model-plan')
        setProject((current) => ({
          ...current,
          plan: { plan: event.semanticPlan, complete: true, compiled: false },
          revisions: { ...current.revisions, planBasis: basis },
        }))
      if (event.type === 'error') throw new Error(event.error || '分析失败')
      if (event.type === 'result') received.result = event.result
    })
    const result = received.result
    if (!result) throw new Error('本阶段未返回完整结果')
    if (!isStageResult(stage, result))
      throw new Error('服务返回的结果与当前阶段不匹配')
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
  const stop = () => {
    cancelled.current = true
    abortRef.current?.abort()
  }
  const readBusiness = () =>
    execute(async () => {
      const result = await runStage('understand', {
        document: project.document,
      })
      setProject((current) => ({
        ...current,
        understanding: result.understanding,
        answers: {},
        questionsSaved: false,
        revisions: advanceRevision(current.revisions, 'understanding'),
      }))
      setReadingText('')
      addMessage({
        role: 'assistant',
        content:
          '业务理解已完成。请审阅说明并补充待确认问题，再点击“开始建模”。',
      })
    })
  const collectFeedback = () => {
    const answers = (project.understanding?.questions || []).flatMap(
      (question, index) => {
        const answer = project.answers[index]
        const text = Array.isArray(answer) ? answer.join('；') : answer
        return text
          ? [
              (typeof question === 'string' ? question : question.text) +
                '：' +
                text,
            ]
          : []
      },
    )
    return [
      project.feedbackDocumentRevision === project.revisions.document
        ? project.feedback
        : '',
      answers.length ? '用户确认的业务信息：\n' + answers.join('\n') : '',
    ]
      .filter(Boolean)
      .join('\n\n')
  }
  const build = (retry = false) =>
    execute(async () => {
      if (retry && !project.plan) throw new Error('请先完成建模说明')
      if (!retry && !project.understanding) throw new Error('请先理解业务')
      const basis = project.revisions.business
      const result =
        retry && project.plan
          ? await runStage('compile', { semanticPlan: project.plan.plan })
          : await runStage('model', {
              narrative: project.understanding?.narrative || '',
              instruction: collectFeedback(),
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
          model: current.revisions.model + 1,
        }
        return {
          ...current,
          plan: { plan: result.semanticPlan, complete: true, compiled: true },
          candidate: {
            model: result.model,
            revision: revisions.model,
            documentRevision: current.revisions.document,
          },
          revisions,
        }
      })
      setModelMode('model')
      setSelectedId(null)
      addMessage({
        role: 'assistant',
        content:
          '候选模型已生成。可以检查对象关系与业务能力，或点击“检验模型”查看自述和过程支撑。',
      })
    })
  const checkModel = (only?: 'assess' | 'narrate') =>
    execute(async () => {
      if (!model || !project.understanding) throw new Error('请先生成候选模型')
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
        const result = await runStage('assess', {
          document: project.document,
          narrative: project.understanding.narrative,
          model,
        })
        setProject((current) => ({
          ...current,
          assessment: result.assessment,
          revisions: { ...current.revisions, assessmentBasis: basis },
        }))
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
      setReadingText('')
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
  const selectFromReview = (id: string) => {
    setView('model')
    setModelMode('model')
    setSelectedId(id)
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
    const user: WorkspaceMessage = {
      role: 'user',
      content: draft.trim(),
      context: discussionContext,
    }
    setDraft('')
    addMessage(user)
    setDiscussing(true)
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
      const response = await fetch('/api/discuss', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          document: project.document,
          provider,
          model: {
            candidate: model,
            understanding: project.understanding?.narrative,
            review: currentLabel,
          },
          messages: history,
        } satisfies DiscussionRequest),
      })
      const result: unknown = await response.json()
      if (!response.ok)
        throw new Error(
          isRecord(result) && typeof result.error === 'string'
            ? result.error
            : '讨论失败',
        )
      addMessage({ role: 'assistant', content: discussionText(result) })
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
  const modelRunning = job?.stage === 'model' || job?.stage === 'compile'
  const runPart = modelRunning
    ? job.part || (job.stage === 'compile' ? 'compile' : 'semantic')
    : undefined
  const visibleStages: AnalysisStage[] =
    view === 'understanding'
      ? ['understand']
      : view === 'model'
        ? ['model', 'compile']
        : view === 'review'
          ? ['narrate', 'assess']
          : []
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
          <div className="provider-switch" aria-label="推理提供方">
            {(['deepseek', 'codex'] as const).map((value) => (
              <button
                key={value}
                disabled={busy || discussing}
                aria-pressed={provider === value}
                className={provider === value ? 'active' : ''}
                onClick={() => {
                  setProvider(value)
                  localStorage.setItem('uom-forge-provider', value)
                }}
              >
                {value === 'codex' ? 'Codex' : 'DeepSeek'}
              </button>
            ))}
          </div>
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
                  disabled={busy}
                  onClick={() => {
                    setEditedNarrative(project.understanding?.narrative || '')
                    setEditing(!editing)
                  }}
                >
                  {editing ? '取消修改' : '修正业务说明'}
                </button>
              )}
              {view === 'model' && model && (canCheck || canRetry) && (
                <button
                  className="secondary-button"
                  disabled={busy || !canModel}
                  onClick={() => build()}
                >
                  <RefreshCw size={14} />
                  重新建模
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
          {job && (
            <div className="run-status" role="status">
              <span className="typing-indicator">
                <i />
                <i />
                <i />
              </span>
              <div>
                <strong>
                  {STAGES[job.stage]}
                  {modelRunning
                    ? ' · ' +
                      (runPart === 'compile' ? '2/2 整理模型' : '1/2 建模说明')
                    : ''}
                </strong>
                <small>
                  {providerLabel} · {elapsed} 秒 · {job.text}
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
                label:
                  record.part === 'semantic'
                    ? '建模判断'
                    : record.part === 'compile'
                      ? '整理模型'
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
              {project.understanding && stale.understanding && (
                <Notice>
                  文档已更换，以下说明来自先前文档。
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={readBusiness}
                  >
                    重新理解业务
                  </button>
                </Notice>
              )}
              {editing ? (
                <form
                  className="narrative-editor panel-surface"
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (!editedNarrative.trim()) return
                    setProject((current) => ({
                      ...current,
                      understanding: {
                        ...current.understanding,
                        narrative: editedNarrative,
                        questions: extractQuestions(editedNarrative),
                        warnings: [],
                      },
                      answers: {},
                      questionsSaved: false,
                      revisions: advanceRevision(current.revisions, 'business'),
                    }))
                    setReadingText('')
                    setEditing(false)
                  }}
                >
                  <label htmlFor="business-narrative">修正业务说明</label>
                  <textarea
                    id="business-narrative"
                    rows={24}
                    value={editedNarrative}
                    onChange={(event) => setEditedNarrative(event.target.value)}
                  />
                  <p>
                    保存后，已有模型和检验结果会标记需要更新。问题列表将重新解析，旧答案需重新确认。
                  </p>
                  <button
                    className="primary-button"
                    disabled={busy || !editedNarrative.trim()}
                  >
                    保存业务说明
                  </button>
                </form>
              ) : (
                <BusinessUnderstanding
                  understanding={project.understanding}
                  stream={{
                    narrative: readingText,
                    complete: !readingText,
                    part: 'reading',
                  }}
                  isLive={job?.stage === 'understand'}
                  questionAnswers={project.answers}
                  onQuestionAnswerChange={(index, value) =>
                    setProject((current) => ({
                      ...current,
                      answers: { ...current.answers, [index]: value },
                      questionsSaved: false,
                      revisions: advanceRevision(current.revisions, 'business'),
                    }))
                  }
                  onSubmitAnswers={() => {
                    setProject((current) => ({
                      ...current,
                      questionsSaved: true,
                    }))
                    setToast('补充信息已保存，开始建模时一并采用')
                  }}
                  questionsSubmitted={project.questionsSaved}
                  isSubmitting={busy}
                  outputRecord={
                    <RawOutput
                      output={project.outputs.understand}
                      live={job?.stage === 'understand'}
                    />
                  }
                />
              )}
            </>
          )}
          {view === 'model' && (
            <>
              {model && stale.candidate && (
                <Notice>
                  业务理解或反馈已变化，当前图是旧模型，需要重新建模。
                </Notice>
              )}
              {project.plan?.complete && !project.plan.compiled && (
                <Notice>
                  {stale.plan
                    ? '建模依据已变化，这份说明不能直接重试整理，请重新建模。'
                    : modelRunning
                      ? '建模说明已完成，正在整理候选模型。'
                      : '建模说明已保留，候选模型尚未更新。'}
                  {canRetry && !busy && (
                    <button className="text-button" onClick={() => build(true)}>
                      重新整理模型
                    </button>
                  )}
                </Notice>
              )}
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
                disabled={busy}
                runningPart={runPart}
                raw={project.outputs.compile || project.outputs.model}
              />
            </>
          )}
          {view === 'review' && (
            <>
              {(reviewMode === 'narration'
                ? project.narration && stale.narration
                : project.assessment && stale.assessment) && (
                <Notice>
                  以下检验来自旧版本，业务依据或候选模型已变化。
                  {stale.candidate ? '请先重新建模。' : '请重新检验模型。'}
                </Notice>
              )}
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
                  仅评估过程支撑
                </button>
              </div>
              <ReviewView
                mode={reviewMode}
                onMode={setReviewMode}
                narration={narratingText || project.narration}
                assessment={project.assessment}
                running={job?.stage}
                raw={
                  project.outputs[
                    reviewMode === 'narration' ? 'narrate' : 'assess'
                  ]
                }
                model={model}
                onSelect={selectFromReview}
                onDiscuss={discussElement}
                onCompare={() => setComparison(!comparison)}
                comparison={comparison ? project.understanding?.narrative : ''}
              />
            </>
          )}
          {(view === 'model' || view === 'review') && project.understanding && (
            <section className="feedback-panel panel-surface">
              <label htmlFor="model-feedback">下一轮建模反馈</label>
              <p>
                明确要调整的业务含义和边界。讨论内容不会自动改动模型；这里的反馈和问题答案会一起用于重新建模。
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
              {discussing && (
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
