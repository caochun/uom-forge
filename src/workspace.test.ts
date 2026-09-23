import test from 'node:test'
import assert from 'node:assert/strict'
import { advanceRevision, initialRevisions, freshness } from './workspace.ts'
import type { Revisions, RevisionEvent } from './workspace.ts'
const advance = (events: RevisionEvent[], initial = initialRevisions) =>
  events.reduce(advanceRevision, initial)
const completed = (): Revisions =>
  advance([
    'document',
    'understanding',
    'plan',
    'candidate',
  ])

test('changes invalidate all downstream results, preserving their basis for review', () => {
  assert.deepEqual(freshness(completed()), {
    understanding: false,
    plan: false,
    candidate: false,
  })
  for (const event of ['business', 'document'] as const) {
    const state = advanceRevision(completed(), event)
    assert.equal(freshness(state).candidate, true)
    assert.equal(state.model, completed().model)
  }
})
test('finishing a new plan does not make an old graph current; compiling invalidates checks', () => {
  const state = advance(['business', 'plan'], completed())
  assert.equal(freshness(state).plan, false)
  assert.equal(freshness(state).candidate, true)
  const compiled = advanceRevision(state, 'candidate')
  assert.equal(freshness(compiled).candidate, false)
})
