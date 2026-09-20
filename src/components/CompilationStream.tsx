import { useEffect, useRef, useState } from 'react'
import type { CompilationOutput } from '../types.ts'
import ReasoningStream from './ReasoningStream.tsx'

export default function CompilationStream({ output, active }: {
  output: CompilationOutput
  active: boolean
}) {
  const [open, setOpen] = useState(output.status !== 'completed')
  const body = useRef<HTMLPreElement>(null)
  const follow = useRef(true)
  useEffect(() => setOpen(output.status !== 'completed'), [output.status, output.attempt])
  useEffect(() => { follow.current = true }, [output.attempt])
  useEffect(() => {
    if (open && follow.current && body.current) body.current.scrollTop = body.current.scrollHeight
  }, [output.text, open])
  const title = active
    ? output.attempt > 1 ? '正在修复模型 JSON 的结构与引用' : '正在生成模型 JSON'
    : output.status === 'completed' ? '模型生成记录 · 结构和引用检查通过' : '模型生成未完成 · 已保留部分输出'
  return (
    <details className="compilation-stream panel-surface" open={open}
      onToggle={event => setOpen(event.currentTarget.open)}>
      <summary><strong>{title}</strong><span>第 {output.attempt} 次输出 · {output.text.length.toLocaleString()} 字符</span></summary>
      <p className="reading-note">将已完成的模型设计转换为可展示的结构。完整输出通过结构校验后更新模型视图；设计的业务表达检查见“模型设计”。</p>
      {!!output.reasoning && <ReasoningStream key={output.attempt} text={output.reasoning}
        active={active && !output.text} complete={output.status === 'completed' || !!output.text} />}
      {output.text ? <pre ref={body} className="compilation-json" role="region" aria-label="模型 JSON 实时输出" tabIndex={0}
        onScroll={event => {
          const element = event.currentTarget
          follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 32
        }}>{output.text}</pre> : <p className="reading-note" role="status">
        {active ? '等待模型正文，思考内容会实时显示。' : '本次尚未收到模型正文。'}
      </p>}
    </details>
  )
}
