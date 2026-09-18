import test from 'node:test'
import assert from 'node:assert/strict'
import {
  latestModelTimings,
  modelingProgress,
  prepareCompilationRetry,
} from './modeling-progress.ts'
import type { CandidateDraft, SemanticPlan, StageTiming } from './types.ts'

const candidate: CandidateDraft = {
  revision: 1,
  documentRevision: 1,
  model: {
    schemaVersion: '1',
    name: '事项',
    summary: '登记事项',
    objects: [],
    relations: [],
    actions: [],
    functions: [],
    rules: [],
    activities: [],
    boundaries: [],
  },
  expressionReview: {
    status: 'passed',
    snapshots: [],
    selectedSnapshot: 0,
    changes: [],
    warnings: [],
  },
}
const plan: SemanticPlan = {
  plan: '建模说明',
  complete: true,
  compiled: true,
  semantic: {
    schemaVersion: '2',
    status: 'stories',
    facts: [
      {
        id: 'f1',
        statement: '登记事项',
        kind: 'event',
        actors: ['业务员'],
        objects: ['事项'],
        conditions: [],
        source: '登记事项',
        certainty: 'explicit',
      },
    ],
    stories: [],
    mappings: [],
    boundaries: [],
    clarifications: [],
  },
}

test('a new run never presents the retained candidate as newly compiled or checked', () => {
  const progress = modelingProgress({
    plan: { plan: '', complete: false, compiled: false },
    candidate,
    runningPart: 'semantic',
  })
  assert.equal(progress.active?.id, 'facts')
  assert.equal(progress.oldCandidate, true)
  assert.equal(
    progress.steps.find((item) => item.id === 'compile')?.state,
    'stale',
  )
  assert.equal(
    progress.steps.find((item) => item.id === 'expression')?.state,
    'stale',
  )
  assert.doesNotMatch(
    progress.tabs.find((item) => item.id === 'model')!.detail,
    /通过|完成/,
  )
})

test('semantic work points to stories, decisions and mapping from saved artifacts', () => {
  const factsOnly: SemanticPlan = {
    ...plan,
    complete: false,
    compiled: false,
    semantic: { ...plan.semantic!, status: 'facts' },
  }
  assert.equal(
    modelingProgress({
      plan: factsOnly,
      candidate: null,
      runningPart: 'semantic',
    }).active?.id,
    'stories',
  )
  assert.equal(
    modelingProgress({
      plan: { ...factsOnly, semantic: plan.semantic },
      candidate: null,
      runningPart: 'semantic',
    }).active?.tab,
    'decisions',
  )
  assert.equal(
    modelingProgress({ plan, candidate, runningPart: 'expression' }).active
      ?.tab,
    'model',
  )
  assert.equal(
    modelingProgress({ plan, candidate, runningPart: 'semantic' }).active?.id,
    'mapping',
  )
})

test('incomplete checks and missing mappings remain actionable after a run', () => {
  const progress = modelingProgress({
    plan,
    candidate: {
      ...candidate,
      expressionReview: {
        ...candidate.expressionReview!,
        status: 'incomplete',
      },
    },
  })
  assert.equal(
    progress.tabs.find((item) => item.id === 'model')?.detail,
    '检查未完成',
  )
  assert.equal(
    progress.tabs.find((item) => item.id === 'evidence')?.detail,
    '映射未完成',
  )
})

test('editing or changing the business basis invalidates successful checks and coverage', () => {
  const mapped: SemanticPlan = {
    ...plan,
    semantic: {
      ...plan.semantic!,
      status: 'mapped',
      mappings: [
        {
          factId: 'f1',
          elementIds: ['item'],
          mappingType: 'object',
          explanation: '事项记录',
          coverage: 'full',
        },
      ],
    },
  }
  const edited = modelingProgress({
    plan: mapped,
    candidate: { ...candidate, edited: true },
  })
  assert.equal(edited.tabs.find((item) => item.id === 'model')?.state, 'stale')
  assert.equal(
    edited.tabs.find((item) => item.id === 'evidence')?.state,
    'stale',
  )
  const changed = modelingProgress({
    plan: mapped,
    candidate,
    planStale: true,
    candidateStale: true,
  })
  assert.ok(changed.tabs.every((tab) => tab.state === 'stale'))
})

test('compilation retries discard old mappings and warnings while preserving facts and stories', () => {
  const prior: SemanticPlan = {
    ...plan,
    warnings: ['旧失败'],
    semantic: {
      ...plan.semantic!,
      status: 'mapped',
      mappings: [
        {
          factId: 'f1',
          elementIds: [],
          mappingType: 'object',
          explanation: '缺失',
          coverage: 'missing',
        },
      ],
    },
  }
  const retry = prepareCompilationRetry(prior)
  assert.equal(retry.compiled, false)
  assert.equal(retry.semantic?.status, 'stories')
  assert.equal(retry.semantic?.mappings.length, 0)
  assert.deepEqual(retry.warnings, [])
  assert.deepEqual(retry.semantic?.facts, prior.semantic?.facts)
  assert.equal(prior.semantic?.mappings.length, 1)
})

test('last-run timings do not add historical retries to the latest full run', () => {
  const record = (startedAt: string): StageTiming => ({
    startedAt,
    callId: startedAt,
    provider: 'deepseek',
    model: 'test',
    status: 'completed',
    promptCharacters: 1,
    outputCharacters: 1,
    elapsedMs: 1000,
  })
  const old = record('2026-09-17T01:00:00Z')
  const latest = record('2026-09-18T01:00:00Z')
  assert.deepEqual(latestModelTimings({ model: [latest], compile: [old] }), [
    latest,
  ])
  assert.deepEqual(latestModelTimings({ model: [old], compile: [latest] }), [
    latest,
  ])
})
