import type { CandidateModel, Evidence } from './model.ts'
import type { ExpressionReview } from './expression.ts'
import type { SemanticPlanV2 } from './semantic.ts'
import type { UnderstandingReview } from './workflow.ts'
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
  clarification?: ClarificationReason & { source: 'model' | 'assess' }
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
export interface Understanding {
  narrative: string
  questions: Question[]
  warnings: string[]
  sources?: UnderstandingSources
  review?: UnderstandingReview
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
  // Reviewed document text. Only basis preparation reads it; design/review use businessBasis.
  narrative: string
  currentModel?: unknown
  feedback?: string
  understandingReview?: UnderstandingReview
}
export interface ModelingResult {
  semanticPlan: string
  designReview?: DesignReview
  businessBasis?: string
  semantic?: SemanticPlanV2
  clarifications: BusinessClarification[]
  model: CandidateModel
  expressionReview: ExpressionReview
  // Direct element evidence stays empty; paragraph provenance is retained in
  // the understanding and the workspace's saved modeling basis.
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
export type AgentRuntimeId = 'direct' | 'pi'
export const DEFAULT_RUNTIME: AgentRuntimeId = 'pi'
export const RUNTIMES: Record<AgentRuntimeId, { name: string; label: string }> = {
  direct: { name: '直接调用', label: '直接调用模型' },
  pi: { name: 'Pi Agent', label: 'Pi Agent' },
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
  'reading' | 'basis' | 'semantic' | 'design-check' | 'compile' | 'expression' | 'repair' | 'recheck' | 'mapping'
export type StageEvent =
  | (ProviderEvent & { part?: StagePart })
  | {
      type: 'model-checkpoint'
      model: CandidateModel
      expressionReview: ExpressionReview
    }
  | {
      type: 'model-plan'
      part: 'semantic'
      semanticPlan: string
      clarifications: BusinessClarification[]
      warnings: string[]
    }
  | { type: 'business-basis'; part: 'basis'; text: string }
  | { type: 'design-review'; part: 'semantic'; review: DesignReview; semanticPlan?: string }
  | { type: 'semantic-plan'; part: 'semantic'; semantic: SemanticPlanV2 }
  | ({ type: 'understanding-narrative' } & Understanding)
  | { type: 'understanding-review'; review: UnderstandingReview }
export type AnalysisRequest = { provider: ProviderId; runtime?: AgentRuntimeId; reasoningEffort?: ReasoningEffort } & (
  | { stage: 'understand'; document: BusinessDocument }
  | { stage: 'model'; narrative: string; model?: unknown; instruction?: string; understandingReview?: UnderstandingReview }
  | {
      stage: 'compile'
      semanticPlan: string
      businessBasis?: string
      designReview?: DesignReview
      narrative: string
      semantic?: SemanticPlanV2
    }
  | { stage: 'narrate'; model: CandidateModel }
  | { stage: 'assess'; model: CandidateModel }
  | { stage: 'verify'; narrative: string; result: ModelingResult }
  | { stage: 'map'; narrative: string; result: ModelingResult }
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
  verify: ModelingResult
  map: ModelingResult
}
export type AnalysisResult = AnalysisResults[keyof AnalysisResults]
export type AnalysisEvent =
  | StageEvent
  | { type: 'result'; result: AnalysisResult }
  | { type: 'error'; error: string }
