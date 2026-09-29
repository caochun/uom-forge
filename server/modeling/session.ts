import type { ModelingInput } from '../../shared/analysis.ts'
import type { DesignAcceptance } from '../../shared/design-acceptance.ts'
import type { DesignReview, DesignVerdict } from '../../shared/design-review.ts'
import { artifactVersion } from '../../shared/workflow.ts'
import { businessContextVersion } from '../stages/business-context.ts'

/**
 * The state owned by the modeling workflow.  Provider events and UI preview
 * text do not belong here; this object only contains accepted workflow
 * artifacts and review checkpoints.
 */
export interface ModelingSession {
  input: ModelingInput
  businessBasis: string
  acceptance?: DesignAcceptance
  design?: string
  review: DesignReview
}

export interface ReviewCheckpoint {
  design: string
  feedback: string
  verdict: DesignVerdict
  businessBasis: string
  report?: NonNullable<DesignReview['rounds'][number]['report']>
  rawReport?: string
  validationError?: string
  acceptanceVersion?: string
}

export function createModelingSession(
  input: ModelingInput,
  businessBasis: string,
): ModelingSession {
  return {
    input,
    businessBasis,
    review: {
      status: 'preparing-checks',
      round: 0,
      rounds: [],
      narrativeVersion: artifactVersion(input.narrative),
      sourceVersion: businessContextVersion(input),
      businessBasisVersion: artifactVersion(businessBasis),
    },
  }
}

export function setAcceptance(
  session: ModelingSession,
  acceptance: DesignAcceptance,
): ModelingSession {
  return {
    ...session,
    acceptance,
    review: {
      ...session.review,
      acceptance,
      acceptanceVersion: artifactVersion(acceptance),
    },
  }
}

export function beginDesignRound(session: ModelingSession): ModelingSession {
  return {
    ...session,
    review: {
      ...session.review,
      status: 'drafting',
      round: session.review.round + 1,
      reason: undefined,
      feedbackDraft: undefined,
    },
  }
}

export function beginDesignCheck(session: ModelingSession): ModelingSession {
  return {
    ...session,
    review: {
      ...session.review,
      status: 'checking',
      feedbackDraft: '',
    },
  }
}

export function recordReview(
  session: ModelingSession,
  checkpoint: ReviewCheckpoint,
): ModelingSession {
  const { businessBasis, report, rawReport, validationError, acceptanceVersion, ...entry } = checkpoint
  return {
    ...session,
    design: checkpoint.design,
    review: {
      ...session.review,
      feedbackDraft: undefined,
      rounds: [...session.review.rounds, {
        ...entry,
        ...(report ? { report } : {}),
        ...(rawReport ? { rawReport } : {}),
        ...(validationError ? { validationError } : {}),
        businessBasis,
        businessBasisVersion: artifactVersion(businessBasis),
        ...(acceptanceVersion ? { acceptanceVersion } : {}),
      }],
    },
  }
}

export function beginBasisRepair(session: ModelingSession): ModelingSession {
  return {
    ...session,
    review: { ...session.review, status: 'repairing-basis' },
  }
}

export function replaceBusinessBasis(
  session: ModelingSession,
  businessBasis: string,
): ModelingSession {
  return {
    ...session,
    businessBasis,
    review: {
      ...session.review,
      businessBasisVersion: artifactVersion(businessBasis),
    },
  }
}

export function finishModeling(
  session: ModelingSession,
  reason: NonNullable<DesignReview['reason']>,
): ModelingSession {
  return {
    ...session,
    review: {
      ...session.review,
      status: reason === 'sufficient' ? 'completed' : 'attention',
      reason,
    },
  }
}
