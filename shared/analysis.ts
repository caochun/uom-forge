import type { CandidateModel, Evidence } from './model.ts'

export interface BusinessDocument {
  name: string
  blocks: { id: string; text: string }[]
}
export interface Question {
  text: string
  options: string[]
  multiple?: boolean
}
export interface Understanding {
  narrative: string
  questions: Question[]
  warnings: string[]
}
export interface ProcessAssessment {
  processId: string
  processName: string
  status: 'supported' | 'partial' | 'missing'
  coveredElements: string[]
  gaps: string[]
  evidence: Evidence[]
}
export interface Assessment {
  summary: string
  processAssessments: ProcessAssessment[]
  recommendations: string[]
  questions: string[]
}
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}
// Discussion can inspect incomplete drafts. Only validated results claim to
// be CandidateModels.
export interface DiscussionContext {
  candidate?: unknown
  understanding?: string | null
  review?: string
}
export interface ModelingInput {
  narrative: string
  currentModel?: unknown
  feedback?: string
}
export interface ModelingResult {
  semanticPlan: string
  model: CandidateModel
  provenance: { basis: 'business-understanding'; evidence: 'unlinked' }
  validation: { elements: number; warnings: string[] }
}
export type ProviderId = 'codex' | 'deepseek'
export interface TurnTiming {
  callId: string
  provider: ProviderId
  model: string
  reasoningEffort?: string
  startedAt: string
  promptCharacters: number
  outputCharacters: number
  elapsedMs: number
  connectedMs?: number
  sessionReadyMs?: number
  firstTextMs?: number
  status: 'running' | 'completed' | 'failed' | 'cancelled'
}
export type ProviderEvent =
  | { type: 'phase'; text: string }
  | { type: 'delta'; text: string; reasoning?: boolean; size?: number }
  | { type: 'timing'; timing: TurnTiming }
export type StagePart = 'reading' | 'semantic' | 'compile'
export type StageEvent =
  | (ProviderEvent & { part?: StagePart })
  | { type: 'model-plan'; part: 'semantic'; semanticPlan: string }
  | ({ type: 'understanding-narrative' } & Understanding)
export type AnalysisRequest = { provider: ProviderId } & (
  | { stage: 'understand'; document: BusinessDocument }
  | { stage: 'model'; narrative: string; model?: unknown; instruction?: string }
  | { stage: 'compile'; semanticPlan: string }
  | { stage: 'narrate'; model: CandidateModel }
  | {
      stage: 'assess'
      document: BusinessDocument
      narrative: string
      model: CandidateModel
    }
)
export interface DiscussionRequest {
  provider: ProviderId
  document: BusinessDocument
  model: DiscussionContext
  messages: ChatMessage[]
}
export interface AnalysisResults {
  understand: { understanding: Understanding }
  model: ModelingResult
  compile: ModelingResult
  narrate: { narrative: string }
  assess: { assessment: Assessment }
}
export type AnalysisResult = AnalysisResults[keyof AnalysisResults]
export type AnalysisEvent =
  | StageEvent
  | { type: 'result'; result: AnalysisResult }
  | { type: 'error'; error: string }
