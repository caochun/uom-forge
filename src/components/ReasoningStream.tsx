import { useEffect, useRef, useState } from 'react'

export default function ReasoningStream({ text, active, complete }: {
  text: string
  active: boolean
  complete: boolean
}) {
  const [expanded, setExpanded] = useState(active)
  const bodyRef = useRef<HTMLDivElement>(null)
  const follow = useRef(true)

  // Collapse once body generation starts; users may still reopen it.
  useEffect(() => setExpanded(active), [active])
  useEffect(() => {
    const body = bodyRef.current
    if (expanded && follow.current && body) body.scrollTop = body.scrollHeight
  }, [text, expanded])

  return (
    <details className="reading-reasoning" open={expanded}
      onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary>
        思考过程
        <span>{active ? '实时输出中' : complete ? '已结束' : '本次输出已保留'}</span>
        <small>{text.length.toLocaleString()} 字符</small>
      </summary>
      <div className="reasoning-stream" ref={bodyRef} role="region" aria-label="模型思考过程" tabIndex={0}
        onScroll={event => {
          const body = event.currentTarget
          follow.current = body.scrollHeight - body.scrollTop - body.clientHeight < 32
        }}>
        {text}
      </div>
    </details>
  )
}
