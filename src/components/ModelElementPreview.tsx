import { useEffect, useRef } from 'react'
import { MessageCircle, X } from 'lucide-react'
import type { CandidateModel } from '../../shared/model.ts'
import type {
  EditableCollection,
  EditableElement,
  OnDiscuss,
} from '../types.ts'
import Markdown from './Markdown.tsx'

export const ELEMENT_LABELS: Record<EditableCollection, string> = {
  objects: '对象',
  relations: '关系',
  actions: '业务操作',
  functions: '只读能力',
  rules: '规则',
}

export default function ModelElementPreview({
  element,
  kind,
  model,
  onClose,
  onDiscuss,
}: {
  element: EditableElement
  kind: EditableCollection
  model: CandidateModel
  onClose: () => void
  onDiscuss: OnDiscuss
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const node = dialog.current
    const trigger = document.activeElement
    node?.showModal()
    return () => {
      node?.close()
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus({ preventScroll: true })
    }
  }, [])
  const all = [
    ...model.objects,
    ...model.relations,
    ...model.actions,
    ...model.functions,
    ...model.rules,
  ]
  const name = (id: string) => all.find((item) => item.id === id)?.name || id
  const list = (title: string, items: string[]) =>
    items.length > 0 && (
      <section>
        <h4>{title}</h4>
        <ul>
          {items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      </section>
    )
  return (
    <dialog
      className="support-element-dialog"
      ref={dialog}
      aria-labelledby="support-element-title"
      onCancel={onClose}
      onClose={onClose}
    >
      <div className="panel-toolbar">
        <div>
          <span className="panel-subtitle">{ELEMENT_LABELS[kind]}</span>
          <h2 id="support-element-title">{element.name}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="关闭模型元素详情"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <div className="support-element-body">
        <Markdown>{element.description}</Markdown>
        {'from' in element && (
          <section>
            <h4>关系方向</h4>
            <p>
              {name(element.from)} → {element.name} → {name(element.to)}
            </p>
          </section>
        )}
        {'targets' in element && list('涉及对象', element.targets.map(name))}
        {'preconditions' in element && list('前提', element.preconditions)}
        {'effects' in element && list('产生的变化', element.effects)}
        {'output' in element && (
          <section>
            <h4>只读输出</h4>
            <Markdown>{element.output}</Markdown>
          </section>
        )}
        {'elements' in element && list('作用范围', element.elements.map(name))}
        {'properties' in element &&
          list(
            '属性',
            element.properties.map(
              (item) => `${item.name}（${item.type}）：${item.description}`,
            ),
          )}
        {'inputs' in element &&
          list(
            '输入',
            element.inputs.map(
              (item) => `${item.name}（${item.type}）：${item.description}`,
            ),
          )}
      </div>
      <div className="support-element-footer">
        <button
          className="secondary-button"
          onClick={() => {
            onClose()
            onDiscuss(element)
          }}
        >
          <MessageCircle size={14} />
          讨论此项
        </button>
        <button className="text-button" onClick={onClose}>
          返回业务情形检验
        </button>
      </div>
    </dialog>
  )
}
