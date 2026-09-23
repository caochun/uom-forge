import type {
  AnalysisRequest,
  DiscussionRequest,
  DiscussionContext,
  ChatMessage,
  ProviderId,
} from '../../shared/analysis.ts'
import { validateDocument, requireText } from './document.ts'
import { isRecord } from './values.ts'
import { parseCandidateModel } from './model.ts'
import { readDesignReview } from '../../shared/design-review.ts'
import { parseReasoningEffort } from '../providers/reasoning.ts'

export function parseAnalysisRequest(
  input: unknown,
  provider: ProviderId,
  defaultStage?: 'model',
): AnalysisRequest {
  if (!isRecord(input)) throw new Error('请求内容必须是 JSON 对象。')
  const reasoningEffort = parseReasoningEffort(provider, input.reasoningEffort)
  const selection = { provider, ...(reasoningEffort ? { reasoningEffort } : {}) }
  const stage = input.stage ?? defaultStage
  switch (stage) {
    case 'understand':
      validateDocument(input.document)
      return {
        ...selection,
        stage: 'understand',
        document: input.document,
      }
    case 'model': {
      requireText(input.narrative, '业务说明')
      if (
        input.instruction !== undefined &&
        typeof input.instruction !== 'string'
      )
        throw new Error('建模反馈必须是文本。')
      return {
        ...selection,
        stage: 'model',
        narrative: input.narrative,
        model: input.model,
        instruction: input.instruction,
      }
    }
    case 'compile':
      requireText(input.modelDesign, '建模说明')
      requireText(input.narrative, '业务说明')
      if (input.businessBasis !== undefined && typeof input.businessBasis !== 'string')
        throw new Error('业务依据必须是文本。')
      return {
        ...selection,
        stage: 'compile',
        modelDesign: input.modelDesign,
        ...(input.designReview !== undefined ? { designReview: readDesignReview(input.designReview) } : {}),
        ...(typeof input.businessBasis === 'string' ? { businessBasis: input.businessBasis } : {}),
        narrative: input.narrative,
      }
    case 'narrate':
      return {
        ...selection,
        stage: 'narrate',
        model: parseCandidateModel(input.model),
      }
    case 'assess':
      return {
        ...selection,
        stage: 'assess',
        model: parseCandidateModel(input.model),
      }
    default:
      throw new Error('未知建模阶段。')
  }
}

export function parseDiscussionRequest(
  input: unknown,
  provider: ProviderId,
): DiscussionRequest {
  if (!isRecord(input)) throw new Error('请求内容必须是 JSON 对象。')
  validateDocument(input.document)
  const rawContext = input.model ?? {}
  if (!isRecord(rawContext)) throw new Error('讨论上下文必须是对象。')
  if (
    rawContext.understanding != null &&
    typeof rawContext.understanding !== 'string'
  )
    throw new Error('业务说明必须是文本。')
  if (rawContext.review !== undefined && typeof rawContext.review !== 'string')
    throw new Error('审阅位置必须是文本。')
  const model: DiscussionContext = {
    candidate: rawContext.candidate,
    understanding: rawContext.understanding as string | null | undefined,
    review: rawContext.review,
  }
  const messages: ChatMessage[] = []
  if (!Array.isArray(input.messages)) throw new Error('讨论消息必须是数组。')
  for (const message of input.messages) {
    if (
      !isRecord(message) ||
      !['user', 'assistant'].includes(String(message.role)) ||
      typeof message.content !== 'string'
    )
      throw new Error('讨论消息格式无效。')
    messages.push({
      role: message.role as ChatMessage['role'],
      content: message.content,
    })
  }
  if (!messages.length || messages.at(-1)?.role !== 'user')
    throw new Error('请提供本轮用户问题。')
  const reasoningEffort = parseReasoningEffort(provider, input.reasoningEffort)
  return { provider, ...(reasoningEffort ? { reasoningEffort } : {}), document: input.document, model, messages }
}
