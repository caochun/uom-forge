import { Check, CircleAlert } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ReactNode } from 'react'
import type { Understanding } from '../../shared/analysis.ts'
import type { QuestionAnswer, QuestionAnswers } from '../types.ts'

interface Props {
  understanding: Understanding | null
  stream: { narrative: string; complete: boolean; part: string }
  questionAnswers: QuestionAnswers
  onQuestionAnswerChange: (index: number, answer: QuestionAnswer) => void
  onSubmitAnswers: () => void
  questionsSubmitted: boolean
  isSubmitting: boolean
  isLive: boolean
  outputRecord: ReactNode
}

export default function BusinessUnderstanding({
  understanding,
  stream,
  questionAnswers,
  onQuestionAnswerChange,
  onSubmitAnswers,
  questionsSubmitted,
  isSubmitting,
  isLive,
  outputRecord,
}: Props) {
  const narrative = stream.narrative || understanding?.narrative || ''
  const questions = (
    isLive || stream.narrative ? [] : understanding?.questions || []
  ).map((question) =>
    typeof question === 'string' ? { text: question, options: [] } : question,
  )
  const status = isLive
    ? '正在阅读与解释'
    : narrative && !stream.complete && !understanding?.narrative
      ? '说明尚未完成'
      : '业务说明原文'
  return (
    <section className="understanding-view">
      {(narrative || isLive) && (
        <article className="reading-narrative panel-surface">
          <div className="panel-toolbar">
            <div>
              <h2 className="panel-title">业务说明</h2>
              <div className="panel-subtitle">先读懂业务，再讨论如何建模</div>
            </div>
            <span className="stage-badge">{status}</span>
          </div>
          <div className="narrative-body">
            {narrative ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {questions.length
                  ? narrative.replace(/^##\s+待确认问题[\s\S]*$/m, '')
                  : narrative}
              </ReactMarkdown>
            ) : (
              <p className="narrative-placeholder">
                正在阅读材料，业务说明将在这里逐步显示……
              </p>
            )}
            {isLive && (
              <span className="typing-indicator" aria-label={status}>
                <i />
                <i />
                <i />
              </span>
            )}
          </div>
          {!isLive && narrative && (
            <p className="reading-note">
              这份说明是后续建模的唯一业务理解依据。待确认问题会在下方单独列出。
            </p>
          )}
        </article>
      )}
      {!narrative && !isLive && !understanding && (
        <div className="empty-state panel-surface">
          上传业务文档后开始分析，这里会先展示对业务的完整说明。
        </div>
      )}
      {understanding && understanding.warnings.length > 0 && (
        <div className="panel-surface">
          <div className="narrative-body">
            <p>业务说明章节检查</p>
            <ul>
              {understanding.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {questions.length > 0 && (
        <div className="questions-panel panel-surface">
          <div className="questions-panel-heading">
            <div className="questions-heading-icon">
              <CircleAlert size={15} />
            </div>
            <div>
              <strong>待确认问题</strong>
              <p>补充这些信息后，将带入候选模型阶段。</p>
            </div>
            <span
              className={
                questionsSubmitted
                  ? 'question-status submitted'
                  : 'question-status'
              }
            >
              {questionsSubmitted ? '已提交' : `${questions.length} 项`}
            </span>
          </div>
          <div className="question-form">
            {questions.map((question, index) => (
              <div className="question-row" key={`${question.text}-${index}`}>
                <span>{index + 1}</span>
                <div>
                  <strong>{question.text}</strong>
                  {question.options?.length > 0 ? (
                    <div className="question-options">
                      {question.options.map((option) => (
                        <label key={option}>
                          <input
                            type={question.multiple ? 'checkbox' : 'radio'}
                            name={`question-${index}`}
                            value={option}
                            checked={
                              question.multiple
                                ? (questionAnswers?.[index] || []).includes(
                                    option,
                                  )
                                : questionAnswers?.[index] === option
                            }
                            onChange={(event) => {
                              const values = Array.isArray(
                                questionAnswers?.[index],
                              )
                                ? questionAnswers[index]
                                : []
                              onQuestionAnswerChange(
                                index,
                                question.multiple
                                  ? event.target.checked
                                    ? [...values, option]
                                    : values.filter((value) => value !== option)
                                  : option,
                              )
                            }}
                            disabled={isSubmitting}
                          />
                          {option}
                        </label>
                      ))}
                    </div>
                  ) : (
                    <textarea
                      rows={2}
                      value={questionAnswers?.[index] || ''}
                      onChange={(event) =>
                        onQuestionAnswerChange(index, event.target.value)
                      }
                      placeholder="填写你的确认或补充"
                      disabled={isSubmitting}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="question-actions">
            <small>
              已填写{' '}
              {
                questions.filter((_, index) =>
                  String(questionAnswers?.[index] || '').trim(),
                ).length
              }{' '}
              / {questions.length} · 开始建模时采用当前答案
            </small>
            <button
              className="secondary-button"
              type="button"
              onClick={onSubmitAnswers}
              disabled={isSubmitting || questionsSubmitted}
            >
              <Check size={14} />
              {questionsSubmitted ? '补充信息已保存' : '保存补充信息'}
            </button>
          </div>
        </div>
      )}
      {outputRecord}
    </section>
  )
}
