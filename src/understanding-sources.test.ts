import test from 'node:test'
import assert from 'node:assert/strict'
import {
  extractUnderstandingSources,
  readUnderstandingSources,
  reviseUnderstandingSources,
  traceUnderstandingSource,
} from '../shared/understanding-sources.ts'
import { reviseUnderstanding } from './understanding.ts'

const document = {
  name: '业务规则.docx',
  blocks: [
    { id: 'block-1', text: '客户提交订单，提交后进入审核。' },
    { id: 'block-2', text: '审核员可以驳回订单。' },
  ],
}

test('citations keep program-copied original blocks separately from the clean explanation', () => {
  const result = extractUnderstandingSources(
    '## 流程\n\n客户可以下单。 [[source:block-1]]\n审核存在不同结果。 [[source:block-1,block-2]]',
    document,
  )
  assert.equal(
    result.narrative,
    '## 流程\n\n客户可以下单。\n审核存在不同结果。',
  )
  assert.deepEqual(result.sources.blocks, document.blocks)
  assert.deepEqual(
    traceUnderstandingSource('客户可以下单。', result.sources).blocks,
    [document.blocks[0]],
  )
  assert.deepEqual(
    traceUnderstandingSource('审核存在不同结果。', result.sources).blocks,
    document.blocks,
  )
  assert.notEqual(
    result.sources.citations[0].passage,
    result.sources.blocks[0].text,
  )
})

test('invalid references leave the narrative usable without fabricating or partially accepting a citation', () => {
  const result = extractUnderstandingSources(
    '客户下单。 [[source:block-1,missing]]\n尚不明确。 [[source:]]',
    document,
  )
  assert.equal(result.narrative, '客户下单。\n尚不明确。')
  assert.deepEqual(result.sources.citations, [])
  assert.equal(result.warnings.length, 1)
  assert.equal(
    traceUnderstandingSource('客户下单。', result.sources).unlinked,
    true,
  )
})

test('human revisions retain only unchanged passages and never inherit the replaced text’s original reference', () => {
  const original = extractUnderstandingSources(
    '客户下单。 [[source:block-1]]\n审核员驳回。 [[source:block-2]]',
    document,
  )
  const narrative = '客户下单。\n系统自动驳回。'
  const revised = reviseUnderstandingSources(
    original.sources,
    original.narrative,
    narrative,
  )
  assert.deepEqual(traceUnderstandingSource('客户下单。', revised).blocks, [
    document.blocks[0],
  ])
  assert.equal(traceUnderstandingSource('系统自动驳回。', revised).user, true)
  assert.deepEqual(
    traceUnderstandingSource('系统自动驳回。', revised).blocks,
    [],
  )
  assert.equal(traceUnderstandingSource('审核员驳回。', revised).unlinked, true)
  assert.deepEqual(original.sources.blocks, document.blocks)
})

test('saved confirmations have user provenance and clearing them does not retain their references', () => {
  const original = extractUnderstandingSources(
    '客户下单。 [[source:block-1]]',
    document,
  )
  const source = {
    ...original,
    questions: [{ text: '如何复核？', options: [] }],
  }
  const revised = reviseUnderstanding(source, { 0: '主管人工复核' })
  const confirmation = traceUnderstandingSource(
    '已确认说明：主管人工复核',
    revised.sources,
  )
  assert.equal(confirmation.user, true)
  assert.deepEqual(confirmation.blocks, [])
  assert.equal(
    traceUnderstandingSource('客户下单。', revised.sources).blocks.length,
    1,
  )
  assert.equal(
    traceUnderstandingSource(
      '已确认说明：主管人工复核',
      reviseUnderstanding(revised.source).sources,
    ).unlinked,
    true,
  )
})

test('trace resolution supports multiple cited lines and refuses ambiguous or merely similar text', () => {
  const result = extractUnderstandingSources(
    '- **客户下单。** [[source:block-1]]\n审核员驳回。 [[source:block-2]]',
    document,
  )
  assert.deepEqual(
    traceUnderstandingSource('“客户下单。”；“审核员驳回。”', result.sources)
      .blocks,
    document.blocks,
  )
  assert.equal(
    traceUnderstandingSource('客户可以下单。', result.sources).unlinked,
    true,
  )
  const ambiguous = extractUnderstandingSources(
    '客户下单。 [[source:block-1]]\n客户下单。 [[source:block-2]]',
    document,
  )
  assert.equal(
    traceUnderstandingSource('客户下单。', ambiguous.sources).unlinked,
    true,
  )
  const partlyCited = extractUnderstandingSources(
    '客户下单。 [[source:block-1]]\n客户下单。',
    document,
  )
  assert.equal(
    traceUnderstandingSource('客户下单。', partlyCited.sources).unlinked,
    true,
  )
})

test('legacy and malformed source metadata remain unlinked without failing restoration', () => {
  assert.equal(readUnderstandingSources(undefined, '客户下单。'), undefined)
  assert.equal(
    readUnderstandingSources({ blocks: [null] }, '客户下单。'),
    undefined,
  )
  const result = extractUnderstandingSources(
    '客户下单。 [[source:block-1]]',
    document,
  )
  const corrupted = {
    ...result.sources,
    citations: [{ ...result.sources.citations[0], blockIds: ['missing'] }],
  }
  assert.deepEqual(
    readUnderstandingSources(corrupted, result.narrative)?.citations,
    [],
  )
  assert.deepEqual(
    readUnderstandingSources(result.sources, '完全不同的说明')?.citations,
    [],
  )
})
