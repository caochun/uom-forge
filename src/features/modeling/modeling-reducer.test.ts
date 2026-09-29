import test from 'node:test'
import assert from 'node:assert/strict'
import { initialModelingStream, reduceModelingArtifact, reduceModelingEvent, reduceModelingPreview } from './modeling-reducer.ts'
import { initialRevisions } from '../../workspace.ts'

test('the stream reducer keeps stage sections and rolls back only the failed generation', () => {
  let state = initialModelingStream('model')
  state = reduceModelingEvent(state, { type: 'phase', part: 'basis', text: '依据' }).state
  state = reduceModelingEvent(state, { type: 'delta', part: 'basis', text: '事实' }).state
  state = reduceModelingEvent(state, { type: 'phase', part: 'design', text: '设计' }).state
  state = reduceModelingEvent(state, { type: 'delta', part: 'design', text: '草案' }).state
  assert.match(state.output, /建模依据/)
  assert.match(state.output, /设计/)
  const reset = reduceModelingEvent(state, { type: 'reset', part: 'design', text: '重试' })
  assert.equal(reset.state.output, '\n\n—— 建模依据 ——\n\n事实')
  assert.equal(reset.resetPart, 'design')
  assert.equal(reset.state.part, '')
})

test('reasoning and text are kept in separate stage previews', () => {
  let state = initialModelingStream('narrate')
  state = reduceModelingEvent(state, { type: 'delta', text: '思考', reasoning: true }).state
  state = reduceModelingEvent(state, { type: 'delta', text: '正文' }).state
  assert.equal(state.narration.reasoning, '思考')
  assert.equal(state.narration.text, '正文')
})

test('modeling preview reducer does not replace completed design artifacts', () => {
  const plan = { plan: '完整设计', complete: true, compiled: false, businessBasisComplete: true }
  const next = reduceModelingPreview(plan, { type: 'delta', part: 'design', text: '流', reasoning: false }, 'model')
  assert.equal(next?.plan, '完整设计')
})

test('artifact reducer applies review checkpoints without embedding SSE mechanics in the page', () => {
  const project = {
    version: 4,
    document: { name: '文档', content: '', blocks: [], size: '0', updated: '' },
    understanding: null,
    answers: {},
    questionsSaved: false,
    feedback: '',
    feedbackDocumentRevision: null,
    plan: null,
    candidate: null,
    outputs: {},
    timings: {},
    revisions: initialRevisions,
    messages: [],
  }
  const next = reduceModelingArtifact(project, {
    type: 'business-basis', part: 'basis', text: '新依据', revised: true,
  }, 4)
  assert.equal(next.plan?.businessBasis, '新依据')
  assert.equal(next.plan?.businessBasisComplete, true)
  assert.equal(next.revisions.planBasis, 4)
})
