import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Circle,
  FileText,
  LoaderCircle,
  MessageCircle,
  Plus,
  Search,
  Upload,
  X,
} from 'lucide-react'
import Markdown from './Markdown.tsx'
export { default as Markdown } from './Markdown.tsx'
import BusinessProcessSupport from './BusinessProcessSupport.tsx'
import { modelingContent } from '../../shared/clarifications.ts'
import QQDocEditor from 'qq-doc-clone'
import ModelGraph from './ModelGraph.tsx'
import { documentToHtml } from '../document.ts'
import { relatedElements } from '../workspace.ts'
import type { ReactNode } from 'react'
import type { Assessment, StagePart } from '../../shared/analysis.ts'
import type { CandidateModel } from '../../shared/model.ts'
import type {
  BusinessFact,
  BusinessStory,
  ElementMapping,
  SemanticPlanV2,
} from '../../shared/semantic.ts'
import { EDITABLE_COLLECTIONS } from '../types.ts'
import type {
  AnalysisStage,
  CandidateDraft,
  EditableCollection,
  EditableElement,
  ModelViewMode,
  OnDiscuss,
  OnEdit,
  ReviewViewMode,
  SemanticPlan,
  StageTiming,
  WorkspaceDocument,
} from '../types.ts'

export function Switcher<T extends string>({
  label,
  items,
  value,
  onChange,
}: {
  label: string
  items: readonly (readonly [T, string])[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="switcher" role="group" aria-label={label}>
      {items.map(([id, name]) => (
        <button
          type="button"
          key={id}
          aria-pressed={value === id}
          className={value === id ? 'active' : ''}
          onClick={() => onChange(id)}
        >
          {name}
        </button>
      ))}
    </div>
  )
}
export function TimingDetails({
  records,
}: {
  records: (StageTiming & { label: string })[]
}) {
  if (!records.length) return null
  const seconds = (value?: number) =>
    value == null ? '—' : `${(value / 1000).toFixed(2)} 秒`
  const statuses = {
    running: '进行中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已停止',
  }
  return (
    <details className="call-timings panel-surface">
      <summary>
        调用耗时 <small>连接、首段正文与完成时间</small>
      </summary>
      {records.map((record) => (
        <article key={record.callId}>
          <strong>
            {record.label} · {record.model}
            {record.reasoningEffort
              ? ` / ${record.reasoningEffort}`
              : ''} · {statuses[record.status]}
          </strong>
          <dl>
            <div>
              <dt>{record.provider === 'codex' ? 'ACP 连接' : 'HTTP 响应'}</dt>
              <dd>{seconds(record.connectedMs)}</dd>
            </div>
            {record.provider === 'codex' && (
              <div>
                <dt>会话建立</dt>
                <dd>{seconds(record.sessionReadyMs)}</dd>
              </div>
            )}
            <div>
              <dt>首段正文</dt>
              <dd>
                {record.firstTextMs == null && record.status === 'running'
                  ? '等待中'
                  : seconds(record.firstTextMs)}
              </dd>
            </div>
            <div>
              <dt>
                {record.status === 'completed'
                  ? '完成'
                  : '已用时间（最近记录）'}
              </dt>
              <dd>{seconds(record.elapsedMs)}</dd>
            </div>
            <div>
              <dt>输入字符</dt>
              <dd>{record.promptCharacters.toLocaleString()}</dd>
            </div>
            <div>
              <dt>
                {record.status === 'running'
                  ? '输出字符（最近记录）'
                  : '输出字符'}
              </dt>
              <dd>{record.outputCharacters.toLocaleString()}</dd>
            </div>
          </dl>
        </article>
      ))}
      <p>
        时间均从本次调用开始累计；首段正文之前包含服务等待与处理时间，不能直接视为模型的推理时长。字符数不是
        token 数。
      </p>
    </details>
  )
}
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="notice" role="status">
      {children}
    </div>
  )
}
export function DocumentView({
  document,
  onUpload,
  disabled,
}: {
  document: WorkspaceDocument
  onUpload: (file?: File) => void
  disabled: boolean
}) {
  return (
    <section
      className="document-view"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        if (!disabled) onUpload(event.dataTransfer.files[0])
      }}
    >
      <div className="document-toolbar">
        <div>
          <FileText size={17} />
          <strong>{document.name}</strong>
          <small>{document.size}</small>
        </div>
        <label
          className={`secondary-button upload-label ${disabled ? 'disabled' : ''}`}
        >
          <Upload size={15} />
          上传业务文档
          <input
            aria-label="上传业务文档"
            type="file"
            disabled={disabled}
            accept=".docx,.md,.markdown,.txt,.html,.htm"
            onChange={(event) => {
              onUpload(event.target.files?.[0])
              event.target.value = ''
            }}
          />
        </label>
      </div>
      {document.content ? (
        <div className="evidence-editor-host panel-surface">
          <QQDocEditor
            key={`${document.name}-${document.updated}`}
            embedded
            readOnly
            initialTitle={document.name}
            initialContent={documentToHtml(document.content)}
          />
        </div>
      ) : (
        <div className="empty-state upload-empty">
          <FileText size={34} />
          <h2>从一份业务文档开始</h2>
          <p>上传或拖入 DOCX、Markdown、TXT、HTML，先阅读业务，再讨论模型。</p>
        </div>
      )}
    </section>
  )
}

import ExpressionReview from './ExpressionReview.tsx'
import { STAGE_PART_LABELS } from '../../shared/expression.ts'

const COLLECTIONS = [
  ['objects', '对象关系'],
  ['actions', '业务操作'],
  ['functions', '只读能力'],
  ['rules', '业务规则'],
] as const
type CollectionTab = (typeof COLLECTIONS)[number][0]
interface CandidateViewProps {
  candidate: CandidateDraft | null
  plan: SemanticPlan | null
  mode: ModelViewMode
  onMode: (mode: ModelViewMode) => void
  selectedId: string | null
  onSelect: (id: string | null) => void
  onDiscuss: OnDiscuss
  onEdit: OnEdit
  onAdd: (name: string, description: string) => void
  onRebuild: () => void
  disabled: boolean
  runningPart?: StagePart | ''
  runningText?: string
  activities?: string[]
  running?: boolean
}

const FACT_KIND_LABELS: Record<BusinessFact['kind'], string> = {
  static: '静态事实',
  event: '业务事件',
  state: '状态变化',
  constraint: '约束规则',
  role: '参与角色',
}
const FACT_CERTAINTY_LABELS: Record<BusinessFact['certainty'], string> = {
  explicit: '原文明确',
  confirmed: '已确认',
  uncertain: '待确认',
}
const COVERAGE_LABELS = {
  full: '完整表达',
  partial: '部分表达',
  missing: '尚未表达',
} as const
type Coverage = keyof typeof COVERAGE_LABELS
type EvidenceMode = 'facts' | 'stories'
type WorkflowState = 'waiting' | 'active' | 'done' | 'attention'

function ModelingWorkflow({
  plan,
  candidate,
  runningPart,
  runningText = '',
  activities = [],
  running = false,
}: {
  plan: SemanticPlan | null
  candidate: CandidateDraft | null
  runningPart?: StagePart | ''
  runningText?: string
  activities?: string[]
  running?: boolean
}) {
  const semantic = plan?.semantic
  const hasFacts = Boolean(semantic?.facts.length)
  const hasStories = semantic?.status === 'stories' || semantic?.status === 'mapped'
  const expressionDone = Boolean(
    candidate?.expressionReview &&
      !['checking', 'repairing'].includes(candidate.expressionReview.status),
  )
  const mappingActive =
    runningPart === 'semantic' && runningText.includes('映射')
  const stages: {
    label: string
    detail: string
    state: WorkflowState
  }[] = [
    {
      label: '业务事实',
      detail: hasFacts ? `${semantic?.facts.length} 项` : '等待提取',
      state:
        runningPart === 'semantic' && (!hasFacts || runningText.includes('提取'))
          ? 'active'
          : hasFacts
            ? 'done'
            : 'waiting',
    },
    {
      label: '业务故事',
      detail: hasStories ? `${semantic?.stories.length || 0} 个` : '等待组织',
      state:
        runningPart === 'semantic' && runningText.includes('组织')
          ? 'active'
          : hasStories
            ? 'done'
            : 'waiting',
    },
    {
      label: '建模判断',
      detail: plan?.complete ? '说明已形成' : '等待判断',
      state:
        runningPart === 'semantic' && hasStories && !plan?.complete && !mappingActive
          ? 'active'
          : plan?.complete
            ? 'done'
            : 'waiting',
    },
    {
      label: '模型编译',
      detail: candidate ? `版本 ${candidate.revision}` : '等待编译',
      state:
        runningPart === 'compile'
          ? 'active'
          : candidate
            ? 'done'
            : 'waiting',
    },
    {
      label: '表达检查',
      detail: expressionDone ? '检查已完成' : '等待检查',
      state: ['expression', 'repair', 'recheck'].includes(runningPart || '')
        ? 'active'
        : expressionDone
          ? candidate?.expressionReview?.status === 'passed'
            ? 'done'
            : 'attention'
          : 'waiting',
    },
    {
      label: '事实覆盖',
      detail:
        semantic?.status === 'mapped'
          ? candidate?.edited
            ? '需要更新'
            : '映射已完成'
          : '等待映射',
      state: mappingActive
        ? 'active'
        : semantic?.status === 'mapped'
          ? candidate?.edited
            ? 'attention'
            : 'done'
          : candidate && !runningPart
            ? 'attention'
            : 'waiting',
    },
  ]
  return (
    <section className="workflow-status" aria-label="建模执行状态">
      <header>
        <strong>执行进度</strong>
        <span>
          {running
            ? '进行中'
            : activities.length
              ? '最近一次'
              : candidate || plan?.semantic
                ? '当前状态'
                : '尚未运行'}
        </span>
      </header>
      <ol className="modeling-workflow">
        {stages.map((stage, index) => (
          <li key={stage.label} data-state={stage.state}>
            <div className="workflow-stage">
              <span className="workflow-marker" aria-hidden="true">
                {stage.state === 'done' ? (
                  <Check size={13} />
                ) : stage.state === 'active' ? (
                  <LoaderCircle className="spin" size={13} />
                ) : stage.state === 'attention' ? (
                  <AlertTriangle size={13} />
                ) : (
                  <Circle size={10} />
                )}
              </span>
              <span>
                <strong>{stage.label}</strong>
                <small>{stage.detail}</small>
              </span>
            </div>
            {index < stages.length - 1 && <i aria-hidden="true" />}
          </li>
        ))}
      </ol>
      {!!activities.length && (
        <ol className="modeling-activity" aria-label="本轮执行记录" aria-live="polite">
          {activities.slice(-4).map((activity, index, visible) => {
            const active = running && index === visible.length - 1
            const failed = activity.startsWith('任务中断') || activity === '任务已停止。'
            return (
              <li
                key={`${activity}-${index}`}
                data-active={active || undefined}
                data-failed={failed || undefined}
              >
                <span aria-hidden="true">
                  {active ? (
                    <LoaderCircle className="spin" size={13} />
                  ) : failed ? (
                    <AlertTriangle size={13} />
                  ) : (
                    <Check size={13} />
                  )}
                </span>
                <p>{activity}</p>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

function SemanticEvidence({ semantic }: { semantic?: SemanticPlanV2 }) {
  const [mode, setMode] = useState<EvidenceMode>('facts')
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<'all' | BusinessFact['kind']>('all')
  const [selectedStoryId, setSelectedStoryId] = useState('')
  const facts = semantic?.facts || []
  const stories = semantic?.stories || []
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleFacts = facts.filter(
    (fact) =>
      (kind === 'all' || fact.kind === kind) &&
      (!normalizedQuery ||
        [fact.statement, fact.source, ...fact.actors, ...fact.objects]
          .join(' ')
          .toLocaleLowerCase()
          .includes(normalizedQuery)),
  )
  const selectedStory =
    stories.find((story) => story.id === selectedStoryId) || stories[0]
  useEffect(() => {
    if (stories.length && !stories.some((story) => story.id === selectedStoryId))
      setSelectedStoryId(stories[0].id)
  }, [stories, selectedStoryId])

  if (!semantic)
    return (
      <div className="empty-state panel-surface">
        运行建模后，提取出的业务事实和业务故事会先出现在这里。
      </div>
    )

  return (
    <div className="semantic-evidence">
      <div className="artifact-heading">
        <div>
          <h2>语义依据</h2>
          <p>先核对系统从业务说明中识别出的事实，再查看这些事实如何组成业务过程。</p>
        </div>
        <Switcher
          label="语义依据内容"
          items={[
            ['facts', `业务事实 ${facts.length}`],
            ['stories', `业务故事 ${stories.length}`],
          ]}
          value={mode}
          onChange={setMode}
        />
      </div>
      {mode === 'facts' ? (
        <div className="fact-browser panel-surface">
          <div className="artifact-tools">
            <label className="search-field">
              <Search size={14} />
              <input
                aria-label="搜索业务事实"
                placeholder="搜索事实、参与者或原文"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <select
              aria-label="按事实类型筛选"
              value={kind}
              onChange={(event) =>
                setKind(event.target.value as 'all' | BusinessFact['kind'])
              }
            >
              <option value="all">全部类型</option>
              {Object.entries(FACT_KIND_LABELS).map(([value, label]) => (
                <option value={value} key={value}>{label}</option>
              ))}
            </select>
            <span className="muted">显示 {visibleFacts.length}/{facts.length}</span>
          </div>
          <div className="fact-list">
            {visibleFacts.map((fact) => {
              const storyNames = stories
                .filter((story) => story.factIds.includes(fact.id))
                .map((story) => story.name)
              return (
                <article className="fact-row" key={fact.id}>
                  <div className="fact-row-main">
                    <div className="fact-meta">
                      <span>{FACT_KIND_LABELS[fact.kind]}</span>
                      <span className={fact.certainty === 'uncertain' ? 'uncertain' : ''}>
                        {FACT_CERTAINTY_LABELS[fact.certainty]}
                      </span>
                      <code>{fact.id}</code>
                    </div>
                    <p>{fact.statement}</p>
                    {!!storyNames.length && (
                      <small>所属故事：{storyNames.join('、')}</small>
                    )}
                  </div>
                  <blockquote>
                    <span>原文依据</span>
                    {fact.source}
                  </blockquote>
                </article>
              )
            })}
            {!visibleFacts.length && (
              <div className="empty-state">没有符合当前条件的业务事实。</div>
            )}
          </div>
        </div>
      ) : !stories.length ? (
        <div className="empty-state panel-surface">
          业务事实已经保留，业务故事尚未形成。
        </div>
      ) : (
        <div className="story-browser">
          <nav className="story-index panel-surface" aria-label="业务故事">
            {stories.map((story, index) => (
              <button
                type="button"
                key={story.id}
                className={selectedStory?.id === story.id ? 'active' : ''}
                onClick={() => setSelectedStoryId(story.id)}
              >
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{story.name}</strong>
                <small>{story.steps.length} 个步骤 · {story.factIds.length} 项事实</small>
              </button>
            ))}
          </nav>
          {selectedStory && (
            <StoryDetail story={selectedStory} facts={facts} />
          )}
        </div>
      )}
      {!!semantic.clarifications.length && (
        <section className="clarification-list panel-surface">
          <div className="panel-toolbar">
            <h3>待确认的业务信息</h3>
            <span className="badge partial">{semantic.clarifications.length} 项</span>
          </div>
          <ul>
            {semantic.clarifications.map((item, index) => (
              <li key={`${item.text}-${index}`}>
                <strong>{item.text}</strong>
                <span>依据：{item.basis}</span>
                <span>模型影响：{item.impact}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function StoryDetail({
  story,
  facts,
}: {
  story: BusinessStory
  facts: BusinessFact[]
}) {
  return (
    <article className="story-detail panel-surface">
      <header>
        <span className="muted">业务目标</span>
        <h2>{story.name}</h2>
        <p>{story.goal}</p>
      </header>
      <ol className="story-steps">
        {story.steps.map((step) => (
          <li key={`${story.id}-${step.order}`}>
            <span>{step.order}</span>
            <div>
              <strong>{step.actor}</strong>
              <p>{step.action} · {step.object}</p>
              {step.condition && <small>条件：{step.condition}</small>}
              {step.result && <small>结果：{step.result}</small>}
              <div className="story-fact-links">
                {step.factIds.map((id) => <code key={id}>{id}</code>)}
              </div>
            </div>
          </li>
        ))}
      </ol>
      <details className="story-facts">
        <summary>查看支撑这个故事的 {story.factIds.length} 项事实</summary>
        <ul>
          {story.factIds.map((id) => {
            const fact = facts.find((item) => item.id === id)
            return fact ? <li key={id}>{fact.statement}</li> : null
          })}
        </ul>
      </details>
    </article>
  )
}

function coverageForFact(
  factId: string,
  mappings: ElementMapping[],
): Coverage {
  const matches = mappings.filter((mapping) => mapping.factId === factId)
  if (matches.some((mapping) => mapping.coverage === 'full')) return 'full'
  if (matches.some((mapping) => mapping.coverage === 'partial')) return 'partial'
  return 'missing'
}

function CoverageView({
  semantic,
  model,
  stale,
  onSelect,
  onRebuild,
  disabled,
}: {
  semantic?: SemanticPlanV2
  model?: CandidateModel
  stale: boolean
  onSelect: (id: string) => void
  onRebuild: () => void
  disabled: boolean
}) {
  const [filter, setFilter] = useState<'all' | Coverage>('all')
  const facts = semantic?.facts || []
  const mappings = semantic?.mappings || []
  const elementNames = new Map(
    model
      ? [
          ...model.objects,
          ...model.relations,
          ...model.actions,
          ...model.functions,
          ...model.rules,
          ...model.activities,
        ].map((item) => [item.id, item.name])
      : [],
  )
  const editableIds = new Set(
    model
      ? [
          ...model.objects,
          ...model.relations,
          ...model.actions,
          ...model.functions,
          ...model.rules,
        ].map((item) => item.id)
      : [],
  )
  const counts = facts.reduce(
    (result, fact) => {
      result[coverageForFact(fact.id, mappings)] += 1
      return result
    },
    { full: 0, partial: 0, missing: 0 },
  )
  const visibleFacts = facts.filter(
    (fact) => filter === 'all' || coverageForFact(fact.id, mappings) === filter,
  )

  return (
    <div className="coverage-view">
      <div className="artifact-heading">
        <div>
          <h2>事实覆盖</h2>
          <p>检查每项业务事实是否能在当前候选模型中找到明确的表达位置。</p>
        </div>
        <span className="muted">
          {semantic?.status === 'mapped' ? '映射已完成' : '映射尚未完成'}
        </span>
      </div>
      {stale && (
        <Notice>
          候选模型已经手工修改。以下映射对应修改前的模型，仅供参考；重新建模后才会更新覆盖结论。
          <button className="text-button" disabled={disabled} onClick={onRebuild}>
            重新建模并更新覆盖
          </button>
        </Notice>
      )}
      <div className="coverage-summary" role="group" aria-label="按覆盖状态筛选">
        <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
          <span>全部事实</span><strong>{facts.length}</strong>
        </button>
        {(['full', 'partial', 'missing'] as const).map((status) => (
          <button
            key={status}
            className={status}
            aria-pressed={filter === status}
            onClick={() => setFilter(status)}
          >
            <span>{COVERAGE_LABELS[status]}</span><strong>{counts[status]}</strong>
          </button>
        ))}
      </div>
      {!facts.length ? (
        <div className="empty-state panel-surface">
          事实提取完成后，这里会显示模型覆盖情况。
        </div>
      ) : semantic?.status !== 'mapped' ? (
        <div className="coverage-pending panel-surface">
          <AlertTriangle size={18} />
          <div>
            <strong>事实映射尚未完成</strong>
            <p>
              已保留 {facts.length} 项事实和 {semantic?.stories.length || 0} 个业务故事。
              {model
                ? '候选模型也已保留，但本次映射没有完成；请结合运行警告重新建模并更新覆盖。'
                : '候选模型生成后会继续建立覆盖关系。'}
            </p>
            {model && (
              <button className="secondary-button" disabled={disabled} onClick={onRebuild}>
                重新建模并更新覆盖
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="coverage-list panel-surface">
          {visibleFacts.map((fact) => {
            const status = coverageForFact(fact.id, mappings)
            const factMappings = mappings.filter((mapping) => mapping.factId === fact.id)
            return (
              <article className="coverage-row" key={fact.id}>
                <div className="coverage-fact">
                  <span className={`badge ${status}`}>{COVERAGE_LABELS[status]}</span>
                  <div>
                    <strong>{fact.statement}</strong>
                    <small>{fact.source}</small>
                  </div>
                </div>
                <div className="coverage-expression">
                  {factMappings.map((mapping, index) => (
                    <div key={`${mapping.factId}-${mapping.mappingType}-${index}`}>
                      <div className="mapped-elements">
                        {mapping.elementIds.length ? mapping.elementIds.map((id) =>
                          editableIds.has(id) ? (
                            <button type="button" key={id} onClick={() => onSelect(id)}>
                              {elementNames.get(id) || id}
                            </button>
                          ) : (
                            <span key={id}>{elementNames.get(id) || id}</span>
                          ),
                        ) : <span>没有对应模型元素</span>}
                      </div>
                      <p>{mapping.explanation}</p>
                    </div>
                  ))}
                  {!factMappings.length && <p>没有找到这项事实的映射记录。</p>}
                </div>
              </article>
            )
          })}
          {!visibleFacts.length && (
            <div className="empty-state">当前筛选下没有业务事实。</div>
          )}
        </div>
      )}
    </div>
  )
}

export function CandidateView({
  candidate,
  plan,
  mode,
  onMode,
  selectedId,
  onSelect,
  onDiscuss,
  onEdit,
  onAdd,
  onRebuild,
  disabled,
  runningPart,
  runningText,
  activities,
  running,
}: CandidateViewProps) {
  const [collection, setCollection] = useState<CollectionTab>('objects')
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const model = candidate?.model
  const elements = model
    ? [
        ...model.objects,
        ...model.relations,
        ...model.actions,
        ...model.functions,
        ...model.rules,
      ]
    : []
  const selected = elements.find((item) => item.id === selectedId)
  const selectedKind =
    model &&
    EDITABLE_COLLECTIONS.find((key) =>
      model[key].some((item) => item.id === selectedId),
    )
  useEffect(() => {
    if (selectedKind)
      setCollection(selectedKind === 'relations' ? 'objects' : selectedKind)
  }, [selectedId, selectedKind])
  const select = (id: string) => {
    if (!model) return
    onMode('model')
    const kind = EDITABLE_COLLECTIONS.find((key) =>
      model[key].some((item) => item.id === id),
    )
    setCollection(kind === 'relations' ? 'objects' : kind || 'objects')
    onSelect(id)
  }
  return (
    <section className="candidate-view">
      <div className="candidate-overview">
        <div>
          <span className="artifact-kicker">从业务事实到候选模型</span>
          <strong>
            {runningPart
              ? runningText || STAGE_PART_LABELS[runningPart]
              : candidate
                ? `模型版本 ${candidate.revision}${candidate.edited ? ' · 已手工修改' : ''}`
                : plan?.semantic
                  ? '语义准备已开始'
                  : '等待开始建模'}
          </strong>
        </div>
        {plan?.semantic && (
          <dl>
            <div><dt>事实</dt><dd>{plan.semantic.facts.length}</dd></div>
            <div><dt>故事</dt><dd>{plan.semantic.stories.length}</dd></div>
            <div><dt>模型元素</dt><dd>{model ? elements.length + model.activities.length : 0}</dd></div>
          </dl>
        )}
      </div>
      <ModelingWorkflow
        plan={plan}
        candidate={candidate}
        runningPart={runningPart}
        runningText={runningText}
        activities={activities}
        running={running}
      />
      <div className="candidate-tabs">
        <span>建模工作区</span>
        <Switcher
          label="建模工作区内容"
          items={[
            ['evidence', '业务依据'],
            ['decisions', '建模决策'],
            ['model', '候选模型'],
            ['coverage', '覆盖检查'],
          ]}
          value={mode}
          onChange={onMode}
        />
      </div>
      {!!plan?.warnings?.length && (
        <Notice>
          {plan.warnings.map((warning, index) => (
            <p key={index}>{warning}</p>
          ))}
        </Notice>
      )}
      {mode === 'evidence' ? (
        <SemanticEvidence semantic={plan?.semantic} />
      ) : mode === 'decisions' ? (
        <article className="panel-surface reading-narrative">
          <div className="panel-toolbar">
            <div>
              <h2>建模决策</h2>
              <p className="panel-subtitle">从业务事实到对象、关系、动作、能力和规则的判断依据。</p>
            </div>
            <span className="muted">
              {runningPart === 'semantic'
                ? '正在输出'
                : plan?.complete
                  ? '说明已完成'
                  : '说明尚未完成'}
            </span>
          </div>
          {plan?.plan ? (
            <Markdown>{modelingContent(plan.plan)}</Markdown>
          ) : (
            <div className="empty-state">
              {runningPart
                ? '正在判断对象边界和业务联系…'
                : plan?.semantic
                  ? '事实和故事已保留，建模决策尚未形成。'
                  : '开始建模后，这里会解释模型的设计依据。'}
            </div>
          )}
          {runningPart && (
            <div className="reading-note">
              <span className="typing-indicator">
                <i />
                <i />
                <i />
              </span>
              {STAGE_PART_LABELS[runningPart]}…
            </div>
          )}
          {(candidate?.edited ||
            !!candidate?.expressionReview?.changes.length) &&
            plan?.compiled && (
              <Notice>
                模型已经修正，以上保留初始建模说明。最新定义以模型视图为准，修正原因见业务表达检查。
              </Notice>
            )}
        </article>
      ) : mode === 'coverage' ? (
        <CoverageView
          semantic={plan?.semantic}
          model={model}
          stale={Boolean(candidate?.edited)}
          onSelect={select}
          onRebuild={onRebuild}
          disabled={disabled}
        />
      ) : !model ? (
        <div className="empty-state panel-surface">
          候选模型整理完成后，将在这里展示对象、关系和业务能力。
        </div>
      ) : (
        <>
          {candidate && (
            <ExpressionReview candidate={candidate} onSelect={select} />
          )}
          <div className="model-summary">
            <h2>{model.name}</h2>
            <p>{model.summary}</p>
          </div>
          <div className="view-toolbar">
            <Switcher
              label="模型内容"
              items={COLLECTIONS.map(([id, label]) => [
                id,
                `${label} ${model[id].length}`,
              ])}
              value={collection}
              onChange={setCollection}
            />
            {collection === 'objects' && (
              <button
                className="text-button"
                disabled={disabled}
                onClick={() => setAdding(!adding)}
              >
                <Plus size={14} />
                补充对象
              </button>
            )}
          </div>
          {adding && (
            <form
              className="inline-edit panel-surface"
              onSubmit={(event) => {
                event.preventDefault()
                if (!name.trim() || !description.trim()) return
                onAdd(name.trim(), description.trim())
                setAdding(false)
                setName('')
                setDescription('')
              }}
            >
              <input
                aria-label="新对象名称"
                required
                placeholder="对象名称"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <textarea
                aria-label="新对象业务边界"
                required
                placeholder="说明其业务含义及独立边界"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
              <div className="button-row">
                <button className="primary-button" disabled={disabled}>
                  加入模型
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setAdding(false)}
                >
                  取消
                </button>
              </div>
            </form>
          )}
          <div className={`model-workspace ${selected ? 'has-selection' : ''}`}>
            <div className="model-surface panel-surface">
              {collection === 'objects' ? (
                <>
                  <ModelGraph
                    model={model}
                    selectedId={selectedId}
                    onSelect={select}
                  />
                  <div className="object-index">
                    {model.objects.map((item) => (
                      <button
                        key={item.id}
                        className={selectedId === item.id ? 'active' : ''}
                        onClick={() => select(item.id)}
                      >
                        {item.name}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="element-list">
                  {model[collection].length ? (
                    model[collection].map((item) => (
                      <button
                        className={selectedId === item.id ? 'active' : ''}
                        key={item.id}
                        onClick={() => select(item.id)}
                      >
                        <strong>{item.name}</strong>
                        <p>{item.description}</p>
                        <span>
                          {('targets' in item
                            ? item.targets
                            : 'elements' in item
                              ? item.elements
                              : []
                          )
                            .map(
                              (id) =>
                                elements.find((entry) => entry.id === id)
                                  ?.name || id,
                            )
                            .join(' · ')}
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="empty-state">本轮未识别此类内容。</div>
                  )}
                </div>
              )}
            </div>
            {selected && selectedKind && (
              <ElementDetails
                key={selected.id}
                model={model}
                element={selected}
                kind={selectedKind}
                semantic={plan?.semantic}
                mappingsStale={Boolean(candidate?.edited)}
                onSelect={select}
                onDiscuss={onDiscuss}
                onEdit={onEdit}
                onClose={() => onSelect(null)}
                disabled={disabled}
              />
            )}
          </div>
        </>
      )}
      {!!candidate?.historicalQuestions?.length && (
        <details className="panel-surface model-questions">
          <summary>旧版待确认事项 · 仅供查看</summary>
          <p>
            这些问题尚未按“依据、歧义、模型影响”核验，不会作为下一轮建模输入。请重新建模整理当前边界。
          </p>
          <ul>
            {candidate.historicalQuestions.map((question, index) => (
              <li key={index}>{question}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

function ElementDetails({
  model,
  element,
  kind,
  semantic,
  mappingsStale,
  onSelect,
  onDiscuss,
  onEdit,
  onClose,
  disabled,
}: {
  model: CandidateModel
  element: EditableElement
  kind: EditableCollection
  semantic?: SemanticPlanV2
  mappingsStale: boolean
  onSelect: (id: string) => void
  onDiscuss: OnDiscuss
  onEdit: OnEdit
  onClose: () => void
  disabled: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(element.name)
  const [description, setDescription] = useState(element.description)
  const all = [
    ...model.objects,
    ...model.relations,
    ...model.actions,
    ...model.functions,
    ...model.rules,
  ]
  const links = (items: EditableElement[]) => (
    <div className="related-list">
      {items.map((item) => (
        <button key={item.id} onClick={() => onSelect(item.id)}>
          {item.name}
          <ArrowRight size={13} />
        </button>
      ))}
    </div>
  )
  const refs = (ids: string[]) =>
    links(
      ids
        .map((id) => all.find((item) => item.id === id))
        .filter((item) => item !== undefined),
    )
  const related = kind === 'objects' ? relatedElements(model, element.id) : null
  const derivedFacts = semantic
    ? semantic.mappings.filter((mapping) => mapping.elementIds.includes(element.id))
    : []
  return (
    <aside className="element-details panel-surface">
      <div className="panel-toolbar">
        <h3>
          {kind === 'relations'
            ? '关系含义'
            : kind === 'objects'
              ? '对象边界'
              : '业务含义'}
        </h3>
        <button className="icon-button" aria-label="关闭详情" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="detail-body">
        <h2>{element.name}</h2>
        <p>{element.description}</p>
        {'from' in element && (
          <section>
            <h4>关系方向</h4>
            {refs([element.from, element.to])}
          </section>
        )}
        {'targets' in element && element.targets.length > 0 && (
          <section>
            <h4>涉及对象</h4>
            {refs(element.targets)}
          </section>
        )}
        {'elements' in element && element.elements.length > 0 && (
          <section>
            <h4>作用范围</h4>
            {refs(element.elements)}
          </section>
        )}
        {'preconditions' in element && element.preconditions.length > 0 && (
          <section>
            <h4>前提</h4>
            <ul>
              {element.preconditions.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </section>
        )}
        {'effects' in element && element.effects.length > 0 && (
          <section>
            <h4>产生的变化</h4>
            <ul>
              {element.effects.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </section>
        )}
        {'output' in element && element.output && (
          <section>
            <h4>只读输出</h4>
            <p>{element.output}</p>
          </section>
        )}
        {related && (
          <>
            {related.relations.length > 0 && (
              <section>
                <h4>直接关系</h4>
                {links(related.relations)}
              </section>
            )}
            {related.capabilities.length > 0 && (
              <section>
                <h4>相关操作与只读能力</h4>
                {links(related.capabilities)}
              </section>
            )}
            {related.rules.length > 0 && (
              <section>
                <h4>相关规则</h4>
                {links(related.rules)}
              </section>
            )}
          </>
        )}
        {derivedFacts.length > 0 && (
          <section>
            <h4>
              推导来源的业务事实
              {mappingsStale && <span className="mapping-stale-label">修改前映射</span>}
            </h4>
            <ul className="semantic-derivation">
              {derivedFacts.map((mapping) => {
                const fact = semantic?.facts.find((item) => item.id === mapping.factId)
                return fact ? <li key={mapping.factId}>{fact.statement}<span className="muted">（依据：{fact.source} · {mapping.coverage === 'full' ? '完整表达' : mapping.coverage === 'partial' ? '部分表达' : '尚未表达'}）</span></li> : null
              })}
            </ul>
          </section>
        )}
        <div className="button-row">
          <button
            className="secondary-button"
            onClick={() => onDiscuss(element)}
          >
            <MessageCircle size={14} />
            讨论此项
          </button>
          <button
            className="text-button"
            disabled={disabled}
            onClick={() => setEditing(!editing)}
          >
            修改表述
          </button>
        </div>
        {editing && (
          <form
            className="inline-edit"
            onSubmit={(event) => {
              event.preventDefault()
              onEdit(kind, element.id, {
                name: name.trim(),
                description: description.trim(),
              })
              setEditing(false)
            }}
          >
            <input
              aria-label="元素名称"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <textarea
              aria-label="业务含义"
              required
              rows={5}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
            <button
              className="primary-button"
              disabled={disabled || !name.trim() || !description.trim()}
            >
              保存修改
            </button>
          </form>
        )}
      </div>
    </aside>
  )
}

export function ReviewView({
  mode,
  onMode,
  narration,
  assessment,
  running,
  model,
  onAddFeedback,
  feedback,
  feedbackDisabled,
  onDiscuss,
  onCompare,
  comparison,
}: {
  mode: ReviewViewMode
  onMode: (mode: ReviewViewMode) => void
  narration: string
  assessment: Assessment | null
  running?: AnalysisStage
  model?: CandidateModel
  onAddFeedback: (text: string) => void
  feedback: string
  feedbackDisabled: boolean
  onDiscuss: OnDiscuss
  onCompare: () => void
  comparison?: string
}) {
  return (
    <section className="review-view">
      <div className="view-toolbar">
        <Switcher
          label="模型检验方式"
          items={[
            ['narration', '模型自述'],
            ['assessment', '业务过程支撑'],
          ]}
          value={mode}
          onChange={onMode}
        />
        {mode === 'narration' && narration && (
          <button className="text-button" onClick={onCompare}>
            {comparison ? '关闭对照' : '对照业务理解'}
          </button>
        )}
      </div>
      {mode === 'narration' ? (
        <div className={comparison ? 'narration-comparison' : ''}>
          {comparison && (
            <article className="panel-surface">
              <div className="panel-toolbar">
                <h2>业务理解</h2>
              </div>
              <Markdown>{comparison}</Markdown>
            </article>
          )}
          <article className="panel-surface">
            <div className="panel-toolbar">
              <h2>模型如何描述这项业务</h2>
            </div>
            <p className="reading-note">
              仅基于候选模型复述，用来检查模型表达的业务是否符合你的理解。
            </p>
            {narration ? (
              <Markdown>{narration}</Markdown>
            ) : (
              <div className="empty-state">
                {running === 'narrate'
                  ? '正在生成模型自述…'
                  : '候选模型生成后，运行模型检验。'}
              </div>
            )}
            {running === 'narrate' && (
              <span className="typing-indicator">
                <i />
                <i />
                <i />
              </span>
            )}
          </article>
        </div>
      ) : (
        <BusinessProcessSupport
          assessment={assessment}
          running={running === 'assess'}
          model={model}
          onDiscuss={onDiscuss}
          onAddFeedback={onAddFeedback}
          feedback={feedback}
          disabled={feedbackDisabled}
        />
      )}
    </section>
  )
}
