import { useEffect, useState } from 'react'
import {
  ArrowRight,
  FileText,
  MessageCircle,
  Plus,
  Upload,
  X,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import QQDocEditor from 'qq-doc-clone'
import { documentToHtml } from '../document.ts'
import { relatedElements } from '../workspace.ts'
import type { ReactNode } from 'react'
import type { Assessment, StagePart } from '../../shared/analysis.ts'
import type { CandidateModel } from '../../shared/model.ts'
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

export function Markdown({ children }: { children?: string }) {
  return (
    <div className="narrative-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {children || ''}
      </ReactMarkdown>
    </div>
  )
}
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
export function RawOutput({
  output,
  live,
}: {
  output?: string
  live: boolean
}) {
  if (!output && !live) return null
  return (
    <details className="live-stage-output panel-surface">
      <summary>
        原始输出记录 <small>{live ? '正在接收' : '保留完整输出'}</small>
      </summary>
      <pre>{output || '等待输出…'}</pre>
    </details>
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
  disabled: boolean
  runningPart?: StagePart | ''
  raw?: string
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
  disabled,
  runningPart,
  raw,
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
    const kind = EDITABLE_COLLECTIONS.find((key) =>
      model[key].some((item) => item.id === id),
    )
    setCollection(kind === 'relations' ? 'objects' : kind || 'objects')
    onSelect(id)
  }
  return (
    <section className="candidate-view">
      <div className="view-toolbar">
        <Switcher
          label="候选模型呈现方式"
          items={[
            ['plan', '建模说明'],
            ['model', '模型视图'],
          ]}
          value={mode}
          onChange={onMode}
        />
        <span className="muted">
          {runningPart === 'semantic'
            ? '正在形成建模说明'
            : runningPart === 'compile'
              ? '正在整理候选模型'
              : candidate
                ? `模型版本 ${candidate.revision}${candidate.edited ? ' · 已手工修改' : ''}`
                : '尚未生成模型'}
        </span>
      </div>
      {mode === 'plan' ? (
        <article className="panel-surface reading-narrative">
          <div className="panel-toolbar">
            <h2>建模说明</h2>
            <span className="muted">
              {runningPart === 'semantic'
                ? '正在输出'
                : plan?.complete
                  ? '说明已完成'
                  : '说明尚未完成'}
            </span>
          </div>
          {plan?.plan ? (
            <Markdown>{plan.plan}</Markdown>
          ) : (
            <div className="empty-state">
              {runningPart
                ? '正在判断对象边界和业务联系…'
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
              {runningPart === 'compile'
                ? '说明已完成，正在整理模型。'
                : '正在形成说明。'}
            </div>
          )}
          {candidate?.edited && plan?.compiled && (
            <Notice>模型已手工修改，以上说明保留生成时的建模判断。</Notice>
          )}
        </article>
      ) : !model ? (
        <div className="empty-state panel-surface">
          候选模型整理完成后，将在这里展示对象、关系和业务能力。
        </div>
      ) : (
        <>
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
                  <div className="panel-toolbar">
                    <h3>对象及业务联系</h3>
                    <span className="muted">
                      {model.objects.length} 个对象 · {model.relations.length}{' '}
                      条关系
                    </span>
                  </div>
                  <Graph
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
                onSelect={select}
                onDiscuss={onDiscuss}
                onEdit={onEdit}
                onClose={() => onSelect(null)}
                disabled={disabled}
              />
            )}
          </div>
          {model.questions.length > 0 && (
            <details className="panel-surface model-questions">
              <summary>模型中的待确认事项 · {model.questions.length}</summary>
              <ul>
                {model.questions.map((question, index) => (
                  <li key={index}>{question}</li>
                ))}
              </ul>
              <button
                className="text-button"
                onClick={() =>
                  onDiscuss({
                    name: '模型待确认事项',
                    description: model.questions.join('\n'),
                  })
                }
              >
                与助手讨论
              </button>
            </details>
          )}
        </>
      )}
      <RawOutput output={raw} live={Boolean(runningPart)} />
    </section>
  )
}

function Graph({
  model,
  selectedId,
  onSelect,
}: {
  model: CandidateModel
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const columns = Math.max(
    1,
    Math.min(3, Math.ceil(Math.sqrt(model.objects.length))),
  )
  const width = Math.max(640, columns * 245)
  const height = Math.max(
    380,
    Math.ceil(model.objects.length / columns) * 165 + 60,
  )
  const positions = new Map(
    model.objects.map((item, index) => [
      item.id,
      {
        x: 122 + (index % columns) * 245,
        y: 85 + Math.floor(index / columns) * 165,
      },
    ]),
  )
  return (
    <div className="graph-canvas">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ minWidth: Math.min(width, 735) }}
        role="group"
        aria-label="对象关系图"
      >
        <defs>
          <marker
            id="edge-arrow"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
          >
            <path d="M0,0 L8,4 L0,8" fill="#8d9eb4" />
          </marker>
        </defs>
        {model.relations.map((item, index) => {
          const from = positions.get(item.from)
          const to = positions.get(item.to)
          if (!from || !to) return null
          const dx = to.x - from.x
          const dy = to.y - from.y
          const ratio = Math.min(
            88 / (Math.abs(dx) || 1),
            30 / (Math.abs(dy) || 1),
          )
          const start = { x: from.x + dx * ratio, y: from.y + dy * ratio }
          const end = { x: to.x - dx * ratio, y: to.y - dy * ratio }
          const duplicateIndex = model.relations
            .slice(0, index)
            .filter(
              (relation) =>
                (relation.from === item.from && relation.to === item.to) ||
                (relation.from === item.to && relation.to === item.from),
            ).length
          const offset = duplicateIndex * 30
          const cx = (start.x + end.x) / 2 + (dy ? 26 + offset : 0)
          const cy = (start.y + end.y) / 2 - (dx ? 26 + offset : 0)
          const self = item.from === item.to
          const d = self
            ? `M ${from.x + 60} ${from.y - 30} C ${from.x + 130} ${from.y - 100}, ${from.x - 130} ${from.y - 100}, ${from.x - 60} ${from.y - 30}`
            : `M${start.x} ${start.y} Q${cx} ${cy} ${end.x} ${end.y}`
          return (
            <g
              key={item.id}
              className={`graph-edge ${selectedId === item.id ? 'active' : ''}`}
              role="button"
              aria-label={`${item.name}：${model.objects.find((entry) => entry.id === item.from)?.name}到${model.objects.find((entry) => entry.id === item.to)?.name}`}
              tabIndex={0}
              onClick={() => onSelect(item.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelect(item.id)
                }
              }}
            >
              <path className="edge-hit" d={d} />
              <path className="edge-line" d={d} markerEnd="url(#edge-arrow)" />
              <text
                x={self ? from.x : (start.x + 2 * cx + end.x) / 4}
                y={self ? from.y - 78 : (start.y + 2 * cy + end.y) / 4 - 5}
              >
                {item.name}
              </text>
            </g>
          )
        })}
        {model.objects.map((item) => {
          const position = positions.get(item.id)
          if (!position) return null
          const { x, y } = position
          const lines = item.name.match(/.{1,12}/gu) || []
          return (
            <g
              key={item.id}
              className={`graph-node ${selectedId === item.id ? 'active' : ''}`}
              transform={`translate(${x},${y})`}
              role="button"
              aria-label={item.name}
              tabIndex={0}
              onClick={() => onSelect(item.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelect(item.id)
                }
              }}
            >
              <rect
                x="-88"
                y="-30"
                width="176"
                height={Math.max(60, lines.length * 18 + 16)}
                rx="9"
              />
              <text textAnchor="middle">
                {lines.map((line, index) => (
                  <tspan
                    key={index}
                    x="0"
                    y={index * 18 + (lines.length === 1 ? 5 : -4)}
                  >
                    {line}
                  </tspan>
                ))}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function ElementDetails({
  model,
  element,
  kind,
  onSelect,
  onDiscuss,
  onEdit,
  onClose,
  disabled,
}: {
  model: CandidateModel
  element: EditableElement
  kind: EditableCollection
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
  raw,
  running,
  model,
  onSelect,
  onDiscuss,
  onCompare,
  comparison,
}: {
  mode: ReviewViewMode
  onMode: (mode: ReviewViewMode) => void
  narration: string
  assessment: Assessment | null
  raw?: string
  running?: AnalysisStage
  model?: CandidateModel
  onSelect: (id: string) => void
  onDiscuss: OnDiscuss
  onCompare: () => void
  comparison?: string
}) {
  const all = model
    ? [
        ...model.objects,
        ...model.relations,
        ...model.actions,
        ...model.functions,
        ...model.rules,
      ]
    : []
  const rows = assessment?.processAssessments || []
  return (
    <section className="review-view">
      <div className="view-toolbar">
        <Switcher
          label="模型检验方式"
          items={[
            ['narration', '模型自述'],
            ['assessment', '过程支撑'],
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
        <>
          {assessment?.summary && (
            <article className="panel-surface">
              <Markdown>{assessment.summary}</Markdown>
            </article>
          )}
          {rows.length ? (
            rows.map((row, index) => (
              <article
                className="process-card panel-surface"
                key={row.processId || index}
              >
                <div className="panel-toolbar">
                  <h3>{row.processName}</h3>
                  <span className={`badge ${row.status}`}>
                    {{
                      supported: '可支撑',
                      partial: '部分支撑',
                      missing: '存在缺口',
                    }[row.status] || '待评估'}
                  </span>
                </div>
                <div className="detail-body">
                  <div className="element-chips">
                    {row.coveredElements?.map((id) => (
                      <button key={id} onClick={() => onSelect(id)}>
                        {all.find((item) => item.id === id)?.name || id}
                      </button>
                    ))}
                  </div>
                  {row.gaps?.length > 0 && (
                    <ul>
                      {row.gaps.map((gap, i) => (
                        <li key={i}>{gap}</li>
                      ))}
                    </ul>
                  )}
                  <button
                    className="text-button"
                    onClick={() =>
                      onDiscuss({
                        name: row.processName,
                        description:
                          (row.gaps || []).join('；') ||
                          '检查当前模型对该业务过程的支撑情况。',
                      })
                    }
                  >
                    讨论此过程
                  </button>
                </div>
              </article>
            ))
          ) : (
            <div className="empty-state panel-surface">
              {running === 'assess'
                ? '正在检查模型对业务过程的支撑情况…'
                : '还没有过程支撑评估。'}
            </div>
          )}
        </>
      )}
      {mode === 'assessment' && assessment && (
        <>
          {assessment.recommendations?.length > 0 && (
            <article className="panel-surface">
              <div className="panel-toolbar">
                <h3>建议调整</h3>
              </div>
              <div className="detail-body">
                <ul>
                  {assessment.recommendations.map((text, index) => (
                    <li key={index}>{text}</li>
                  ))}
                </ul>
                <button
                  className="text-button"
                  onClick={() =>
                    onDiscuss({
                      name: '模型改进建议',
                      description: assessment.recommendations.join('\n'),
                    })
                  }
                >
                  讨论改进建议
                </button>
              </div>
            </article>
          )}
          {assessment.questions?.length > 0 && (
            <article className="panel-surface">
              <div className="panel-toolbar">
                <h3>仍需确认</h3>
              </div>
              <div className="detail-body">
                <ul>
                  {assessment.questions.map((text, index) => (
                    <li key={index}>{text}</li>
                  ))}
                </ul>
              </div>
            </article>
          )}
        </>
      )}
      <RawOutput
        output={raw}
        live={running === (mode === 'narration' ? 'narrate' : 'assess')}
      />
    </section>
  )
}
