import type {
  AnalysisRequest,
  DiscussionRequest,
  DiscussionContext,
  ChatMessage,
  ProviderId,
} from '../../shared/analysis.ts'
import { validateDocument, requireText } from './document.ts'
import { parseCandidateModel } from './model.ts'
import { isRecord } from './values.ts'

export function parseAnalysisRequest(
  input: unknown,
  provider: ProviderId,
  defaultStage?: 'model',
): AnalysisRequest {
  if (!isRecord(input)) throw new Error('请求内容必须是 JSON 对象。')
  const stage = input.stage ?? defaultStage
  switch (stage) {
    case 'understand':
      validateDocument(input.document)
      return { provider, stage: 'understand', document: input.document }
    case 'model': {
      requireText(input.narrative, '业务说明')
      if (
        input.instruction !== undefined &&
        typeof input.instruction !== 'string'
      )
        throw new Error('建模反馈必须是文本。')
      return {
        provider,
        stage: 'model',
        narrative: input.narrative,
        model: input.model,
        instruction: input.instruction,
      }
    }
    case 'compile':
      requireText(input.semanticPlan, '建模说明')
      requireText(input.narrative, '业务说明')
      return {
        provider,
        stage: 'compile',
        semanticPlan: input.semanticPlan,
        narrative: input.narrative,
      }
    case 'narrate':
      return {
        provider,
        stage: 'narrate',
        model: parseCandidateModel(input.model),
      }
    case 'assess':
      return {
        provider,
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
  return { provider, document: input.document, model, messages }
}
