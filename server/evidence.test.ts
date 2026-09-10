import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCandidateModel } from './validation/model.ts'
import { groundCitations } from './validation/evidence.ts'
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
  activities: [],
  questions: [],
})

test('rejects citations that do not exist in the submitted document', () => {
  assert.throws(
    () =>
      parseCandidateModel(
        model([{ blockId: 'missing', quote: '不存在' }]),
        document,
      ),
    /原文证据块/,
  )
})

test('assessment evidence retains only verbatim quotes and corrects misplaced block ids', () => {
  const assessment = {
    processAssessments: [
      {
        evidence: [
          { blockId: 'b1', quote: '主体完成了操作' },
          { blockId: 'wrong', quote: '产生结果' },
        ],
      },
    ],
  }
  assessment.processAssessments[0].evidence = groundCitations(
    assessment.processAssessments[0].evidence,
    document,
  )
  assert.deepEqual(assessment.processAssessments[0].evidence, [
    { blockId: 'b1', quote: '产生结果' },
  ])
})
