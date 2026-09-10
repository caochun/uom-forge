import type { BusinessObject, Relation } from '../shared/model.ts'
import type { ELK as ElkEngine, ElkNode, ElkPoint } from 'elkjs/lib/elk-api.js'

export interface GraphNode {
  object: BusinessObject
  x: number
  y: number
  width: number
  height: number
  lines: string[]
  connections: number
}
export interface GraphEdge {
  relation: Relation
  path: string
  label: {
    x: number
    y: number
    width: number
    height: number
    lines: string[]
  }
}
export interface GraphLayout {
  width: number
  height: number
  nodes: GraphNode[]
  edges: GraphEdge[]
}

function textUnits(text: string): number {
  return Array.from(text).reduce(
    (size, char) => size + (/[^\x00-\x7f]/u.test(char) ? 1 : 0.56),
    0,
  )
}

function wrapText(text: string, maxUnits: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const char of text) {
    if (line && (char === '\n' || textUnits(line + char) > maxUnits)) {
      lines.push(line)
      line = ''
    }
    if (char !== '\n') line += char
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

// Round routed corners without changing the route or passing through nodes.
export function roundedPath(points: ElkPoint[]): string {
  const start = points[0]
  if (!start) return ''
  let path = `M ${start.x} ${start.y}`
  for (let index = 1; index < points.length - 1; index++) {
    const previous = points[index - 1]!
    const corner = points[index]!
    const next = points[index + 1]!
    const incoming = Math.hypot(corner.x - previous.x, corner.y - previous.y)
    const outgoing = Math.hypot(next.x - corner.x, next.y - corner.y)
    if (!incoming || !outgoing) continue
    const radius = Math.min(12, incoming / 2, outgoing / 2)
    const before = {
      x: corner.x + ((previous.x - corner.x) * radius) / incoming,
      y: corner.y + ((previous.y - corner.y) * radius) / incoming,
    }
    const after = {
      x: corner.x + ((next.x - corner.x) * radius) / outgoing,
      y: corner.y + ((next.y - corner.y) * radius) / outgoing,
    }
    path += ` L ${before.x} ${before.y} Q ${corner.x} ${corner.y} ${after.x} ${after.y}`
  }
  const end = points.at(-1)!
  return `${path} L ${end.x} ${end.y}`
}

export async function layoutGraph(
  objects: BusinessObject[],
  relations: Relation[],
): Promise<GraphLayout> {
  if (!objects.length) return { width: 0, height: 0, nodes: [], edges: [] }
  // Keep the layout engine out of the initial document/reading bundle.
  // The CommonJS bundle is callable at runtime; its default-export declaration
  // differs between NodeNext and Bundler resolution.
  const imported: unknown = (await import('elkjs/lib/elk.bundled.js')).default
  if (typeof imported !== 'function') throw new Error('无法加载关系图布局引擎')
  const ELK = imported as new () => ElkEngine
  const ids = new Set(objects.map((object) => object.id))
  const edges = relations.filter(
    (relation) => ids.has(relation.from) && ids.has(relation.to),
  )
  const nodes = objects.map((object) => {
    const lines = wrapText(object.name, 11)
    return {
      object,
      lines,
      width: 208,
      height: 62 + lines.length * 21,
      connections: edges.filter(
        (edge) => edge.from === object.id || edge.to === object.id,
      ).length,
    }
  })
  const edgeLabels = edges.map((relation) => {
    const lines = wrapText(relation.name, 9)
    return {
      lines,
      width: Math.max(44, ...lines.map((line) => textUnits(line) * 12 + 20)),
      height: lines.length * 17 + 10,
    }
  })
  // Relations between instances of the same object type share one loop, while
  // each relationship keeps its own label, identity and selectable target.
  const routes: number[][] = []
  edges.forEach((relation, index) => {
    const existing =
      relation.from === relation.to &&
      routes.find((route) => {
        const first = edges[route[0]!]!
        return first.from === relation.from && first.to === relation.to
      })
    if (existing) existing.push(index)
    else routes.push([index])
  })
  const graph: ElkNode = {
    id: 'model-graph',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.padding': '[top=36,left=36,bottom=36,right=36]',
      'elk.spacing.nodeNode': '42',
      'elk.spacing.edgeNode': '24',
      'elk.spacing.edgeEdge': '20',
      'elk.layered.spacing.nodeNodeBetweenLayers': '72',
      'elk.layered.spacing.edgeNodeBetweenLayers': '24',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '18',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.mergeEdges': 'false',
      'elk.separateConnectedComponents': 'true',
    },
    children: nodes.map((node, index) => ({
      id: `n${index}`,
      width: node.width,
      height: node.height,
    })),
    edges: routes.map((route, index) => {
      const relation = edges[route[0]!]!
      return {
        id: `e${index}`,
        sources: [
          `n${objects.findIndex((object) => object.id === relation.from)}`,
        ],
        targets: [
          `n${objects.findIndex((object) => object.id === relation.to)}`,
        ],
        labels: [
          {
            id: `label${index}`,
            text: relation.name,
            width: Math.max(
              route.length > 1 ? 148 : 0,
              ...route.map((edge) => edgeLabels[edge]!.width),
            ),
            height: route.reduce(
              (total, edge) => total + edgeLabels[edge]!.height,
              route.length > 1 ? 30 : 0,
            ),
            layoutOptions: { 'elk.edgeLabels.placement': 'CENTER' },
          },
        ],
      }
    }),
  }
  // The bundled engine schedules locally; no dedicated Worker is created.
  const result = await new ELK().layout(graph)
  return {
    width: result.width || 1,
    height: result.height || 1,
    nodes: nodes.map((node, index) => {
      const positioned = result.children?.find(
        (child) => child.id === `n${index}`,
      )
      return { ...node, x: positioned?.x || 0, y: positioned?.y || 0 }
    }),
    edges: routes.flatMap((route, index) => {
      const routed = result.edges?.find((edge) => edge.id === `e${index}`)
      const label = routed?.labels?.[0]
      let y = (label?.y || 0) + (route.length > 1 ? 30 : 0)
      return route.map((edge) => {
        const row = {
          relation: edges[edge]!,
          path: (routed?.sections || [])
            .map((section) =>
              roundedPath([
                section.startPoint,
                ...(section.bendPoints || []),
                section.endPoint,
              ]),
            )
            .join(' '),
          label: {
            ...edgeLabels[edge]!,
            width: label?.width || edgeLabels[edge]!.width,
            x: label?.x || 0,
            y,
          },
        }
        y += edgeLabels[edge]!.height
        return row
      })
    }),
  }
}
