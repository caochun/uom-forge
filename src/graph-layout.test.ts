import test from 'node:test'
import assert from 'node:assert/strict'
import { layoutGraph } from './graph-layout.ts'
import type { BusinessObject, Relation } from '../shared/model.ts'

const object = (id: string, name = id): BusinessObject => ({
  id,
  name,
  description: id,
  properties: [],
  evidence: [],
})
const edge = (id: string, from: string, to: string): Relation => ({
  id,
  from,
  to,
  name: id,
  description: id,
  properties: [],
  evidence: [],
})

test('layout retains parallel, reverse and same-type relations with distinct labels and disconnected objects', async () => {
  const objects = [
    object('a'),
    object('b'),
    object('c', '这是一个需要完整展示而不能截断的较长业务对象名称'),
  ]
  const relations = [
    edge('ab', 'a', 'b'),
    edge('ab2', 'a', 'b'),
    edge('ba', 'b', 'a'),
    edge('aa', 'a', 'a'),
    edge('aa2', 'a', 'a'),
  ]
  const layout = await layoutGraph(objects, relations)
  assert.deepEqual(
    new Set(layout.nodes.map((node) => node.object.id)),
    new Set(['a', 'b', 'c']),
  )
  assert.deepEqual(
    new Set(layout.edges.map((item) => item.relation.id)),
    new Set(relations.map((item) => item.id)),
  )
  assert.equal(layout.nodes[2]!.lines.join(''), objects[2]!.name)
  for (const node of layout.nodes) {
    assert.ok(node.x >= 0 && node.y >= 0)
    assert.ok(
      node.x + node.width <= layout.width &&
        node.y + node.height <= layout.height,
    )
    for (const other of layout.nodes.filter((other) => other !== node)) {
      assert.ok(
        node.x + node.width <= other.x ||
          other.x + other.width <= node.x ||
          node.y + node.height <= other.y ||
          other.y + other.height <= node.y,
      )
    }
  }
  for (const item of layout.edges) {
    assert.ok(item.path.startsWith('M '))
    assert.doesNotMatch(item.path, /NaN|Infinity/)
    for (const node of layout.nodes) {
      const label = item.label
      assert.ok(
        label.x + label.width <= node.x ||
          node.x + node.width <= label.x ||
          label.y + label.height <= node.y ||
          node.y + node.height <= label.y,
      )
    }
  }
  const loops = layout.edges.filter(
    (item) => item.relation.from === item.relation.to,
  )
  assert.equal(loops[0]!.path, loops[1]!.path)
  assert.notDeepEqual(loops[0]!.label, loops[1]!.label)
  assert.notEqual(
    layout.edges.find((item) => item.relation.id === 'ab')!.path,
    layout.edges.find((item) => item.relation.id === 'ab2')!.path,
  )
})

test('empty and single-object models have finite layouts', async () => {
  assert.deepEqual(await layoutGraph([], []), {
    width: 0,
    height: 0,
    nodes: [],
    edges: [],
  })
  const layout = await layoutGraph([object('only')], [])
  assert.equal(layout.nodes.length, 1)
  assert.equal(layout.edges.length, 0)
  assert.ok(Number.isFinite(layout.width) && layout.width > 0)
  assert.ok(Number.isFinite(layout.height) && layout.height > 0)
})
