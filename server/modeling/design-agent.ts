import { Agent, type AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'
import { DEFAULT_PROVIDER, type ModelingInput } from '../../shared/analysis.ts'
import type { DesignReview } from '../../shared/design-review.ts'
import { designReviewLabel } from '../../shared/design-review.ts'
import { artifactVersion } from '../../shared/workflow.ts'
import {
  beginBasisRepair,
  beginDesignCheck,
  beginDesignRound,
  createModelingSession,
  finishModeling,
  recordReview,
  replaceBusinessBasis,
  setAcceptance,
  type ModelingSession,
} from './session.ts'
import type { StageOptions } from '../stages/contracts.ts'
import { scopedTurn } from '../stages/contracts.ts'
import type { RunTurn } from '../providers/types.ts'
import {
  basisRevisionMessage,
  designRevisionMessage,
  EXPRESSION_CHECK_DESCRIPTION,
  MAX_DESIGN_ROUNDS,
  MODELING_SYSTEM_PROMPT,
} from './design-check.ts'
import { modelDesignPrompt } from '../prompts/modeling.ts'
import { normalizeModelPlan } from '../stages/markdown-sections.ts'
import { designReviewPrompt } from '../stages/design-review.ts'
import { prepareDesignAcceptance } from '../stages/design-acceptance.ts'
import { parseDesignCheckReport, checkedDesignVerdict, designCheckMarkdown } from '../validation/design-acceptance.ts'
import type { DesignAcceptance } from '../../shared/design-acceptance.ts'
import { prepareBusinessBasis } from '../stages/business-basis.ts'
import { createPiModel, createPiStream, throwIfPiFailed } from '../llm/pi/runtime.ts'
import { piSignal } from '../agents/runtime.ts'

export { MODELING_SYSTEM_PROMPT, EXPRESSION_CHECK_DESCRIPTION, designRevisionMessage, basisRevisionMessage } from './design-check.ts'

export async function runPiModeling(
  input: ModelingInput, runTurn: RunTurn, options: StageOptions, businessBasis: string,
): Promise<{ modelDesign: string; designReview: DesignReview; businessBasis: string }> {
  const provider = options.provider || DEFAULT_PROVIDER
  const model = createPiModel(provider, process.env, options.reasoningEffort)
  const streamFn = createPiStream(provider, () => false, process.env, options.reasoningEffort,
    event => options.onEvent?.({ ...event, part: 'design' }))
  const deadline = piSignal(options, 'Pi 模型设计')
  let design = ''
  let turnDesign = ''
  let checkedTurn = 0
  let acceptance: DesignAcceptance
  let session: ModelingSession = createModelingSession(input, businessBasis)
  let review: DesignReview = session.review
  const updateSession = (next: ModelingSession) => {
    session = next
    review = session.review
    businessBasis = session.businessBasis
  }
  const updateReview = (change: (current: DesignReview) => DesignReview) =>
    updateSession({ ...session, review: change(session.review) })
  const publish = (modelDesign?: string) => {
    options.onEvent?.({ type: 'design-review', part: 'design', review: structuredClone(review),
      ...(modelDesign !== undefined ? { modelDesign } : {}) })
  }
  const stop = (reason: NonNullable<DesignReview['reason']>) => {
    updateSession(finishModeling(session, reason))
    publish()
    options.onEvent?.({ type: 'phase', part: 'design', text: designReviewLabel(review) })
  }
  const terminal = () => review.status === 'completed' || review.status === 'attention'
  // Structured review data is rendered after validation, never streamed as JSON into the design UI.
  const reviewOptions = () => {
    const scoped = scopedTurn({ ...options, signal: deadline.signal }, 'design-check')
    return { ...scoped, outputFormat: 'json' as const, onEvent: (event: Parameters<NonNullable<typeof scoped.onEvent>>[0]) => {
      if (event.type !== 'delta' || event.reasoning) scoped.onEvent?.(event)
    } }
  }
  const feedback = () => {
    const last = review.rounds.at(-1)
    return last?.businessBasisVersion !== review.businessBasisVersion && last
      ? basisRevisionMessage(last.feedback, businessBasis)
      : last?.feedback || '检查没有完成，保留当前设计供审阅。'
  }
  const check = async () => {
    deadline.signal.throwIfAborted()
    if (checkedTurn === review.round || terminal()) return
    checkedTurn = review.round
    if (!turnDesign) { stop('no-progress'); return }
    if (review.rounds.some(round => round.design === design && round.businessBasisVersion === artifactVersion(businessBasis))) { stop('no-progress'); return }
    updateSession(beginDesignCheck(session))
    publish(design)
    options.onEvent?.({ type: 'phase', part: 'design-check', text: designReviewLabel(review) })
    try {
      const raw = await runTurn(designReviewPrompt(businessBasis, design, review.rounds, input, acceptance), reviewOptions())
      deadline.signal.throwIfAborted()
      let report
      try {
        report = parseDesignCheckReport(raw, acceptance, design, businessBasis, input,
          review.rounds.flatMap(r => r.report ? [r.report] : []))
      } catch (error) {
        const validationError = error instanceof Error ? error.message : String(error)
        updateSession(recordReview(session, {
          design,
          feedback: `检查报告未通过程序校验：${validationError} 原始报告已保留，不能认定设计通过。`,
          verdict: 'unknown',
          rawReport: raw,
          validationError,
          businessBasis,
          acceptanceVersion: review.acceptanceVersion,
        }))
        stop('unrecognized')
        return
      }
      const verdict = checkedDesignVerdict(report)
      const text = designCheckMarkdown(report, acceptance)
      updateSession(recordReview(session, {
        design,
        feedback: text,
        verdict,
        report,
        businessBasis,
        acceptanceVersion: review.acceptanceVersion,
      }))
      if (verdict === 'sufficient') stop('sufficient')
      else if (verdict === 'clarify') stop('clarify')
      else if (verdict === 'unknown') stop('unrecognized')
      else if (review.round >= MAX_DESIGN_ROUNDS) stop('limit')
      else if (verdict === 'basis-revise') {
        updateSession(beginBasisRepair(session))
        publish()
        const corrected = await prepareBusinessBasis(input.narrative, { ...options, signal: deadline.signal }, input.sources, { previous: businessBasis, feedback: text })
        deadline.signal.throwIfAborted()
        if (corrected.trim() === businessBasis.trim()) { stop('basis-unchanged'); return }
        updateSession(replaceBusinessBasis(session, corrected))
        publish()
      }
      else publish()
    } catch (error) {
      deadline.signal.throwIfAborted()
      updateReview(current => ({ ...current, failure: error instanceof Error ? error.message : String(error) }))
      stop(review.status === 'repairing-basis' ? 'basis-unavailable' : 'unavailable')
    }
  }
  const parameters = Type.Object({})
  const tool: AgentTool<typeof parameters> = {
    name: 'check_expression', label: '检查设计的业务表达',
    description: EXPRESSION_CHECK_DESCRIPTION,
    parameters,
    execute: async () => {
      await check()
      return { content: [{ type: 'text', text: feedback() }], details: {}, terminate: terminal() }
    },
  }
  const agent = new Agent({
    initialState: {
      systemPrompt: MODELING_SYSTEM_PROMPT,
      model, thinkingLevel: 'minimal', tools: [tool],
    },
    // Auto permits design text in the same response and needs no forced handoff.
    streamFn, toolExecution: 'sequential',
  })
  agent.subscribe(event => {
    if (event.type === 'message_start' && event.message.role === 'assistant') {
      turnDesign = ''
      updateSession(beginDesignRound(session))
      publish()
      options.onEvent?.({ type: 'phase', part: 'design', text: designReviewLabel(review) })
    }
    if (event.type === 'message_update') {
      const update = event.assistantMessageEvent
      if (update.type === 'text_delta') options.onEvent?.({ type: 'delta', part: 'design', text: update.delta, size: update.delta.length })
      if (update.type === 'thinking_delta') options.onEvent?.({ type: 'delta', part: 'design', text: update.delta, reasoning: true })
    }
    if (event.type === 'message_end' && event.message.role === 'assistant' &&
      (event.message.stopReason === 'stop' || event.message.stopReason === 'toolUse')) {
      turnDesign = normalizeModelPlan(event.message.content.filter(block => block.type === 'text').map(block => block.text).join('').trim())
      if (turnDesign) {
        design = turnDesign
        updateReview(current => ({ ...current, planVersion: artifactVersion(design) }))
        publish(design)
      }
    }
  })
  agent.shouldStopAfterTurn = async ({ message }) => {
    if (message.stopReason === 'error' || message.stopReason === 'aborted') return true
    if (message.stopReason === 'length') { stop('interrupted'); return true }
    if (terminal()) return true
    const called = checkedTurn === review.round
    // Some providers return text without a tool call. Review it directly instead
    // of spending a turn asking them to resubmit the same artifact.
    await check()
    if (terminal()) return true
    if (!called) agent.followUp({ role: 'user', content: designRevisionMessage(feedback()), timestamp: Date.now() })
    return false
  }
  const abort = () => agent.abort()
  deadline.signal.addEventListener('abort', abort, { once: true })
  try {
    deadline.signal.throwIfAborted()
    publish()
    options.onEvent?.({ type: 'phase', part: 'design-check', text: designReviewLabel(review) })
    try {
      // Deliberately exclude currentModel and user expression feedback from this call.
      acceptance = await prepareDesignAcceptance({ narrative: input.narrative, sources: input.sources }, runTurn, reviewOptions())
      deadline.signal.throwIfAborted()
    } catch (error) {
      deadline.signal.throwIfAborted()
      updateReview(current => ({ ...current, failure: error instanceof Error ? error.message : String(error) }))
      stop('acceptance-unavailable')
      throw new Error(`业务验收清单未完成：${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
    updateSession(setAcceptance(session, acceptance))
    publish()
    await agent.prompt(modelDesignPrompt(input, businessBasis, acceptance))
    deadline.signal.throwIfAborted()
    throwIfPiFailed(agent, provider)
    if (!design) throw new Error('未返回模型设计。')
    return { modelDesign: design, designReview: review, businessBasis: session.businessBasis }
  } catch (error) {
    if (!terminal()) stop('interrupted')
    deadline.signal.throwIfAborted()
    if (!design) throw error
    return { modelDesign: design, designReview: review, businessBasis: session.businessBasis }
  } finally {
    deadline.signal.removeEventListener('abort', abort)
    deadline.dispose()
  }
}
