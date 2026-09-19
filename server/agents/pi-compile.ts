import { Agent, type AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'
import type { ProviderId } from '../../shared/analysis.ts'
import type { StageOptions } from '../stages/contracts.ts'
import { piSignal } from './runtime.ts'
import { createPiModel, createPiStream, throwIfPiFailed } from '../providers/pi.ts'

const jsonSchema = Type.Object({ json: Type.String({ description: '完整模型 JSON' }) })

export type JsonValidation = { valid: true } | { valid: false; error: string }

/**
 * Pi is used here as a bounded semantic gate/repairer. It never gets to
 * declare a result valid: the caller must parse and validate its JSON again.
 */
export async function checkOrRepairCompiledJson(
  rawJson: string,
  provider: ProviderId,
  initialError: string,
  validate: (json: string) => JsonValidation,
  options: StageOptions = {},
): Promise<string> {
  const env = process.env
  const deadline = piSignal(options, 'Pi JSON 修复')
  let result: string | undefined
  let turns = 0
  let last: JsonValidation = { valid: false, error: initialError }
  let lastJson = ''
  let deliveryRetryQueued = false
  let lastAssistantText = ''
  let requireTool = false
  const validateTool: AgentTool<typeof jsonSchema> = {
    name: 'validate_json',
    label: '程序校验模型 JSON',
    description: '程序检查 JSON 语法、Schema、ID 和引用；根据具体错误修复后再次调用。',
    parameters: jsonSchema,
    execute: async (_id, args) => {
      last = validate(args.json)
      lastJson = args.json
      return { content: [{ type: 'text', text: last.valid ? '程序校验通过，可以提交。' : `程序校验失败：${last.error}` }], details: last, isError: !last.valid }
    },
  }
  const finishTool: AgentTool<typeof jsonSchema> = {
    name: 'finish_json',
    label: '提交模型 JSON',
    description: '提交检查或修复后的完整模型 JSON，不要包含 Markdown 代码围栏。',
    parameters: jsonSchema,
    execute: async (_id, args) => {
      if (!last.valid || lastJson !== args.json) return { content: [{ type: 'text', text: '必须先用当前 JSON 调用 validate_json 并通过程序校验。' }], isError: true, details: { accepted: false } }
      result = args.json
      return { content: [{ type: 'text', text: '模型 JSON 已提交，等待程序校验。' }], details: { submitted: true }, terminate: true }
    },
  }
  const agent = new Agent({
    initialState: {
      systemPrompt: '你是模型 JSON 修复 Agent。只修复程序报告的 JSON 语法、结构、ID 或引用错误，不重新设计业务，不增加、删除或改写建模说明中的业务语义。第一回合必须调用 validate_json；根据具体错误定点修复，再次校验；通过后立即调用 finish_json。最多修复两次，第四回合前必须提交；不要输出解释性长文。工具参数 json 必须是完整纯 JSON。最终结果必须通过工具提交，不要把 JSON 作为普通文本回复。',
      model: createPiModel(provider, env),
      thinkingLevel: 'minimal',
      tools: [validateTool, finishTool],
    },
    streamFn: createPiStream(provider, () => requireTool, env),
  })
  agent.shouldStopAfterTurn = () => turns >= 5
  agent.subscribe((event) => {
    if (event.type === 'turn_start') turns += 1
    if (event.type === 'tool_execution_start') {
      requireTool = false
      options.onEvent?.({ type: 'phase', part: 'compile', text: 'Pi Agent 正在检查模型 JSON。' })
    }
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') options.onEvent?.({ type: 'delta', text: event.assistantMessageEvent.delta, size: event.assistantMessageEvent.delta.length })
    if (provider === 'glm' && event.type === 'message_update' && event.assistantMessageEvent.type === 'thinking_delta') options.onEvent?.({ type: 'delta', text: event.assistantMessageEvent.delta, reasoning: true })
    if (event.type === 'message_end' && event.message.role === 'assistant') lastAssistantText = event.message.content.filter((block) => block.type === 'text').map((block) => block.text).join('')
    if (event.type === 'turn_end' && event.message.role === 'assistant' && event.message.stopReason !== 'error' && event.message.stopReason !== 'aborted' && event.toolResults.length === 0 && !result && !deliveryRetryQueued) {
      deliveryRetryQueued = true
      requireTool = true
      agent.followUp({ role: 'user', content: '请不要把 JSON 作为普通文本回复。立即调用 validate_json，并将当前完整 JSON 放入 json 参数；校验通过后再调用 finish_json。', timestamp: Date.now() })
      options.onEvent?.({ type: 'phase', part: 'compile', text: 'JSON 已生成，正在请求 Agent 通过校验工具交接。' })
    }
  })
  const abort = () => agent.abort()
  deadline.signal.addEventListener('abort', abort, { once: true })
  try {
    await agent.prompt(`程序首次校验错误：\n${initialError}\n\n待修复模型 JSON：\n${rawJson}`)
  } finally {
    deadline.signal.removeEventListener('abort', abort)
    deadline.dispose()
  }
  deadline.signal.throwIfAborted()
  if (provider === 'glm') throwIfPiFailed(agent, provider, env)
  if (!result?.trim() && deliveryRetryQueued) {
    const match = lastAssistantText.match(/\{[\s\S]*\}/)
    const candidate = match?.[0]?.trim()
    if (candidate && validate(candidate).valid) result = candidate
  }
  if (!result?.trim()) throw new Error('Pi Agent 未通过提交工具交接模型 JSON。')
  return result
}
