import test from 'node:test'
import assert from 'node:assert/strict'
import {
  latestModelTimings,
  modelingProgress,
  prepareCompilationRetry,
} from './modeling-progress.ts'
import type { CandidateDraft, ModelDesign, StageTiming } from './types.ts'

const candidate: CandidateDraft = {
  revision: 1,
  documentRevision: 1,
  model: {
    schemaVersion: '1', name: '事项', summary: '登记事项',
    objects: [], relations: [], actions: [], functions: [], rules: [], boundaries: [],
  },
}
const plan: ModelDesign = {
  plan: '建模说明', businessBasis: '依据', businessBasisComplete: true, complete: true, compiled: true,
  designReview: { status: 'checking', round: 2, rounds: [] },
}

test('the current workflow exposes one progress item per workspace tab', () => {
  const active = modelingProgress({ plan, candidate: null, runningPart: 'design-check' })
  assert.deepEqual(active.steps.map(step => [step.id, step.tab]), [
    ['basis', 'evidence'], ['decisions', 'decisions'], ['compile', 'model'],
  ])
  assert.equal(active.active?.tab, 'decisions')
  assert.match(active.active!.detail, /第 2 轮/)
})

test('a new run never presents the retained candidate as newly compiled', () => {
  const progress = modelingProgress({
    plan: { plan: '', complete: false, compiled: false }, candidate, runningPart: 'basis',
  })
  assert.equal(progress.active?.id, 'basis')
  assert.equal(progress.oldCandidate, true)
  assert.equal(progress.steps.find(item => item.id === 'compile')?.state, 'stale')
  assert.doesNotMatch(progress.tabs.find(item => item.id === 'model')!.detail, /通过|完成/)
})

test('editing or changing the business basis invalidates current artifacts', () => {
  const edited = modelingProgress({ plan, candidate: { ...candidate, edited: true }, candidateStale: true })
  assert.equal(edited.tabs.find(tab => tab.id === 'model')?.state, 'stale')
  const changed = modelingProgress({ plan, candidate, planStale: true, candidateStale: true })
  assert.ok(changed.tabs.every(tab => tab.state === 'stale'))
})

test('compilation retry keeps only text artifacts and resets compilation state', () => {
  const prior: ModelDesign = { ...plan, warnings: ['旧失败'], compilation: { text: '{}', reasoning: '', attempt: 1, status: 'completed' } }
  const retry = prepareCompilationRetry(prior)
  assert.equal(retry.compiled, false)
  assert.equal(retry.compilation, undefined)
  assert.deepEqual(retry.warnings, [])
})

test('last-run timings do not add historical retries to the latest full run', () => {
  const record = (startedAt: string): StageTiming => ({
    startedAt, callId: startedAt, provider: 'deepseek', model: 'test', status: 'completed',
    promptCharacters: 1, outputCharacters: 1, elapsedMs: 1000,
  })
  const old = record('2026-09-17T01:00:00Z')
  const latest = record('2026-09-18T01:00:00Z')
  assert.deepEqual(latestModelTimings({ model: [latest], compile: [old] }), [latest])
  assert.deepEqual(latestModelTimings({ model: [old], compile: [latest] }), [latest])
})
