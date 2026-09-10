import type { CandidateModel } from '../shared/model.ts'

export interface Revisions {
  document: number
  understoodDocument: number | null
  business: number
  planBasis: number | null
  candidateBasis: number | null
  model: number
  narrationBasis: number | null
  assessmentBasis: number | null
}
export const initialRevisions: Revisions = {
  document: 0,
  understoodDocument: null,
  business: 0,
  planBasis: null,
  candidateBasis: null,
  model: 0,
  narrationBasis: null,
  assessmentBasis: null,
}
export type RevisionEvent =
  | 'document'
  | 'understanding'
  | 'business'
  | 'plan'
  | 'candidate'
  | 'model'
  | 'narration'
  | 'assessment'

// Invalidation is transitive. Old outputs remain readable with their own basis.
export function advanceRevision(
  state: Revisions,
  event: RevisionEvent,
): Revisions {
  switch (event) {
    case 'document':
      return {
        ...state,
        document: state.document + 1,
        business: state.business + 1,
      }
    case 'understanding':
      return {
        ...state,
        understoodDocument: state.document,
        business: state.business + 1,
      }
    case 'business':
      return { ...state, business: state.business + 1 }
    case 'plan':
      return { ...state, planBasis: state.business }
    case 'candidate':
      return {
        ...state,
        candidateBasis: state.planBasis,
        model: state.model + 1,
      }
    case 'model':
      return { ...state, model: state.model + 1 }
    case 'narration':
      return { ...state, narrationBasis: state.model }
    case 'assessment':
      return { ...state, assessmentBasis: state.model }
  }
}
export function freshness(state: Revisions) {
  const understanding = state.understoodDocument !== state.document
  const plan = understanding || state.planBasis !== state.business
  const candidate = understanding || state.candidateBasis !== state.business
  return {
    understanding,
    plan,
    candidate,
    narration: candidate || state.narrationBasis !== state.model,
    assessment: candidate || state.assessmentBasis !== state.model,
  }
}

export function relatedElements(model: CandidateModel, id: string) {
  const relations = model.relations.filter(
    (item) => item.from === id || item.to === id,
  )
  const capabilities = [...model.actions, ...model.functions].filter((item) =>
    item.targets.includes(id),
  )
  const linked = new Set([
    id,
    ...relations.map((item) => item.id),
    ...capabilities.map((item) => item.id),
  ])
  return {
    relations,
    capabilities,
    rules: model.rules.filter((item) =>
      item.elements.some((target) => linked.has(target)),
    ),
  }
}
