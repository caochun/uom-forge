import type { BusinessClarification } from './analysis.ts'

/**
 * Evidence-first semantic handoff between business understanding and model
 * compilation. These records are deliberately independent of CandidateModel:
 * they describe what the business says before deciding how to represent it.
 */
export type FactKind = 'static' | 'event' | 'state' | 'constraint' | 'role'
export type FactCertainty = 'explicit' | 'confirmed' | 'uncertain'

export interface BusinessFact {
  id: string
  statement: string
  kind: FactKind
  actors: string[]
  objects: string[]
  conditions: string[]
  result?: string
  source: string
  certainty: FactCertainty
}

export interface StoryStep {
  order: number
  actor: string
  action: string
  object: string
  condition?: string
  result?: string
  factIds: string[]
}

export interface BusinessStory {
  id: string
  name: string
  goal: string
  steps: StoryStep[]
  factIds: string[]
}

export interface ElementMapping {
  factId: string
  elementIds: string[]
  mappingType:
    | 'object'
    | 'relation'
    | 'action'
    | 'function'
    | 'rule'
    | 'activity'
  explanation: string
  coverage: 'full' | 'partial' | 'missing'
}

export interface SemanticPlanV2 {
  /** Versioned so drafts can be migrated at the storage boundary. */
  schemaVersion: '2'
  // Progressive snapshots survive cancellation between the fixed stages.
  status: 'facts' | 'stories' | 'mapped'
  facts: BusinessFact[]
  stories: BusinessStory[]
  mappings: ElementMapping[]
  boundaries: string[]
  clarifications: BusinessClarification[]
}
