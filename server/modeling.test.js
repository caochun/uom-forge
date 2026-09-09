import test from 'node:test'
import assert from 'node:assert/strict'
import { hydrateEvidence, normalizeModel, validateModel } from './modeling.js'

const document = { name: 'test.md', blocks: [{ id: 'b1', text: '主体完成操作并产生结果' }] }

test('normalizes compact candidates into the provider-neutral model contract', () => {
  const model = hydrateEvidence(normalizeModel({
    name: '通用业务',
    objects: [{ id: '主体', name: '主体', fields: ['身份'], evidence: ['主体完成操作并产生结果'] }, { id: '结果', name: '结果' }],
    relations: [{ from: '主体', label: '产生', to: '结果', evidence: ['主体完成操作并产生结果'] }],
    actions: [{ id: 'perform', name: '完成操作', targets: ['主体', '结果'], inputs: [] }],
    activities: [{ id: 'operation', name: '执行操作', goal: '完成业务操作', elements: ['主体', '结果'], status: 'supported', evidence: ['主体完成操作并产生结果'] }],
  }), document)
  assert.equal(model.schemaVersion, '1')
  assert.equal(model.objects[0].properties[0].type, 'string')
  assert.deepEqual(model.relations[0].from, '主体')
  assert.equal(model.objects[0].evidence[0].blockId, 'b1')
  assert.doesNotThrow(() => validateModel(model, document))
})

test('rejects citations that do not exist in the submitted document', () => {
  const model = normalizeModel({ objects: [{ id: 'entity', name: '实体', evidence: [{ blockId: 'missing', quote: '不存在' }] }] })
  assert.throws(() => validateModel(model, document), /原文证据块/)
})

test('drops provider citations that are not verbatim evidence', () => {
  const model = hydrateEvidence(normalizeModel({
    actions: [{ id: 'perform', name: '完成操作', targets: [], inputs: [], evidence: [{ blockId: 'b1', quote: '主体完成了操作' }] }],
  }), document)
  assert.deepEqual(model.actions[0].evidence, [])
  assert.doesNotThrow(() => validateModel(model, document))
})
