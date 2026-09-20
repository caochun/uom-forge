import type { BusinessFact, BusinessStory, SemanticPlanV2 } from '../../shared/semantic.ts'

// Source quotations stay in the persisted plan for provenance and validation.
// Downstream reasoning needs the facts, not another copy of each cited paragraph.
export function factContext(facts: BusinessFact[]) {
  return facts.map(({ source: _source, ...fact }) => fact)
}

export function storyContext(stories: BusinessStory[]) {
  return stories.map(({ factIds, steps, ...story }) => {
    const stepFacts = new Set(steps.flatMap(step => step.factIds))
    const contextFactIds = factIds.filter(id => !stepFacts.has(id))
    return {
      ...story,
      steps,
      // Preserve story-level constraints that do not belong to any single step.
      ...(contextFactIds.length ? { contextFactIds } : {}),
    }
  })
}

export function semanticContext(semantic: SemanticPlanV2) {
  return {
    facts: factContext(semantic.facts),
    stories: storyContext(semantic.stories),
    scenarios: semantic.scenarios,
    boundaries: semantic.boundaries,
    // Keep unresolved findings, without version hashes and repeated metadata.
    understandingReview: semantic.understandingReview && {
      status: semantic.understandingReview.status,
      findings: semantic.understandingReview.findings,
      warnings: semantic.understandingReview.warnings,
    },
    clarifications: semantic.clarifications.map(({ basis: _basis, ...item }) => item),
  }
}
