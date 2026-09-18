import type {
  AnalysisRequest,
  Assessment,
  BusinessDocument,
  ChatMessage,
  StagePart,
  TurnTiming,
  Understanding,
} from '../shared/analysis.ts'
import type { CandidateModel, Element } from '../shared/model.ts'
import type { Revisions } from './workspace.ts'
import type { ExpressionReview } from '../shared/expression.ts'
import type { SemanticPlanV2 } from '../shared/semantic.ts'

export type AnalysisStage = AnalysisRequest['stage']
export type WorkspacePage = 'document' | 'understanding' | 'model' | 'review'
export type ModelViewMode = 'evidence' | 'decisions' | 'model'
export type ReviewViewMode = 'narration' | 'assessment'
export const EDITABLE_COLLECTIONS = [
  'objects',
  'relations',
  'actions',
  'functions',
  'rules',
] as const
export type EditableCollection = (typeof EDITABLE_COLLECTIONS)[number]
export type EditableElement = CandidateModel[EditableCollection][number]
export type ElementChanges = Pick<Element, 'name' | 'description'>
export type DiscussionSubject = ElementChanges & { id?: string }
export type QuestionAnswer = string | string[]
export type QuestionAnswers = Record<number, QuestionAnswer>
export interface ReviewedUnderstanding extends Understanding {
  // Source reading and its question catalogue stay local for further revisions.
  // Only the revised narrative is sent to downstream stages.
  source: Understanding
  confirmedAnswers: QuestionAnswers
}
export interface WorkspaceDocument extends BusinessDocument {
  content: string
  size: string
  updated: string
}
export interface SemanticPlan {
  plan: string
  // Preserve the actual understanding used for this run, including source
  // snapshots; later edits must not rewrite an old fact's provenance.
  basis?: Pick<Understanding, 'narrative' | 'sources'>
  semantic?: SemanticPlanV2
  complete: boolean
  compiled: boolean
  warnings?: string[]
}
export interface CandidateDraft {
  model: CandidateModel
  revision: number
  documentRevision: number
  edited?: boolean
  expressionReview?: ExpressionReview
  historicalQuestions?: string[]
}
export interface WorkspaceMessage extends ChatMessage {
  id?: string
  progress?: boolean
  stage?: AnalysisStage
  context?: DiscussionSubject | null
}
export type StageTiming = TurnTiming & { part?: StagePart }
export interface Project {
  version: 4
  document: WorkspaceDocument
  understanding: ReviewedUnderstanding | null
  answers: QuestionAnswers
  questionsSaved: boolean
  feedback: string
  feedbackDocumentRevision: number | null
  plan: SemanticPlan | null
  candidate: CandidateDraft | null
  narration: string
  assessment: Assessment | null
  outputs: Partial<Record<AnalysisStage, string>>
  timings: Partial<Record<AnalysisStage, StageTiming[]>>
  revisions: Revisions
  messages: WorkspaceMessage[]
}
export interface StageJob {
  stage: AnalysisStage
  started: number
  part: StagePart | ''
  text: string
  timing?: TurnTiming
}
export type OnDiscuss = (subject: DiscussionSubject) => void
export type OnEdit = (
  kind: EditableCollection,
  id: string,
  changes: ElementChanges,
) => void
