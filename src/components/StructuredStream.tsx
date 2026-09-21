import { useEffect, useRef, useState } from 'react'
import ReasoningStream from './ReasoningStream.tsx'

/**
 * Shows a machine-readable stage while it is being produced. The partial
 * payload is deliberately kept in a collapsible panel: it is useful for
 * diagnosing a slow or interrupted run, but it is not presented as a valid
 * result until the server has validated the final response.
 */
export default function StructuredStream({
  title,
  text,
  reasoning,
  active,
  complete,
}: {
  title: string
  text: string
  reasoning: string
  active: boolean
  complete: boolean
}) {
  const [open, setOpen] = useState(active)
  const body = useRef<HTMLPreElement>(null)
  const follow = useRef(true)

  useEffect(() => setOpen(active), [active])
  useEffect(() => {
    if (open && follow.current && body.current)
      body.current.scrollTop = body.current.scrollHeight
  }, [text, open])

  if (!text && !reasoning && !active) return null
  return (
    <details className="compilation-stream panel-surface" open={open}
      onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>
        <strong>{active ? title : complete ? `${title} · 已完成` : `${title} · 已保留部分输出`}</strong>
        <span>{text.length.toLocaleString()} 字符</span>
      </summary>
      {!!reasoning && <ReasoningStream text={reasoning} active={active && !text} complete={complete || !!text} />}
      {text ? <pre ref={body} className="compilation-json" role="region" aria-label={`${title}实时输出`} tabIndex={0}
        onScroll={event => {
          const element = event.currentTarget
          follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 32
        }}>{text}</pre> : <p className="reading-note" role="status">
        {active ? '等待模型正文，思考内容会实时显示。' : '本次尚未收到模型正文。'}
      </p>}
    </details>
  )
}
