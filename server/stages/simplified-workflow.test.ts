import test from 'node:test'
import assert from 'node:assert/strict'
import { buildModel, compileModel } from './modeling.ts'
import { parseAnalysisRequest } from '../validation/requests.ts'
import type { CandidateModel } from '../../shared/model.ts'
import { testAgents } from '../testing/agents.ts'

const model: CandidateModel = {
  schemaVersion: '1', name: '申请', summary: '申请通过后可办理。',
  objects: [{ id: 'application', name: '申请', description: '待办理的申请。', properties: [], evidence: [] }],
  relations: [], actions: [], functions: [], rules: [], activities: [], boundaries: [],
}

test('the model stage has exactly one text basis, one Pi design and one JSON compilation boundary', async () => {
  const replies = ['审核通过是办理前提。', '## 对象及边界\n申请是独立对象。', JSON.stringify(model)]
  let calls = 0
  const runTurn = async () => replies[calls++]
  const result = await buildModel({ narrative: '审核通过后才能办理申请。' }, runTurn, { agents: testAgents(runTurn) })
  assert.equal(calls, 3)
  assert.equal(result.businessBasis, replies[0])
  assert.equal(result.modelDesign, replies[1])
  assert.deepEqual(result.model, model)
})

test('compile requests accept the saved text artifacts without a legacy structured object', () => {
  const request = parseAnalysisRequest({ stage: 'compile', modelDesign: '申请对象。', businessBasis: '申请通过后办理。', narrative: '整理稿' }, 'glm')
  assert.equal(request.stage, 'compile')
  if (request.stage !== 'compile') throw new Error('wrong stage')
  assert.equal(request.modelDesign, '申请对象。')
  assert.equal(request.businessBasis, '申请通过后办理。')
  assert.equal('legacyDesign' in request, false)
})

test('compilation keeps the saved design and text basis when the provider returns valid JSON', async () => {
  const result = await compileModel('申请对象。', '整理稿', async () => JSON.stringify(model), {}, '申请通过后办理。')
  assert.equal(result.modelDesign, '申请对象。')
  assert.equal(result.businessBasis, '申请通过后办理。')
  assert.deepEqual(result.model, model)
})
