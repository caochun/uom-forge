import type { CandidateModel, Evidence } from './model.ts'
import type { DesignReview } from './design-review.ts'
import type { ReasoningEffort } from './reasoning.ts'

export interface BusinessDocument {
  name: string
  blocks: { id: string; text: string }[]
}
export interface Question {
  text: string
  options: string[]
  multiple?: boolean
  clarification?: ClarificationReason & { source: 'model' }
}
export interface ClarificationReason {
  basis: string
  // Assigned by the host after locating the quote, never asserted by the LLM.
  basisSource?: 'business-basis'
  ambiguity: string
  impact: string
}
export interface BusinessClarification extends ClarificationReason {
  text: string
  options: string[]
  multiple: boolean
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
  // These rows describe business plans from the basis, not model elements.
  processAssessments: ProcessAssessment[]
  recommendations: string[]
  clarifications: BusinessClarification[]
  historicalQuestions?: string[]
}
export interface Understanding {
  narrative: string
  questions: Question[]
  warnings: string[]
  sources?: UnderstandingSources
}
export interface UnderstandingSources {
  documentName: string
  // Original block snapshots: quotes are copied by the program, never by the LLM.
  blocks: BusinessDocument['blocks']
  citations: {
    passage: string
    origin: 'document' | 'user'
    blockIds: string[]
  }[]
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
  // Reviewed document text. Only basis preparation reads it; design/review use businessBasis.
  narrative: string
  currentModel?: unknown
  feedback?: string
}
export interface ModelingResult {
  modelDesign: string
  designReview?: DesignReview
  businessBasis?: string
  clarifications: BusinessClarification[]
  model: CandidateModel
  // The current compiler does not invent element-level citations. Source
  // snapshots remain attached to the business understanding and saved basis.
  provenance: { basis: 'business-understanding'; evidence: 'unlinked' }
  validation: { elements: number; warnings: string[] }
}
export type ProviderId = 'deepseek' | 'gpt' | 'qwen' | 'glm'
export const DEFAULT_PROVIDER: ProviderId = 'glm'
export const PROVIDERS: Record<ProviderId, { name: string; label: string }> = {
  deepseek: { name: 'DeepSeek', label: 'DeepSeek API' },
  gpt: { name: 'GPT', label: 'GPT API' },
  qwen: { name: 'Qwen', label: 'Qwen API' },
  glm: { name: 'GLM', label: 'GLM API' },
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
export type StagePart =
  'reading' | 'basis' | 'design' | 'design-check' | 'compile' | 'narrate' | 'assess'
export type StageEvent =
  | (ProviderEvent & { part?: StagePart })
  | {
      type: 'model-design'
      part: 'design'
      modelDesign: string
      clarifications: BusinessClarification[]
      warnings: string[]
    }
  | { type: 'business-basis'; part: 'basis'; text: string }
  | { type: 'design-review'; part: 'design'; review: DesignReview; modelDesign?: string }
  | ({ type: 'understanding-narrative' } & Understanding)
export type AnalysisRequest = { provider: ProviderId; reasoningEffort?: ReasoningEffort } & (
  | { stage: 'understand'; document: BusinessDocument }
  | { stage: 'model'; narrative: string; model?: unknown; instruction?: string }
  | {
      stage: 'compile'
      modelDesign: string
      businessBasis?: string
      designReview?: DesignReview
      narrative: string
    }
  | { stage: 'narrate'; model: CandidateModel }
  | { stage: 'assess'; model: CandidateModel; businessBasis: string }
)
export interface DiscussionRequest {
  provider: ProviderId
  reasoningEffort?: ReasoningEffort
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

export type DiscussionEvent =
  | { type: 'delta'; text: string; reasoning?: boolean }
  | { type: 'result'; text: string }
  | { type: 'error'; error: string }
