import test from 'node:test'
import assert from 'node:assert/strict'
import type { SemanticPlanV2 } from '../../shared/semantic.ts'
import { semanticContext, factContext, storyContext } from './semantic-context.ts'
import { semanticModelPrompt, compileModelPrompt } from './prompts.ts'

const semantic: SemanticPlanV2 = {
  schemaVersion: '2', status: 'stories', mappings: [],
  facts: [{ id: 'F1', kind: 'constraint', statement: '申请审核通过才能办理，紧急申请除外。',
    actors: ['经办人'], objects: ['申请'], conditions: ['审核通过', '紧急申请例外'],
    result: '允许办理', certainty: 'uncertain', source: 'SOURCE_QUOTATION' }],
  stories: [{ id: 'S1', name: '办理申请', goal: '完成办理', factIds: ['F1', 'F2'],
    steps: [{ order: 1, actor: '经办人', action: '办理', object: '申请', condition: '审核通过', result: '已办理', factIds: ['F1'] }] }],
  scenarios: [{ id: 'Q1', factIds: ['F1'], statement: '紧急申请例外', scenario: '紧急申请尚未审核', distinction: '普通与紧急' }],
  boundaries: ['紧急认定口径待确认'],
  clarifications: [{ text: '如何认定紧急？', basis: 'SOURCE_QUOTATION', ambiguity: '时限或类型', impact: '改变例外条件', options: ['时限', '类型'], multiple: false }],
}

test('prompt projection removes quotations without dropping conditions, uncertainty, or story context', () => {
  const before = structuredClone(semantic)
  const projected = semanticContext(semantic)
  assert.deepEqual(semantic, before)
  assert.equal('source' in projected.facts[0], false)
  assert.deepEqual(projected.facts[0].conditions, semantic.facts[0].conditions)
  assert.equal(projected.facts[0].certainty, 'uncertain')
  assert.deepEqual(projected.stories[0].contextFactIds, ['F2'])
  assert.deepEqual(projected.stories[0].steps, semantic.stories[0].steps)
  assert.deepEqual(projected.scenarios, semantic.scenarios)
  assert.deepEqual(projected.boundaries, semantic.boundaries)
  assert.equal(projected.clarifications[0].impact, '改变例外条件')
  assert.doesNotMatch(JSON.stringify(projected), /SOURCE_QUOTATION/)
  assert.equal(factContext(semantic.facts)[0].result, '允许办理')
  assert.deepEqual(storyContext([{ ...semantic.stories[0], factIds: ['F1'] }])[0].contextFactIds, undefined)
})

test('design receives only the prepared business basis, compilation receives only the decisions', () => {
  const narrative = 'SOURCE_QUOTATION\n未纳入事实的范围说明与已确认答案。'
  const input = { narrative, feedback: 'DESIGN_FEEDBACK' }
  const basis = '已确认的范围：普通申请先审核再办理，紧急申请例外，认定口径待确认。\n检验情形：普通和紧急申请未经审核时分别如何办理。'
  const prompt = semanticModelPrompt(input, basis)
  assert.equal(prompt.split(JSON.stringify(basis)).length - 1, 1)
  assert.doesNotMatch(prompt, /SOURCE_QUOTATION|未纳入事实的范围说明/)
  assert.match(prompt, /紧急申请例外|DESIGN_FEEDBACK/)
  const compiled = compileModelPrompt('## 模型概述\n申请办理，紧急认定待确认。')
  assert.match(compiled, /紧急认定待确认/)
  assert.doesNotMatch(compiled, /SOURCE_QUOTATION|"facts"|"stories"|"scenarios"/)
})
