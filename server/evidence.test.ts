import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCandidateModel } from './validation/model.ts'
import type { Evidence, CandidateModel } from '../shared/model.ts'

const document = {
  name: 'test.md',
  blocks: [{ id: 'b1', text: '主体完成操作并产生结果' }],
}
const model = (evidence: Evidence[]): CandidateModel => ({
  schemaVersion: '1',
  name: '测试',
  summary: '验证引用',
  objects: [
    {
      id: 'entity',
      name: '实体',
      description: '业务实体',
      properties: [],
      evidence,
    },
  ],
  relations: [],
  actions: [],
  functions: [],
  rules: [],
  boundaries: [],
})

test('rejects citations that do not exist in the submitted document', () => {
  assert.throws(
    () =>
      parseCandidateModel(
        model([{ quote: '不存在' }]),
        document,
      ),
    /引文不在原文/,
  )
})
