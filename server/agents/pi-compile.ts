import { Agent, type AgentTool } from '@earendil-works/pi-agent-core'
import { Type, type Model } from '@earendil-works/pi-ai'
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions'
import type { ProviderId } from '../../shared/analysis.ts'
import type { StageOptions } from '../stages/contracts.ts'
import { piSignal } from './runtime.ts'

const jsonSchema = Type.Object({ json: Type.String({ description: '完整模型 JSON' }) })

export type JsonValidation = { valid: true } | { valid: false; error: string }

function modelFor(provider: ProviderId, env: NodeJS.ProcessEnv): Model<'openai-completions'> {
  const model = provider === 'gpt' ? env.GPT_MODEL || 'gpt-6-astra' : env.LLM_MODEL || 'deepseek-chat'
  const endpoint = provider === 'gpt' ? env.GPT_API_URL : env.LLM_API_URL
  if (!endpoint) throw new Error(`${provider === 'gpt' ? 'GPT' : 'DeepSeek'} 未配置 API URL。`)
  return { id: model, name: model, api: 'openai-completions', provider: provider === 'gpt' ? 'openai' : 'deepseek', baseUrl: endpoint.replace(/\/chat\/completions\/?$/, ''), reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 24000 }
}

/**
 * Pi is used here as a bounded semantic gate/repairer. It never gets to
 * declare a result valid: the caller must parse and validate its JSON again.
 */
export async function checkOrRepairCompiledJson(
  semanticPlan: string,
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
      systemPrompt: '你是模型 JSON 修复 Agent。只修复程序报告的 JSON 语法、结构、ID 或引用错误，不重新设计业务，不增加、删除或改写建模说明中的业务语义。先调用 validate_json；根据具体错误定点修复，再次校验；通过后调用 finish_json。工具参数 json 必须是完整纯 JSON。',
      model: modelFor(provider, env),
      thinkingLevel: 'minimal',
      tools: [validateTool, finishTool],
    },
    streamFn: (streamModel, context, streamOptions) => streamSimple(streamModel as Model<'openai-completions'>, context, { ...streamOptions, apiKey: provider === 'gpt' ? env.GPT_API_KEY : env.LLM_API_KEY, maxTokens: 24000 }),
  })
  agent.shouldStopAfterTurn = () => turns >= 3
  agent.subscribe((event) => {
    if (event.type === 'turn_start') turns += 1
    if (event.type === 'tool_execution_start') options.onEvent?.({ type: 'phase', part: 'compile', text: 'Pi Agent 正在检查模型 JSON。' })
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') options.onEvent?.({ type: 'delta', text: event.assistantMessageEvent.delta, size: event.assistantMessageEvent.delta.length })
  })
  const abort = () => agent.abort()
  deadline.signal.addEventListener('abort', abort, { once: true })
  try {
    await agent.prompt(`建模说明（只作为语义边界）：\n${semanticPlan}\n\n程序首次校验错误：\n${initialError}\n\n待修复模型 JSON：\n${rawJson}`)
  } finally {
    deadline.signal.removeEventListener('abort', abort)
    deadline.dispose()
  }
  deadline.signal.throwIfAborted()
  if (!result?.trim()) throw new Error('Pi Agent 未提交模型 JSON。')
  return result
}
