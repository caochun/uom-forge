import { useEffect, useRef, useState } from 'react'
import type { CandidateDraft } from '../types.ts'
import type { ExpressionCase } from '../../shared/expression.ts'
import { EXPRESSION_STATUS } from '../../shared/expression.ts'

const labels = {
  expressed: '可以表达',
  defect: '模型待修正',
  uncertain: '业务尚未明确',
}
export default function ExpressionReview({
  candidate,
  onSelect,
  focusRequest = 0,
  stale = false,
}: {
  candidate: CandidateDraft
  focusRequest?: number
  stale?: boolean
  onSelect: (id: string) => void
}) {
  const review = candidate.expressionReview
  const [showPassed, setShowPassed] = useState(false)
  const details = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if (focusRequest && details.current) {
      details.current.open = true
      details.current.scrollIntoView({ block: 'nearest' })
    }
  }, [focusRequest])
  if (!review) return null
  const latest = review.snapshots[review.selectedSnapshot]
  const reverted = review.snapshots.length > 1 && review.selectedSnapshot === 0
  const check = latest?.check
  const cases = check?.cases || []
  const remaining = cases.filter((item) => item.status !== 'expressed')
  const names = new Map(
    [
      ...candidate.model.objects,
      ...candidate.model.relations,
      ...candidate.model.actions,
      ...candidate.model.functions,
      ...candidate.model.rules,
      ...candidate.model.activities,
    ].map((item) => [item.id, item.name]),
  )
  const card = (item: ExpressionCase, interactive = true) => (
    <article className={`expression-case ${item.status}`} key={item.id}>
      <div className="expression-case-title">
        <span>{labels[item.status]}</span>
        <strong>{item.fact}</strong>
      </div>
      <p>{item.scenario}</p>
      <p>{item.explanation}</p>
      {!!item.elements.length && (
        <div className="expression-elements">
          {item.elements.map((id) =>
            interactive &&
            names.has(id) &&
            !candidate.model.activities.some((item) => item.id === id) ? (
              <button
                type="button"
                className="text-button"
                key={id}
                onClick={() => onSelect(id)}
              >
                {names.get(id)}
              </button>
            ) : (
              <span key={id}>
                {names.get(id) ||
                  (id === 'boundaries'
                    ? '模型边界'
                    : id === 'summary'
                      ? '模型概述'
                      : id)}
              </span>
            ),
          )}
        </div>
      )}
      {item.gap && (
        <p>
          <strong>差异：</strong>
          {item.gap}
        </p>
      )}
      {item.suggestion && (
        <p>
          <strong>处理建议：</strong>
          {item.suggestion}
        </p>
      )}
      <details>
        <summary>业务依据</summary>
        <blockquote>{item.basis}</blockquote>
      </details>
    </article>
  )
  return (
    <details ref={details} className="expression-review panel-surface">
      <summary>
        <strong>业务表达检查</strong>
        <span>
          {stale || candidate.edited
            ? '以下检查对应先前版本，需要更新'
            : EXPRESSION_STATUS[review.status]}
        </span>
        {check && (
          <small>
            {cases.length - remaining.length}/{cases.length} 项可表达
          </small>
        )}
      </summary>
      <div className="expression-review-body">
        <p className="muted">
          检查模型能否表达业务说明中的具体事实。结论仅覆盖本轮用例，不代表已证明业务完整覆盖。
        </p>
        {check ? <p>{check.summary}</p> : <p>当前候选尚未完成有效检查。</p>}
        {review.warnings.map((warning, i) => (
          <p className="reading-note" key={i}>
            {warning}
          </p>
        ))}
        {!!review.changes.length && (
          <details>
            <summary>
              {reverted ? '未采用的修正尝试' : '本轮修正'} ·{' '}
              {review.changes.length} 项
            </summary>
            <ul>
              {review.changes.map((change) => (
                <li key={`${change.collection}:${change.id}`}>
                  <strong>{names.get(change.id) || change.id}</strong>：
                  {change.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
        {remaining.map((item) => card(item, !stale && !candidate.edited))}
        {cases.some((item) => item.status === 'expressed') && (
          <>
            <button
              type="button"
              className="text-button"
              onClick={() => setShowPassed(!showPassed)}
            >
              {showPassed ? '收起可表达用例' : '查看可表达用例'}
            </button>
            {showPassed &&
              cases
                .filter((item) => item.status === 'expressed')
                .map((item) => card(item, !stale && !candidate.edited))}
          </>
        )}
        {review.snapshots.length > 1 && (
          <details>
            <summary>
              {reverted ? '修正后的复查（存在回归，未采用）' : '修正前检查'}
            </summary>
            <p>{review.snapshots[reverted ? 1 : 0].check?.summary}</p>
            {review.snapshots[reverted ? 1 : 0].check?.cases.map((item) =>
              card(item, false),
            )}
          </details>
        )}
      </div>
    </details>
  )
}
