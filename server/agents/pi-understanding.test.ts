import test from 'node:test'
import assert from 'node:assert/strict'
import { independentlyCheck } from './pi-understanding.ts'

test('independent coverage check treats omitted and partial blocks as gaps', async () => {
  const runTurn = async () =>
    JSON.stringify({
      coverage: [
        { text: '事实一', status: 'complete', note: '已说明' },
        { text: '事实二', status: 'partial', note: '遗漏条件' },
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
      coverage: [{ text: '事实一', status: 'complete', note: '已说明' }],
    })
  const gaps = await independentlyCheck(
    '说明',
    [{ id: 'block-1', text: '事实一' }],
    runTurn,
    'gpt',
  )
  assert.deepEqual(gaps, [])
})
