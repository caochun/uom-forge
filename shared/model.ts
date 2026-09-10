export interface Evidence {
  blockId: string
  quote: string
}
export interface Property {
  name: string
  type:
    | 'string'
    | 'number'
    | 'integer'
    | 'boolean'
    | 'date'
    | 'datetime'
    | 'enum'
  description: string
  evidence: Evidence[]
}
export interface Element {
  id: string
  name: string
  description: string
  evidence: Evidence[]
}
export interface BusinessObject extends Element {
  properties: Property[]
}
export interface Relation extends Element {
  from: string
  to: string
  properties: Property[]
}
export interface Action extends Element {
  targets: string[]
  inputs: Property[]
  preconditions: string[]
  effects: string[]
}
export interface BusinessFunction extends Element {
  targets: string[]
  inputs: Property[]
  output: string
}
export interface Rule extends Element {
  elements: string[]
}
export interface Requirement {
  description: string
  elements: string[]
  status: 'covered' | 'partial' | 'missing'
  reason: string
  evidence: Evidence[]
}
export interface Activity {
  id: string
  name: string
  goal: string
  evidence: Evidence[]
  requirements: Requirement[]
}
export interface CandidateModel {
  schemaVersion: '1'
  name: string
  summary: string
  objects: BusinessObject[]
  relations: Relation[]
  actions: Action[]
  functions: BusinessFunction[]
  rules: Rule[]
  activities: Activity[]
  boundaries: string[]
}

export const MODEL_COLLECTIONS = [
  'objects',
  'relations',
  'actions',
  'functions',
  'rules',
  'activities',
] as const
