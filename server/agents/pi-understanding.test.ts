import test from 'node:test'
import assert from 'node:assert/strict'
import { reviewUnderstanding } from '../stages/understanding-review.ts'

test('understanding review reports only semantic gaps instead of every complete block', async () => {
  let prompt = ''
  const review = await reviewUnderstanding(
    '材料只能校订一次。',
    [
      { id: 'block-1', text: '材料可以反复校订。' },
      { id: 'block-2', text: '校订结果需要保留。' },
    ],
    async value => {
      prompt = value
      return JSON.stringify({
        gaps: [
          { kind: 'omission', passage: '', blockIds: ['block-1'], note: '遗漏重复发生。' },
          { kind: 'conflict', passage: '材料只能校订一次。', blockIds: [], note: '与原文允许反复校订冲突。' },
        ],
      })
    },
    'glm',
  )
  assert.match(prompt, /只返回确实发现的问题/)
  assert.doesNotMatch(prompt, /必须原样返回每个输入 id/)
  assert.doesNotMatch(prompt, /coverage/)
  assert.equal(review.status, 'issues')
  assert.deepEqual(review.findings.map(item => item.kind), ['omission', 'conflict'])
  assert.deepEqual(review.findings[0].blockIds, ['block-1'])
})

test('an empty gap list passes without requiring complete results for source blocks', async () => {
  const review = await reviewUnderstanding(
    '说明',
    [{ id: 'block-1', text: '事实一' }, { id: 'block-2', text: '事实二' }],
    async () => JSON.stringify({ gaps: [] }),
    'gpt',
  )
  assert.equal(review.status, 'passed')
  assert.deepEqual(review.findings, [])
  assert.deepEqual(review.warnings, [])
})

test('invalid gap evidence is retained as a warning without blocking the draft', async () => {
  const review = await reviewUnderstanding(
    '说明',
    [{ id: 'block-1', text: '事实一' }],
    async () => JSON.stringify({ gaps: [{ kind: 'omission', passage: '', blockIds: ['unknown'], note: '缺口' }] }),
    'deepseek',
  )
  assert.equal(review.status, 'incomplete')
  assert.equal(review.findings.length, 0)
  assert.match(review.warnings[0], /有效引用/)
})
