import { useEffect, useId, useState } from 'react'
import {
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleDashed,
  MessageCircle,
  Plus,
} from 'lucide-react'
import type {
  Assessment,
  RequirementAssessment,
  SupportStatus,
} from '../../shared/analysis.ts'
import type { CandidateModel, Evidence } from '../../shared/model.ts'
import { EDITABLE_COLLECTIONS } from '../types.ts'
import type { OnDiscuss } from '../types.ts'
import Markdown from './Markdown.tsx'
import ModelElementPreview, { ELEMENT_LABELS } from './ModelElementPreview.tsx'
import StructuredStream from './StructuredStream.tsx'

const STATUS = {
  supported: { label: '可支撑', icon: CheckCircle2 },
  partial: { label: '部分支撑', icon: CircleAlert },
  missing: { label: '存在缺口', icon: CircleDashed },
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

function EvidenceQuotes({ evidence }: { evidence: Evidence[] }) {
  if (!evidence.length) return null
  return (
    <details className="support-evidence">
      <summary>原文依据 · {evidence.length}</summary>
      {evidence.map((item, index) => (
        <blockquote key={index}>
          {item.quote}
        </blockquote>
      ))}
    </details>
  )
}

function feedbackFor(process: string, row: RequirementAssessment) {
  return `【${process}】${row.requirement}\n缺口：${row.gap}\n建议：${row.suggestion}`
}

export default function BusinessProcessSupport({
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
  const rows = assessment?.processAssessments || []
  const firstIssue =
    rows.find((row) => row.status !== 'supported')?.processId ||
    rows[0]?.processId
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
          title="业务情形检验"
          text={stream.text}
          reasoning={stream.reasoning}
          active={running}
          complete={!running && !!stream.text}
        />}
        <div className="empty-state panel-surface">
          {running
            ? '正在逐项检查业务要求与模型表达…'
            : '还没有业务情形检验。生成候选模型后，可以开始检验。'}
        </div>
      </>
    )
  return (
    <section
      className="business-process-support"
      aria-label="业务情形检验结果"
    >
      <article className="support-overview panel-surface">
        <div className="panel-toolbar">
          <div>
            <h2>业务情形检验</h2>
            <p className="panel-subtitle">
              已知业务计划需要什么 · 模型如何表达或推理 · 还需要补齐什么
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
          {(['all', 'supported', 'partial', 'missing'] as const).map(
            (value) => (
              <button
                key={value}
                className={`support-filter ${value}`}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                <span>
                  {value === 'all' ? '全部业务计划' : STATUS[value].label}
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
        title="业务情形检验"
        text={stream.text}
        reasoning={stream.reasoning}
        active={running}
        complete={!running && !!stream.text}
      />}
      {rows.some((row) => !row.requirements.length) && (
        <p className="notice" role="status">
          这份检验含有旧版结果，尚未记录逐项依据。请重新运行“业务情形检验”生成新的对照明细。
        </p>
      )}
      <div className="support-process-list">
        {visible.map((row) => {
          const open = expanded[row.processId] ?? row.processId === firstIssue
          const id = `${prefix}-${row.processId}`
          return (
            <article
              className="support-process panel-surface"
              key={row.processId}
            >
              <h3 className="support-process-heading">
                <button
                  className="support-process-toggle"
                  aria-expanded={open}
                  aria-controls={id}
                  onClick={() =>
                    setExpanded((current) => ({
                      ...current,
                      [row.processId]: !open,
                    }))
                  }
                >
                  <div className="support-process-heading-text">
                    <strong>{row.processName}</strong>
                    <span>{row.reason || '旧版评估未记录判断依据。'}</span>
                  </div>
                  <Status value={row.status} />
                  <ChevronDown size={17} className={open ? 'expanded' : ''} />
                </button>
              </h3>
              {open && (
                <div id={id} className="support-process-detail">
                  {row.requirements.length ? (
                    <>
                      <p className="support-process-caption">
                        {row.requirements.length} 项业务要求 ·
                        点击模型元素可查看其定义
                      </p>
                      <div className="support-requirements">
                        {row.requirements.map((requirement, index) => (
                          <article
                            className="support-requirement"
                            key={index}
                            aria-label={requirement.requirement}
                          >
                            <section className="support-need">
                              <h4>
                                <span>
                                  {String(index + 1).padStart(2, '0')}
                                </span>
                                业务要求
                              </h4>
                              <Markdown>{requirement.requirement}</Markdown>
                              <Status value={requirement.status} />
                              <EvidenceQuotes evidence={requirement.evidence} />
                            </section>
                            <section className="support-expression">
                              <h4>模型如何表达 · 判断依据</h4>
                              <Markdown>{requirement.explanation}</Markdown>
                              <div className="support-element-chips">
                                {requirement.elements.map((id) => {
                                  const match = elements.find(
                                    (item) => item.element.id === id,
                                  )
                                  return (
                                    <button
                                      key={id}
                                      disabled={!match}
                                      onClick={() => setSelectedId(id)}
                                    >
                                      {match && (
                                        <span>
                                          {ELEMENT_LABELS[match.kind]}
                                        </span>
                                      )}
                                      {match?.element.name ||
                                        `${id}（当前模型中不存在）`}
                                    </button>
                                  )
                                })}
                              </div>
                            </section>
                            <section
                              className={`support-gap ${requirement.status}`}
                            >
                              <h4>缺口与改进</h4>
                              {requirement.status === 'supported' ? (
                                <p className="support-complete">
                                  <Check size={14} />
                                  此项未发现语义缺口
                                </p>
                              ) : (
                                <>
                                  <Markdown>{requirement.gap}</Markdown>
                                  <div className="support-suggestion">
                                    <h5>建议调整</h5>
                                    <Markdown>
                                      {requirement.suggestion}
                                    </Markdown>
                                  </div>
                                  <div className="support-gap-actions">
                                    <button
                                      className="text-button"
                                      onClick={() =>
                                        onDiscuss({
                                          name: `${row.processName} · ${requirement.requirement}`,
                                          description: `${requirement.explanation}\n${feedbackFor(row.processName, requirement)}`,
                                        })
                                      }
                                    >
                                      <MessageCircle size={13} />
                                      讨论此缺口
                                    </button>
                                    {addButton(
                                      feedbackFor(row.processName, requirement),
                                    )}
                                  </div>
                                </>
                              )}
                            </section>
                          </article>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="support-note">
                      原有结论已保留，重新评估后才能查看业务要求与模型的逐项对应关系。
                    </p>
                  )}
                  <div className="support-process-footer">
                    <EvidenceQuotes evidence={row.evidence} />
                    <button
                      className="text-button"
                      onClick={() =>
                        onDiscuss({
                          name: row.processName,
                          description: `${row.reason}\n${row.requirements.map((item) => `${item.requirement}：${item.explanation}${item.gap ? `\n${feedbackFor(row.processName, item)}` : ''}`).join('\n\n')}`,
                        })
                      }
                    >
                      <MessageCircle size={14} />
                      讨论此业务计划
                    </button>
                  </div>
                </div>
              )}
            </article>
          )
        })}
        {!visible.length && (
          <p className="empty-state panel-surface">
            {rows.length
              ? '没有符合此状态的业务计划。'
              : '本次检验未列出可评估的业务计划。'}
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
                <h3>跨过程的共性建议</h3>
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
                项业务澄清，已汇入业务理解页的确认表单，可通过页面上方入口查看依据与影响。普通模型缺口仍在对应要求下处理。
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
