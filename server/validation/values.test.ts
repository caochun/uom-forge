import test from 'node:test'
import assert from 'node:assert/strict'
import { parseJsonOutput } from './values.ts'

test('standalone closing fence fragments do not require regenerating complete JSON', () => {
  const data = { facts: [{ statement: '保留文本中的 ` 和 ```', sourceIds: ['S1'] }] }
  const raw = JSON.stringify(data)
  for (const suffix of ['\n`', '\n``', '\n```', '\r\n  ``  '])
    assert.deepEqual(parseJsonOutput(raw + suffix), data)
  assert.deepEqual(parseJsonOutput('```json\n' + raw + '\n``'), data)
})

test('fence cleanup does not accept truncated JSON, extra values, or trailing prose', () => {
  for (const raw of ['{"facts":[\n``', '{"a":1}\n{"b":2}', '{"a":1}\n说明\n``', '{"a":1}``'])
    assert.throws(() => parseJsonOutput(raw), /不是有效的 JSON/)
})
