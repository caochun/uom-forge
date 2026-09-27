import { useEffect, useId, useState } from 'react'
import {
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleDashed,
  CircleHelp,
  MessageCircle,
  Plus,
} from 'lucide-react'
import type {
  Assessment,
  CaseAssessment,
  SupportStatus,
} from '../../shared/analysis.ts'
import type { CandidateModel } from '../../shared/model.ts'
import { EDITABLE_COLLECTIONS } from '../types.ts'
import type { OnDiscuss } from '../types.ts'
import Markdown from './Markdown.tsx'
import ModelElementPreview, { ELEMENT_LABELS } from './ModelElementPreview.tsx'
import StructuredStream from './StructuredStream.tsx'

const STATUS = {
  supported: { label: '可表达', icon: CheckCircle2 },
  partial: { label: '部分表达', icon: CircleAlert },
  missing: { label: '存在缺口', icon: CircleDashed },
  clarify: { label: '业务待澄清', icon: CircleHelp },
} as const

function Status({ value }: { value: SupportStatus }) {
  const { label, icon: Icon } = STATUS[value]
  return (
    <span className={`support-status ${value}`}>
      <Icon size={14} />
      {label}
    </span>
  )
}

function feedbackFor(row: CaseAssessment) {
  return `【业务案例 ${row.caseId}】${row.scenario}\n建模依据：${row.basis}\n${row.status === 'clarify' ? '未决边界' : '缺口'}：${row.gap}\n建议：${row.suggestion}`
}

export default function BusinessCaseAssessment({
  assessment,
  running,
  stream,
  model,
  onDiscuss,
  onAddFeedback,
  feedback,
  disabled,
}: {
  assessment: Assessment | null
  running: boolean
  stream?: { text: string; reasoning: string }
  model?: CandidateModel
  onDiscuss: OnDiscuss
  onAddFeedback: (text: string) => void
  feedback: string
  disabled: boolean
}) {
  const [filter, setFilter] = useState<'all' | SupportStatus>('all')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const prefix = useId()
  useEffect(() => {
    setFilter('all')
    setExpanded({})
    setSelectedId(null)
  }, [assessment])
  const rows = assessment?.caseAssessments || []
  const firstIssue =
    rows.find((row) => row.status !== 'supported')?.caseId ||
    rows[0]?.caseId
  const elements = model
    ? EDITABLE_COLLECTIONS.flatMap((kind) =>
        model[kind].map((element) => ({ kind, element })),
      )
    : []
  const selected = elements.find((item) => item.element.id === selectedId)
  const visible = rows.filter(
    (row) => filter === 'all' || row.status === filter,
  )
  const addButton = (text: string) => {
    const added = feedback.includes(text)
    return (
      <button
        className="text-button support-add-feedback"
        disabled={disabled || added}
        onClick={() => onAddFeedback(text)}
      >
        {added ? <Check size={13} /> : <Plus size={13} />}
        {added ? '已加入反馈' : '加入下一轮反馈'}
      </button>
    )
  }
  if (!assessment)
    return (
      <>
        {stream && <StructuredStream
          title="业务案例检查"
          text={stream.text}
          reasoning={stream.reasoning}
          active={running}
          complete={!running && !!stream.text}
        />}
        <div className="empty-state panel-surface">
          {running
            ? '正在逐项检查业务案例与模型表达…'
            : '还没有业务案例检查。生成候选模型后，可以开始检验。'}
        </div>
      </>
    )
  return (
    <section
      className="business-process-support"
      aria-label="业务案例检查结果"
    >
      <article className="support-overview panel-surface">
        <div className="panel-toolbar">
          <div>
            <h2>业务案例检查</h2>
            <p className="panel-subtitle">
              业务案例与预期 · 模型如何表达或推理 · 缺口与未决边界
            </p>
          </div>
        </div>
        <Markdown>{assessment.summary}</Markdown>
        {running && (
          <p className="support-note" role="status">
            正在重新评估，以下保留上次结果。
          </p>
        )}
        <div
          className="support-filters"
          role="group"
          aria-label="按支撑状态筛选"
        >
          {(['all', 'supported', 'partial', 'missing', 'clarify'] as const).map(
            (value) => (
              <button
                key={value}
                className={`support-filter ${value}`}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                <span>
                  {value === 'all' ? '全部业务案例' : STATUS[value].label}
                </span>
                <strong>
                  {value === 'all'
                    ? rows.length
                    : rows.filter((row) => row.status === value).length}
                </strong>
              </button>
            ),
          )}
        </div>
      </article>
      {stream && <StructuredStream
        title="业务案例检查"
        text={stream.text}
        reasoning={stream.reasoning}
        active={running}
        complete={!running && !!stream.text}
      />}
      {assessment.historicalReport && (
        <details className="panel-surface support-history">
          <summary>旧版计划评估 · 仅供查看</summary>
          <p className="notice">原有结果已保留，请重新运行业务案例检查生成逐案例报告。</p>
          <Markdown>{assessment.historicalReport}</Markdown>
        </details>
      )}
      <div className="support-process-list">
        {visible.map((row) => {
          const open = expanded[row.caseId] ?? row.caseId === firstIssue
          const id = `${prefix}-${row.caseId}`
          return (
            <article className="support-process panel-surface" key={row.caseId}>
              <h3 className="support-process-heading">
                <button className="support-process-toggle" aria-expanded={open} aria-controls={id}
                  onClick={() => setExpanded(current => ({ ...current, [row.caseId]: !open }))}>
                  <div className="support-process-heading-text">
                    <strong>{row.caseId}</strong>
                    <span>{row.scenario}</span>
                  </div>
                  <Status value={row.status} />
                  <ChevronDown size={17} className={open ? 'expanded' : ''} />
                </button>
              </h3>
              {open && (
                <div id={id} className="support-process-detail">
                  <div className="support-requirement">
                    <section className="support-need">
                      <h4>案例上下文与预期</h4>
                      <Markdown>{row.scenario}</Markdown>
                      <h4>建模依据</h4>
                      <Markdown>{row.basis}</Markdown>
                    </section>
                    <section className="support-expression">
                      <h4>表达或推理路径</h4>
                      <Markdown>{row.explanation}</Markdown>
                      <div className="support-element-chips">
                        {row.elements.map(id => {
                          const match = elements.find(item => item.element.id === id)
                          return (
                            <button key={id} disabled={!match} onClick={() => setSelectedId(id)}>
                              {match && <span>{ELEMENT_LABELS[match.kind]}</span>}
                              {match?.element.name || `${id}（当前模型中不存在）`}
                            </button>
                          )
                        })}
                      </div>
                    </section>
                    <section className={`support-gap ${row.status}`}>
                      <h4>{row.status === 'clarify' ? '未决边界与确认建议' : '缺口与改进'}</h4>
                      {row.status === 'supported' ? (
                        <p className="support-complete"><Check size={14} />此案例未发现语义缺口</p>
                      ) : (
                        <>
                          <Markdown>{row.gap}</Markdown>
                          <div className="support-suggestion">
                            <h5>{row.status === 'clarify' ? '需要确认' : '处理建议'}</h5>
                            <Markdown>{row.suggestion}</Markdown>
                          </div>
                          {row.status !== 'clarify' && addButton(feedbackFor(row))}
                        </>
                      )}
                    </section>
                  </div>
                  <div className="support-process-footer">
                    <button className="text-button" onClick={() => onDiscuss({
                      name: `业务案例 ${row.caseId}`,
                      description: `${row.scenario}\n建模依据：${row.basis}\n${row.explanation}${row.gap ? `\n${feedbackFor(row)}` : ''}`,
                    })}>
                      <MessageCircle size={14} />讨论此业务案例
                    </button>
                  </div>
                </div>
              )}
            </article>
          )
        })}
        {!visible.length && !assessment.historicalReport && (
          <p className="empty-state panel-surface">
            {rows.length ? '没有符合此状态的业务案例。' : '本次检查未形成可评估的业务案例，请查看报告说明。'}
          </p>
        )}
      </div>
      {(assessment.recommendations.length > 0 ||
        assessment.clarifications.length > 0 ||
        assessment.historicalQuestions?.length) && (
        <div className="support-followups">
          {assessment.recommendations.length > 0 && (
            <article className="panel-surface">
              <div className="panel-toolbar">
                <h3>跨案例的共性建议</h3>
              </div>
              <ul>
                {assessment.recommendations.map((text, index) => (
                  <li key={index}>
                    <Markdown>{text}</Markdown>
                    <div className="support-gap-actions">
                      <button
                        className="text-button"
                        onClick={() =>
                          onDiscuss({
                            name: '模型共性改进建议',
                            description: text,
                          })
                        }
                      >
                        <MessageCircle size={13} />
                        讨论建议
                      </button>
                      {addButton(`【共性建议】${text}`)}
                    </div>
                  </li>
                ))}
              </ul>
            </article>
          )}
          {assessment.clarifications.length > 0 && (
            <article className="panel-surface">
              <div className="panel-toolbar">
                <h3>需要补充的业务信息</h3>
              </div>
              <p>
                本次评估提出 {assessment.clarifications.length}{' '}
                项业务澄清，已汇入业务理解页的确认表单，可通过页面上方入口查看依据与影响。模型缺口仍在对应案例下处理。
              </p>
            </article>
          )}
          {!!assessment.historicalQuestions?.length && (
            <details className="panel-surface">
              <summary>旧版评估问题 · 仅供查看</summary>
              <p>
                重新评估后，只将有具体依据和模型影响的业务歧义交回业务理解。
              </p>
              <ul>
                {assessment.historicalQuestions.map((text, index) => (
                  <li key={index}>{text}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {selected && model && (
        <ModelElementPreview
          {...selected}
          model={model}
          onClose={() => setSelectedId(null)}
          onDiscuss={onDiscuss}
        />
      )}
    </section>
  )
}
