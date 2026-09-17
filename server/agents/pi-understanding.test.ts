import test from 'node:test'
import assert from 'node:assert/strict'
import { independentlyCheck } from './pi-understanding.ts'

test('independent coverage check treats omitted and partial blocks as gaps', async () => {
  const runTurn = async () =>
    JSON.stringify({
      coverage: [
        { id: 'block-1', status: 'complete', note: '已说明' },
        { id: 'block-2', status: 'partial', note: '遗漏条件' },
      ],
    })
  const gaps = await independentlyCheck(
    '说明',
    [
      { id: 'block-1', text: '事实一' },
      { id: 'block-2', text: '事实二' },
      { id: 'block-3', text: '事实三' },
    ],
    runTurn,
    'deepseek',
  )
  assert.deepEqual(gaps.map(({ text, status }) => [text, status]), [
    ['事实二', 'partial'],
    ['事实三', 'missing'],
  ])
})

test('independent coverage check accepts only complete known blocks', async () => {
  const runTurn = async () =>
    JSON.stringify({
      coverage: [{ id: 'block-1', status: 'complete', note: '已说明' }],
    })
  const gaps = await independentlyCheck(
    '说明',
    [{ id: 'block-1', text: '事实一' }],
    runTurn,
    'gpt',
  )
  assert.deepEqual(gaps, [])
})

test('coverage check uses stable ids and ignores unknown critic entries', async () => {
  const gaps = await independentlyCheck(
    '说明',
    [
      { id: 'block-1', text: '相同原文' },
      { id: 'block-2', text: '相同原文' },
    ],
    async (prompt) => {
      assert.match(prompt, /必须原样返回每个输入 id/)
      assert.match(prompt, /"id":"block-1"/)
      return JSON.stringify({
        coverage: [
          { id: 'block-1', status: 'complete', note: '已说明' },
          { id: 'unknown', status: 'complete', note: '无效记录' },
        ],
      })
    },
    'deepseek',
  )
  assert.deepEqual(gaps, [
    {
      text: '相同原文',
      status: 'missing',
      note: '独立评估未返回该原文片段。',
    },
  ])
})
