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
import { stripSourceMarkers } from '../../shared/understanding-sources.ts'
import { SourceCatalogue } from './SourceReferences.tsx'
import ReasoningStream from './ReasoningStream.tsx'

interface Props {
  understanding: ReviewedUnderstanding | null
  stream: { narrative: string; reasoning: string; complete: boolean }
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
  const narrative = stripSourceMarkers(stream.narrative || (isLive ? '' : understanding?.narrative) || '')
    .replace(/\[\[source:[^\]\r\n]*$/, '')
  const questions =
    isLive || stream.narrative ? [] : understanding?.source.questions || []
  const confirmedAnswers = understanding?.confirmedAnswers || {}
  const confirmedCount = Object.keys(confirmedAnswers).length
  const status = isLive
    ? stream.narrative ? '正在生成整理稿' : stream.reasoning ? '正在思考' : '正在阅读文档'
    : !stream.complete && (stream.narrative || (!understanding && stream.reasoning))
      ? '整理稿尚未完成'
      : confirmedCount
        ? '已补充确认说明'
        : '当前整理稿'
  return (
    <section className="understanding-view">
      {(narrative || stream.reasoning || isLive) && (
        <article className="reading-narrative panel-surface">
          <div className="panel-toolbar">
            <div>
              <h2 className="panel-title">业务文档整理稿</h2>
              <div className="panel-subtitle">整理文档，发现表述问题；事实、已知业务计划、规则和检验情形在“建模依据”中提炼。</div>
            </div>
            <span className="stage-badge">{status}</span>
          </div>
          {stream.reasoning && (
            <ReasoningStream text={stream.reasoning} active={isLive && !stream.complete && !stream.narrative} complete={stream.complete} />
          )}
          <div className="narrative-body">
            {narrative ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {questions.length
                  ? withoutQuestionSection(narrative)
                  : narrative}
              </ReactMarkdown>
            ) : (
              <p className="narrative-placeholder">
                {isLive
                  ? '文档整理稿生成后将在这里逐步显示……'
                  : '本次整理稿尚未生成，已保留收到的思考过程。'}
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
              请结合原文审阅整理稿和文档问题。保存问题答案会更新整理稿；开始建模后，将据此提炼建模依据，再设计并检查模型。
            </p>
          )}
          {!isLive && !stream.narrative && understanding && <SourceCatalogue sources={understanding.sources} />}
        </article>
      )}
      {!narrative && !stream.reasoning && !isLive && !understanding && (
        <div className="empty-state panel-surface">
          上传业务文档后开始理解，这里会展示文档整理稿及表述不清、前后矛盾等问题。
        </div>
      )}
      {understanding && understanding.warnings.length > 0 && (
        <div className="panel-surface">
          <div className="narrative-body">
            <p>整理稿提示</p>
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
                可以只回答部分问题。保存后并入整理稿，未回答的问题继续保留，并传给建模依据和模型设计。
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
                        ? '已并入整理稿'
                        : '待确认'}
                  </small>
                  {question.clarification && (
                    <div className="question-context">
                      <span className="stage-badge">
                        建模发现
                      </span>
                      <dl>
                        <dt>{question.clarification.basisSource === 'business-basis' ? '建模依据中的引文（提炼内容）' : '依据'}</dt>
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
              / {questions.length} · 保存后更新整理稿
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
