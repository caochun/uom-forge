import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  Focus,
  Maximize2,
  Minus,
  MousePointer2,
  Plus,
  Scan,
  Tag,
  X,
} from 'lucide-react'
import type { KeyboardEvent } from 'react'
import type { CandidateModel } from '../../shared/model.ts'
import { layoutGraph } from '../graph-layout.ts'
import type { GraphLayout } from '../graph-layout.ts'

interface Camera {
  x: number
  y: number
  scale: number
}
const clampScale = (scale: number) => Math.max(0.12, Math.min(2, scale))

export default function ModelGraph({
  model,
  selectedId,
  onSelect,
}: {
  model: CandidateModel
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [layout, setLayout] = useState<GraphLayout | null>(null)
  const [layoutError, setLayoutError] = useState('')
  const [loading, setLoading] = useState(true)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [showLabels, setShowLabels] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [size, setSize] = useState({ width: 800, height: 560 })
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, scale: 1 })
  const [dragging, setDragging] = useState(false)
  const viewport = useRef<HTMLDivElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const expandButton = useRef<HTMLButtonElement>(null)
  const drag = useRef<{
    id: number
    x: number
    y: number
    camera: Camera
  } | null>(null)
  const marker = useId().replace(/:/g, '')
  const selectedObject = model.objects.find(
    (object) => object.id === selectedId,
  )
  const selectedRelation = model.relations.find(
    (relation) => relation.id === selectedId,
  )
  const focusedObject = model.objects.find((object) => object.id === focusId)
  const connected = useMemo(() => {
    const nodes = new Set<string>()
    const edges = new Set<string>()
    if (selectedObject) {
      nodes.add(selectedObject.id)
      model.relations
        .filter(
          (edge) =>
            edge.from === selectedObject.id || edge.to === selectedObject.id,
        )
        .forEach((edge) => {
          edges.add(edge.id)
          nodes.add(edge.from)
          nodes.add(edge.to)
        })
    } else if (selectedRelation) {
      edges.add(selectedRelation.id)
      nodes.add(selectedRelation.from)
      nodes.add(selectedRelation.to)
    }
    return { nodes, edges }
  }, [model.relations, selectedObject, selectedRelation])
  const visible = useMemo(() => {
    if (!focusedObject)
      return { objects: model.objects, relations: model.relations }
    const relations = model.relations.filter(
      (edge) => edge.from === focusedObject.id || edge.to === focusedObject.id,
    )
    const ids = new Set([
      focusedObject.id,
      ...relations.flatMap((edge) => [edge.from, edge.to]),
    ])
    return {
      objects: model.objects.filter((object) => ids.has(object.id)),
      relations,
    }
  }, [model.objects, model.relations, focusedObject])
  const routes = useMemo(() => {
    const grouped = new Map<
      string,
      { id: string; path: string; active: boolean }
    >()
    layout?.edges.forEach((edge) => {
      const existing = grouped.get(edge.path)
      grouped.set(edge.path, {
        id: existing?.id || edge.relation.id,
        path: edge.path,
        active: Boolean(
          existing?.active || connected.edges.has(edge.relation.id),
        ),
      })
    })
    return [...grouped.values()]
  }, [layout, connected])
  const selfGroups = useMemo(() => {
    const grouped = new Map<string, GraphLayout['edges']>()
    layout?.edges
      .filter((edge) => edge.relation.from === edge.relation.to)
      .forEach((edge) => {
        grouped.set(edge.relation.from, [
          ...(grouped.get(edge.relation.from) || []),
          edge,
        ])
      })
    return [...grouped.values()].filter((group) => group.length > 1)
  }, [layout])
  useEffect(() => {
    if (
      focusId &&
      selectedObject &&
      !visible.objects.some((object) => object.id === selectedObject.id)
    )
      setFocusId(null)
  }, [focusId, selectedObject, visible.objects])

  useEffect(() => {
    let current = true
    setLoading(true)
    setLayoutError('')
    layoutGraph(visible.objects, visible.relations)
      .then((result) => {
        if (current) {
          setLayout(result)
          setLoading(false)
        }
      })
      .catch(() => {
        if (current) {
          setLayout(null)
          setLoading(false)
          setLayoutError('关系图暂时无法排列，可通过下方对象列表继续查看。')
        }
      })
    return () => {
      current = false
    }
  }, [visible])

  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [expanded])

  const fittedCamera = useMemo(() => {
    if (!layout || !size.width || !size.height) return { x: 0, y: 0, scale: 1 }
    const scale = Math.min(
      1,
      (size.width - 48) / Math.max(1, layout.width),
      (size.height - 96) / Math.max(1, layout.height),
    )
    return {
      scale,
      x: (size.width - layout.width * scale) / 2,
      y: (size.height - layout.height * scale) / 2 - 12,
    }
  }, [layout, size])
  useEffect(() => {
    const first = layout?.nodes[0]
    if (first && size.width < 600 && fittedCamera.scale < 0.65) {
      // Start with readable cards on phones. Fit still offers a full overview.
      const scale = 0.65
      setCamera({
        scale,
        x: size.width / 2 - (first.x + first.width / 2) * scale,
        y: size.height / 2 - (first.y + first.height / 2) * scale,
      })
    } else setCamera(fittedCamera)
  }, [fittedCamera, layout, size])

  useEffect(() => {
    if (!expanded) return
    dialog.current?.showModal()
    return () => {
      expandButton.current?.focus()
    }
  }, [expanded])

  // Wheel zoom is anchored under the pointer; drag pans without moving objects.
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const bounds = element.getBoundingClientRect()
      const point = {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      }
      setCamera((current) => {
        const scale = clampScale(
          current.scale *
            Math.exp(-Math.max(-80, Math.min(80, event.deltaY)) * 0.008),
        )
        return {
          scale,
          x: point.x - ((point.x - current.x) * scale) / current.scale,
          y: point.y - ((point.y - current.y) * scale) / current.scale,
        }
      })
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [expanded])

  const zoom = (factor: number) =>
    setCamera((current) => {
      const scale = clampScale(current.scale * factor)
      return {
        scale,
        x:
          size.width / 2 -
          ((size.width / 2 - current.x) * scale) / current.scale,
        y:
          size.height / 2 -
          ((size.height / 2 - current.y) * scale) / current.scale,
      }
    })
  const activate = (event: KeyboardEvent, id: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(id)
    }
  }
  const highlighted = connected.nodes.size > 0
  const graph = (
    <div className="relationship-map">
      <div className="map-toolbar">
        <div className="map-caption">
          <span className="map-status-dot" />
          <strong>{focusedObject ? focusedObject.name : '关系总览'}</strong>
          <span>
            {visible.objects.length} 个对象 · {visible.relations.length} 条关系
          </span>
        </div>
        <div className="map-actions">
          <button
            className={showLabels ? 'active' : ''}
            aria-pressed={showLabels}
            onClick={() => setShowLabels(!showLabels)}
            title="显示关系名称"
          >
            <Tag size={14} />
            关系名称
          </button>
          <button
            aria-pressed={Boolean(focusedObject)}
            disabled={!selectedObject && !focusedObject}
            onClick={() =>
              setFocusId(focusedObject ? null : selectedObject?.id || null)
            }
            title={
              focusedObject ? '返回完整模型' : '只看选中对象及直接关联的对象'
            }
          >
            <Focus size={14} />
            {focusedObject ? '全部对象' : '只看相关'}
          </button>
          <button
            ref={expanded ? undefined : expandButton}
            aria-label={expanded ? '收起关系图' : '展开关系图'}
            title={expanded ? '收起关系图' : '展开关系图'}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <X size={15} /> : <Maximize2 size={15} />}
          </button>
        </div>
      </div>
      <div
        className={`graph-canvas ${dragging ? 'is-dragging' : ''}`}
        ref={viewport}
        aria-busy={loading}
        onPointerDown={(event) => {
          if (
            event.button !== 0 ||
            (event.target as Element).closest('[role="button"],button')
          )
            return
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            camera,
          }
          setDragging(true)
        }}
        onPointerMove={(event) => {
          const start = drag.current
          if (start?.id === event.pointerId)
            setCamera({
              ...start.camera,
              x: start.camera.x + event.clientX - start.x,
              y: start.camera.y + event.clientY - start.y,
            })
        }}
        onPointerUp={(event) => {
          if (drag.current?.id === event.pointerId) {
            drag.current = null
            setDragging(false)
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        }}
        onLostPointerCapture={() => {
          drag.current = null
          setDragging(false)
        }}
        onPointerCancel={() => {
          drag.current = null
          setDragging(false)
        }}
      >
        {loading ? (
          <div className="map-empty" role="status">
            <span className="typing-indicator">
              <i />
              <i />
              <i />
            </span>
            正在排列对象与关系…
          </div>
        ) : layoutError ? (
          <div className="map-empty" role="alert">
            {layoutError}
          </div>
        ) : !layout?.nodes.length ? (
          <div className="map-empty">
            补充对象后，在这里查看它们之间的业务联系。
          </div>
        ) : (
          <svg width="100%" height="100%" role="group" aria-label="对象关系图">
            <defs>
              <marker
                id={`${marker}-arrow`}
                viewBox="0 0 10 10"
                markerWidth="7"
                markerHeight="7"
                refX="9"
                refY="5"
                orient="auto-start-reverse"
              >
                <path
                  d="M 1 1 L 9 5 L 1 9"
                  fill="none"
                  stroke="#9aaabe"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </marker>
              <marker
                id={`${marker}-active`}
                viewBox="0 0 10 10"
                markerWidth="7"
                markerHeight="7"
                refX="9"
                refY="5"
                orient="auto-start-reverse"
              >
                <path
                  d="M 1 1 L 9 5 L 1 9"
                  fill="none"
                  stroke="#5476c5"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </marker>
            </defs>
            <g
              className="map-transform"
              transform={`translate(${camera.x} ${camera.y}) scale(${camera.scale})`}
            >
              {routes.map(({ id, path, active }) => (
                <path
                  key={id}
                  className={`map-connection ${active ? 'related' : ''} ${highlighted && !active ? 'dimmed' : ''}`}
                  d={path}
                  markerEnd={`url(#${marker}-${active ? 'active' : 'arrow'})`}
                />
              ))}
              {selfGroups.map((group) => {
                const first = group[0]!
                const last = group.at(-1)!
                const shown =
                  showLabels ||
                  group.some((edge) => connected.edges.has(edge.relation.id))
                return (
                  shown && (
                    <g
                      key={first.relation.from}
                      className={`map-self-group ${highlighted && !connected.nodes.has(first.relation.from) ? 'dimmed' : ''}`}
                    >
                      <rect
                        x={first.label.x - 4}
                        y={first.label.y - 30}
                        width={first.label.width + 8}
                        height={
                          last.label.y + last.label.height - first.label.y + 38
                        }
                        rx="10"
                      />
                      <text
                        x={first.label.x + first.label.width / 2}
                        y={first.label.y - 11}
                        textAnchor="middle"
                      >
                        同类对象间 · {group.length} 种关系
                      </text>
                    </g>
                  )
                )
              })}
              {layout.edges.map(({ relation, path, label }) => {
                const active = connected.edges.has(relation.id)
                return (
                  <g
                    key={relation.id}
                    className={`graph-edge ${selectedId === relation.id ? 'active' : ''} ${active ? 'related' : ''} ${highlighted && !active ? 'dimmed' : ''}`}
                    role="button"
                    aria-pressed={selectedId === relation.id}
                    aria-label={`${relation.name}：${model.objects.find((object) => object.id === relation.from)?.name}到${model.objects.find((object) => object.id === relation.to)?.name}`}
                    tabIndex={0}
                    onClick={() => onSelect(relation.id)}
                    onKeyDown={(event) => activate(event, relation.id)}
                  >
                    <title>
                      {relation.from === relation.to
                        ? '同类对象之间的关系。'
                        : ''}
                      {relation.name}：{relation.description}
                    </title>
                    {!selfGroups.some(
                      (group) =>
                        group[0]?.relation.from === relation.from &&
                        relation.from === relation.to,
                    ) && <path className="edge-hit" d={path} />}
                    <g
                      className={`map-edge-label ${showLabels || active ? '' : 'is-hidden'}`}
                      transform={`translate(${label.x} ${label.y})`}
                    >
                      <rect width={label.width} height={label.height} rx="6" />
                      <text textAnchor="middle">
                        {label.lines.map((line, index) => (
                          <tspan
                            key={index}
                            x={label.width / 2}
                            y={18 + index * 17}
                          >
                            {line}
                          </tspan>
                        ))}
                      </text>
                    </g>
                  </g>
                )
              })}
              {layout.nodes.map(
                ({ object, x, y, width, height, lines, connections }) => (
                  <g
                    key={object.id}
                    className={`graph-node ${selectedId === object.id ? 'active' : ''} ${connected.nodes.has(object.id) ? 'related' : ''} ${highlighted && !connected.nodes.has(object.id) ? 'dimmed' : ''}`}
                    transform={`translate(${x} ${y})`}
                    role="button"
                    aria-label={object.name}
                    aria-pressed={selectedId === object.id}
                    tabIndex={0}
                    onClick={() => onSelect(object.id)}
                    onKeyDown={(event) => activate(event, object.id)}
                  >
                    <title>
                      {object.name}：{object.description}
                    </title>
                    <rect
                      className="map-node-shadow"
                      width={width}
                      height={height}
                      y="3"
                      rx="12"
                    />
                    <rect
                      className="map-node-card"
                      width={width}
                      height={height}
                      rx="12"
                    />
                    <rect
                      className="map-node-icon"
                      x="16"
                      y="14"
                      width="22"
                      height="22"
                      rx="6"
                    />
                    <path
                      className="map-node-glyph"
                      d="M 27 19 L 33 22.5 L 33 29 L 27 32.5 L 21 29 L 21 22.5 Z M 21 22.5 L 27 26 L 33 22.5 M 27 26 L 27 32.5"
                    />
                    <text className="map-node-eyebrow" x="46" y="29">
                      业务对象
                    </text>
                    <text
                      className="map-node-count"
                      x={width - 16}
                      y="29"
                      textAnchor="end"
                    >
                      {connections} 条关系
                    </text>
                    <text className="map-node-name">
                      {lines.map((line, index) => (
                        <tspan key={index} x="16" y={58 + index * 21}>
                          {line}
                        </tspan>
                      ))}
                    </text>
                  </g>
                ),
              )}
            </g>
          </svg>
        )}
        {layout && layout.nodes.length > 0 && !loading && (
          <div className="map-navigation" aria-label="画布缩放">
            <button
              aria-label="缩小关系图"
              title="缩小"
              onClick={() => zoom(1 / 1.2)}
              disabled={camera.scale <= 0.12}
            >
              <Minus size={16} />
            </button>
            <span>{Math.round(camera.scale * 100)}%</span>
            <button
              aria-label="放大关系图"
              title="放大"
              onClick={() => zoom(1.2)}
              disabled={camera.scale >= 2}
            >
              <Plus size={16} />
            </button>
            <i />
            <button
              aria-label="适应画布"
              title="适应画布"
              onClick={() => setCamera(fittedCamera)}
            >
              <Scan size={17} />
            </button>
          </div>
        )}
      </div>
      <div className="map-footer">
        <span>
          <MousePointer2 size={13} />
          点击查看 · 拖动画布 · 滚轮缩放
        </span>
        <span>
          <i />
          箭头表示关系方向
        </span>
      </div>
      {expanded && selectedId && (
        <div className="map-selected-summary">
          <strong>{selectedObject?.name || selectedRelation?.name}</strong>
          <p>{selectedObject?.description || selectedRelation?.description}</p>
        </div>
      )}
    </div>
  )
  return expanded ? (
    <>
      <div className="map-expanded-placeholder">关系图已展开</div>
      <dialog
        className="map-dialog"
        ref={dialog}
        aria-label="展开的对象关系图"
        onCancel={() => setExpanded(false)}
        onClose={() => setExpanded(false)}
      >
        {graph}
      </dialog>
    </>
  ) : (
    graph
  )
}
