import type { CandidateModel, Evidence } from './model.ts'

export interface BusinessDocument {
  name: string
  blocks: { id: string; text: string }[]
}
export interface Question {
  text: string
  options: string[]
  multiple?: boolean
  clarification?: ClarificationReason & { source: 'model' | 'assess' }
}
export interface ClarificationReason {
  basis: string
  ambiguity: string
  impact: string
}
export interface BusinessClarification extends ClarificationReason {
  text: string
  options: string[]
  multiple: boolean
}
export interface Understanding {
  narrative: string
  questions: Question[]
  warnings: string[]
}
export type SupportStatus = 'supported' | 'partial' | 'missing'
export interface RequirementAssessment {
  requirement: string
  status: SupportStatus
  elements: string[]
  explanation: string
  gap: string
  suggestion: string
  evidence: Evidence[]
}
export interface ProcessAssessment {
  processId: string
  processName: string
  status: SupportStatus
  reason: string
  requirements: RequirementAssessment[]
  evidence: Evidence[]
}
export interface Assessment {
  summary: string
  processAssessments: ProcessAssessment[]
  recommendations: string[]
  clarifications: BusinessClarification[]
  historicalQuestions?: string[]
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
  clarifications: BusinessClarification[]
  model: CandidateModel
  provenance: { basis: 'business-understanding'; evidence: 'unlinked' }
  validation: { elements: number; warnings: string[] }
}
export type ProviderId = 'deepseek' | 'gpt'
export const PROVIDERS: Record<ProviderId, { name: string; label: string }> = {
  deepseek: { name: 'DeepSeek', label: 'DeepSeek API' },
  gpt: { name: 'GPT', label: 'GPT API' },
}
export interface TurnTiming {
  callId: string
  // Retain the identity of historical ACP calls in saved drafts.
  provider: ProviderId | 'codex'
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
  | {
      type: 'model-plan'
      part: 'semantic'
      semanticPlan: string
      clarifications: BusinessClarification[]
    }
  | ({ type: 'understanding-narrative' } & Understanding)
export type AnalysisRequest = { provider: ProviderId } & (
  | { stage: 'understand'; document: BusinessDocument }
  | { stage: 'model'; narrative: string; model?: unknown; instruction?: string }
  | { stage: 'compile'; semanticPlan: string }
  | { stage: 'narrate'; model: CandidateModel }
  | { stage: 'assess'; model: CandidateModel }
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
