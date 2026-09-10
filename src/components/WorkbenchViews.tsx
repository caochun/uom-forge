import { useEffect, useState } from 'react'
import {
  ArrowRight,
  FileText,
  MessageCircle,
  Plus,
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
            <Markdown>{modelingContent(plan.plan)}</Markdown>
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
