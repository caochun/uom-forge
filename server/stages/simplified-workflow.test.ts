import test from 'node:test'
import assert from 'node:assert/strict'
import { createGlmProvider } from '../providers/glm.ts'
import { readBusiness } from './understanding.ts'
import { buildModel, compileModel } from './modeling.ts'
import type { CandidateModel } from '../../shared/model.ts'
import { parseAnalysisRequest } from '../validation/requests.ts'
import { artifactVersion } from '../../shared/workflow.ts'
import type { DesignReview } from '../../shared/design-review.ts'

const model: CandidateModel = {
  schemaVersion: '1', name: '申请', summary: '申请通过后可办理。',
  objects: [{ id: 'application', name: '申请', description: '待办理的申请。', properties: [], evidence: [] }],
  relations: [], actions: [], functions: [], rules: [], activities: [], boundaries: [],
}

test('Pi + GLM completes a reviewed design and JSON in five requests with no format or finish rounds', async t => {
  const config = { GLM_API_KEY: 'test-only', GLM_API_URL: 'https://glm.invalid/v4', GLM_MODEL: 'glm-5.3-flash', GLM_REASONING_EFFORT: 'max' }
  const previous = Object.fromEntries(Object.keys(config).map(key => [key, process.env[key]]))
  Object.assign(process.env, config)
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
  const replies = ['审核通过的申请才能办理。 [[source:B1]]', '事实：审核通过是办理前提。\n故事：审核后办理。', '# 我的设计\n申请是独立对象；只有审核通过才能办理。', '结论：可表达\n申请未通过审核时受办理前提阻止，审核通过后才能办理。', JSON.stringify(model)]
  const bodies: Record<string, unknown>[] = []
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)))
    const content = replies[bodies.length - 1]
    assert.ok(content, 'must not invoke legacy mappings or a finish round')
    return new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
  })
  const turn = createGlmProvider()
  const options = { runtime: 'pi' as const, provider: 'glm' as const, reasoningEffort: 'low' as const }
  const { understanding } = await readBusiness({ name: 'sample', blocks: [{ id: 'B1', text: '审核通过后才能办理申请。' }] }, turn, options)
  const result = await buildModel({ narrative: understanding.narrative }, turn, options)
  assert.equal(bodies.length, 5)
  assert.ok(bodies.every(body => body.reasoning_effort === 'low'), 'request selection reaches reading, basis, design, review and compilation instead of environment max')
  const requestText = (index: number) => (bodies[index].messages as { role: string; content: string | { text?: string }[] }[])
    .filter(message => message.role === 'user').map(message => typeof message.content === 'string'
      ? message.content : message.content.map(part => part.text || '').join('')).join('\n')
  assert.ok(requestText(1).includes(JSON.stringify(understanding.narrative)))
  for (const index of [2, 3]) {
    assert.ok(requestText(index).includes(JSON.stringify(replies[1])), 'design and review receive the identical basis')
    assert.ok(!requestText(index).includes(understanding.narrative), 'document reading is not repeated downstream')
  }
  assert.ok(!requestText(4).includes(JSON.stringify(replies[1])), 'compiler receives design without the basis')
  assert.ok(bodies.filter((_body, i) => i !== 2).every(body => body.tools === undefined))
  assert.ok(Array.isArray(bodies[2].tools))
  assert.ok(bodies.slice(0, 4).every(body => body.response_format === undefined))
  assert.deepEqual(bodies[4].response_format, { type: 'json_object' })
  assert.equal(understanding.review, undefined)
  assert.equal(result.businessBasis, replies[1])
  assert.equal(result.semanticPlan, replies[2])
  assert.equal(result.designReview?.status, 'completed')
  assert.equal(result.designReview?.rounds.length, 1)
  assert.equal(result.designReview?.businessBasisVersion, artifactVersion(replies[1]))
  assert.equal(result.expressionReview.status, 'not-run')
  assert.equal(result.semantic, undefined)
  assert.deepEqual(result.model, model)
})

test('compilation retry preserves the text basis but sends only saved design to inference', async () => {
  const review: DesignReview = { status: 'attention', round: 3, rounds: [{ design: '申请对象。', feedback: 'REVIEW_ONLY', verdict: 'revise' }], reason: 'limit', planVersion: artifactVersion('申请对象。'), narrativeVersion: artifactVersion('NARRATIVE_ONLY'), businessBasisVersion: artifactVersion('BASIS_ONLY') }
  const request = parseAnalysisRequest({ stage: 'compile', semanticPlan: '申请对象。', businessBasis: 'BASIS_ONLY', narrative: 'NARRATIVE_ONLY', designReview: review }, 'glm')
  assert.equal(request.stage, 'compile')
  if (request.stage !== 'compile') throw new Error('wrong stage')
  let calls = 0
  const result = await compileModel(request.semanticPlan, request.narrative, async prompt => {
    calls++
    assert.doesNotMatch(prompt, /BASIS_ONLY|NARRATIVE_ONLY|REVIEW_ONLY/)
    return JSON.stringify(model)
  }, {}, request.semantic, request.businessBasis, request.designReview)
  assert.equal(calls, 1)
  assert.equal(result.businessBasis, 'BASIS_ONLY')
  assert.deepEqual(result.designReview, review)
  const changed = await compileModel('改变过的设计。', request.narrative, async () => JSON.stringify(model), {}, undefined, undefined, review)
  assert.equal(changed.designReview, undefined, 'review of an old design cannot validate another design')
  const newBasis = await compileModel(request.semanticPlan, '新的业务说明。', async () => JSON.stringify(model), {}, undefined, undefined, review)
  assert.equal(newBasis.designReview, undefined, 'review of old business input cannot validate new business input')
  const changedBasis = await compileModel(request.semanticPlan, request.narrative, async () => JSON.stringify(model), {}, undefined, 'CHANGED_BASIS', review)
  assert.equal(changedBasis.designReview, undefined, 'a review cannot claim to have checked changed facts or scenarios')
  const missingBasis = await compileModel(request.semanticPlan, request.narrative, async () => JSON.stringify(model), {}, undefined, undefined, review)
  assert.equal(missingBasis.designReview, undefined)
  const { businessBasisVersion: _version, ...legacyReview } = review
  const legacy = await compileModel(request.semanticPlan, request.narrative, async () => JSON.stringify(model), {}, undefined, undefined, legacyReview)
  assert.deepEqual(legacy.designReview, legacyReview, 'historical narrative-based reviews remain readable')
})
