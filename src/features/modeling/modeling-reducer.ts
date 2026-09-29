import type { AnalysisEvent, StagePart } from '../../../shared/analysis.ts'
import type { AnalysisStage } from '../../types.ts'
import { STAGE_PART_LABELS } from '../../stage-labels.ts'
import type { ModelDesign } from '../../types.ts'
import type { Project } from '../../types.ts'
import { resetPlanStream } from '../../stream-recovery.ts'
import { receiveClarifications } from '../../understanding.ts'

export interface TextStream {
  text: string
  reasoning: string
  complete?: boolean
}

export interface ModelingStreamState {
  stage: AnalysisStage
  output: string
  generationOutputStart: number
  timingCall: string
  part: StagePart | ''
  reading: TextStream
  narration: TextStream
  assessment: TextStream
}

export function initialModelingStream(stage: AnalysisStage): ModelingStreamState {
  return {
    stage,
    output: '',
    generationOutputStart: 0,
    timingCall: '',
    part: '',
    reading: { text: '', reasoning: '', complete: stage !== 'understand' },
    narration: { text: '', reasoning: '' },
    assessment: { text: '', reasoning: '' },
  }
}

export interface ReducedModelingEvent {
  state: ModelingStreamState
  activity?: string
  resetPart?: StagePart
}

/** Apply transport events to generation previews without touching React state. */
export function reduceModelingEvent(
  current: ModelingStreamState,
  event: AnalysisEvent,
): ReducedModelingEvent {
  let state = current
  let activity: string | undefined
  let resetPart: StagePart | undefined
  if (event.type === 'timing') {
    state = event.timing.callId === state.timingCall
      ? state
      : { ...state, timingCall: event.timing.callId, generationOutputStart: state.output.length }
  } else if (event.type === 'phase') {
    activity = event.text
    // A phase marks the start of a generation. The first delta establishes its
    // visible section so a retry can remove that section as one unit.
    state = { ...state, generationOutputStart: state.output.length }
  } else if (event.type === 'reset') {
    activity = event.text
    state = {
      ...state,
      output: state.output.slice(0, state.generationOutputStart),
      part: '',
      reading: state.stage === 'understand' ? { text: '', reasoning: '', complete: false } : state.reading,
      narration: state.stage === 'narrate' ? { text: '', reasoning: '' } : state.narration,
      assessment: state.stage === 'assess' ? { text: '', reasoning: '' } : state.assessment,
    }
    resetPart = event.part
  } else if (event.type === 'delta') {
    const part = event.part && (state.stage === 'model' || state.stage === 'compile') ? event.part : state.part
    let output = state.output
    let generationOutputStart = state.generationOutputStart
    if (part && part !== state.part && (state.stage === 'model' || state.stage === 'compile')) {
      generationOutputStart = output.length
      output += `\n\n—— ${STAGE_PART_LABELS[part]} ——\n\n`
    }
    output += event.text
    const append = (stream: TextStream): TextStream => ({
      ...stream,
      [event.reasoning ? 'reasoning' : 'text']: stream[event.reasoning ? 'reasoning' : 'text'] + event.text,
    })
    state = {
      ...state,
      output,
      generationOutputStart,
      part: part || state.part,
      reading: state.stage === 'understand' ? append(state.reading) : state.reading,
      narration: state.stage === 'narrate' ? append(state.narration) : state.narration,
      assessment: state.stage === 'assess' ? append(state.assessment) : state.assessment,
    }
  }
  return { state, activity, resetPart }
}

/** Update only transient modeling previews. Completed artifacts are set by result events. */
export function reduceModelingPreview(
  plan: ModelDesign | null,
  event: Extract<AnalysisEvent, { type: 'delta' }>,
  stage: AnalysisStage,
): ModelDesign | null {
  if (!plan || stage !== 'model' || event.reasoning === true) {
    if (!plan || stage !== 'model') return plan
    if (event.part === 'basis' && !plan.businessBasisComplete)
      return { ...plan, businessBasisReasoning: (plan.businessBasisReasoning || '') + event.text }
    if (event.part === 'design') return { ...plan, designReasoning: (plan.designReasoning || '') + event.text }
    if (event.part === 'design-check') return { ...plan, designCheckReasoning: (plan.designCheckReasoning || '') + event.text }
    return plan
  }
  if (event.part === 'basis' && !plan.businessBasisComplete)
    return { ...plan, businessBasis: (plan.businessBasis || '') + event.text }
  if (event.part === 'design') {
    if (plan.designReview?.status === 'drafting') return { ...plan, designDraft: (plan.designDraft || '') + event.text }
    if (plan.businessBasisComplete && !plan.complete) return { ...plan, plan: plan.plan + event.text }
  }
  if (event.part === 'design-check' && plan.designReview)
    return { ...plan, designReview: { ...plan.designReview, feedbackDraft: (plan.designReview.feedbackDraft || '') + event.text } }
  return plan
}

export function resetModelingPreview(plan: ModelDesign | null, part?: StagePart): ModelDesign | null {
  return plan ? resetPlanStream(plan, part) : plan
}

/** Apply durable modeling artifacts to the workspace independently of React. */
export function reduceModelingArtifact(
  project: Project,
  event: AnalysisEvent,
  businessRevision: number,
): Project {
  if (event.type === 'design-review') return {
    ...project,
    plan: {
      ...(project.plan || { plan: '', complete: false, compiled: false }),
      designReview: event.review,
      ...(event.modelDesign !== undefined
        ? { plan: event.modelDesign, complete: true, compiled: false, designDraft: undefined }
        : event.review.status === 'drafting' && event.review.round !== project.plan?.designReview?.round
          ? { designDraft: '', designReasoning: '', designCheckReasoning: '' }
          : event.review.status === 'checking' ? { designCheckReasoning: '' } : {}),
    },
    revisions: { ...project.revisions, planBasis: businessRevision },
  }
  if (event.type === 'business-basis') return {
    ...project,
    plan: {
      ...(project.plan || { plan: '', complete: false, compiled: false }),
      businessBasis: event.text,
      businessBasisComplete: true,
      ...(event.revised ? { businessBasisReasoning: undefined } : {}),
    },
    revisions: { ...project.revisions, planBasis: businessRevision },
  }
  if (event.type === 'model-design') return receiveClarifications({
    ...project,
    plan: {
      plan: event.modelDesign,
      designReview: project.plan?.designReview,
      designDraft: project.plan?.designReview?.reason === 'interrupted' ? project.plan.designDraft : undefined,
      designReasoning: project.plan?.designReasoning,
      designCheckReasoning: project.plan?.designCheckReasoning,
      basis: project.plan?.basis,
      businessBasis: project.plan?.businessBasis,
      businessBasisReasoning: project.plan?.businessBasisReasoning,
      businessBasisComplete: project.plan?.businessBasisComplete,
      complete: true,
      compiled: false,
      warnings: event.warnings,
    },
    revisions: { ...project.revisions, planBasis: businessRevision },
  }, event.clarifications, 'model')
  return project
}
