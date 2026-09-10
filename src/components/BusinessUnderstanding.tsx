import { Check, CircleAlert } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type {
  QuestionAnswer,
  QuestionAnswers,
  ReviewedUnderstanding,
} from '../types.ts'
import { withoutQuestionSection } from '../../shared/questions.ts'
import { answerText, sameAnswer } from '../understanding.ts'

interface Props {
  understanding: ReviewedUnderstanding | null
  stream: { narrative: string; complete: boolean; part: string }
  questionAnswers: QuestionAnswers
  onQuestionAnswerChange: (index: number, answer: QuestionAnswer) => void
  onSubmitAnswers: () => void
  questionsSubmitted: boolean
  isSubmitting: boolean
  isLive: boolean
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
}: Props) {
  const narrative = stream.narrative || understanding?.narrative || ''
  const questions =
    isLive || stream.narrative ? [] : understanding?.source.questions || []
  const confirmedAnswers = understanding?.confirmedAnswers || {}
  const confirmedCount = Object.keys(confirmedAnswers).length
  const status = isLive
    ? '正在阅读与解释'
    : narrative && !stream.complete && !understanding?.narrative
      ? '说明尚未完成'
      : confirmedCount
        ? '已补充确认说明'
        : '当前业务说明'
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
                  ? withoutQuestionSection(narrative)
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
              这份说明是后续建模的业务依据。保存问题答案会更新正文；已确认语义需要进入候选模型，再由模型自述和业务过程支撑检验。
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
        <div className="questions-panel panel-surface" id="business-questions">
          <div className="questions-panel-heading">
            <div className="questions-heading-icon">
              <CircleAlert size={15} />
            </div>
            <div>
              <strong>问题确认</strong>
              <p>
                可以只回答部分问题。保存后并入业务说明，未回答的问题继续保留。
              </p>
            </div>
            <span
              className={
                questionsSubmitted
                  ? 'question-status submitted'
                  : 'question-status'
              }
            >
              {confirmedCount} 已确认 · {questions.length - confirmedCount}{' '}
              待确认
            </span>
          </div>
          <div className="question-form">
            {questions.map((question, index) => (
              <div className="question-row" key={`${question.text}-${index}`}>
                <span>{index + 1}</span>
                <div>
                  <strong>{question.text}</strong>
                  <small className="question-answer-state">
                    {!sameAnswer(
                      questionAnswers[index],
                      confirmedAnswers[index],
                    )
                      ? '修改尚未保存'
                      : answerText(confirmedAnswers[index])
                        ? '已并入业务说明'
                        : '待确认'}
                  </small>
                  {question.clarification && (
                    <div className="question-context">
                      <span className="stage-badge">
                        {question.clarification.source === 'model'
                          ? '建模发现'
                          : '评估发现'}
                      </span>
                      <dl>
                        <dt>依据</dt>
                        <dd>{question.clarification.basis}</dd>
                        <dt>歧义</dt>
                        <dd>{question.clarification.ambiguity}</dd>
                        <dt>对模型的影响</dt>
                        <dd>{question.clarification.impact}</dd>
                      </dl>
                    </div>
                  )}
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
                      aria-label={question.text}
                      value={questionAnswers?.[index] || ''}
                      onChange={(event) =>
                        onQuestionAnswerChange(index, event.target.value)
                      }
                      placeholder="填写你的确认或补充"
                      disabled={isSubmitting}
                    />
                  )}
                  {answerText(questionAnswers[index]) && (
                    <button
                      type="button"
                      className="text-button question-clear"
                      disabled={isSubmitting}
                      onClick={() =>
                        onQuestionAnswerChange(
                          index,
                          question.multiple ? [] : '',
                        )
                      }
                    >
                      清除答案
                    </button>
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
              / {questions.length} · 保存后更新业务说明
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
    </section>
  )
}
