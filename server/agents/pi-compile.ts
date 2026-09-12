import { Agent, type AgentTool } from '@earendil-works/pi-agent-core'
import { Type, type AssistantMessageEvent, type Model } from '@earendil-works/pi-ai'
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions'
import type { ProviderId } from '../../shared/analysis.ts'
import type { StageOptions } from '../stages/contracts.ts'

const finishSchema = Type.Object({ json: Type.String({ description: '修复后的完整模型 JSON' }) })

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
  options: StageOptions = {},
): Promise<string> {
  const env = process.env
  let result: string | undefined
  let turns = 0
  const finishTool: AgentTool<typeof finishSchema> = {
    name: 'finish_json',
    label: '提交模型 JSON',
    description: '提交检查或修复后的完整模型 JSON，不要包含 Markdown 代码围栏。',
    parameters: finishSchema,
    execute: async (_id, args) => {
      result = args.json
      return { content: [{ type: 'text', text: '模型 JSON 已提交，等待程序校验。' }], details: { submitted: true }, terminate: true }
    },
  }
  const agent = new Agent({
    initialState: {
      systemPrompt: '你是模型 JSON 质量检查 Agent。只检查并修复 JSON 的语法、结构和与建模说明的一致性。不得重新设计业务，不得新增建模说明中没有的对象、关系、操作、能力、规则或活动；不改变已有业务含义。输出时必须调用 finish_json，参数 json 是一个完整且纯净的 JSON 对象，不要代码围栏、注释或解释。',
      model: modelFor(provider, env),
      thinkingLevel: 'minimal',
      tools: [finishTool],
    },
    streamFn: (streamModel, context, streamOptions) => streamSimple(streamModel as Model<'openai-completions'>, context, { ...streamOptions, apiKey: provider === 'gpt' ? env.GPT_API_KEY : env.LLM_API_KEY, maxTokens: 24000 }),
  })
  agent.shouldStopAfterTurn = () => turns >= 2
  agent.subscribe((event) => {
    if (event.type === 'turn_start') turns += 1
    if (event.type === 'tool_execution_start') options.onEvent?.({ type: 'phase', part: 'compile', text: 'Pi Agent 正在检查模型 JSON。' })
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') options.onEvent?.({ type: 'delta', text: event.assistantMessageEvent.delta, size: event.assistantMessageEvent.delta.length })
  })
  const abort = () => agent.abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  try {
    await agent.prompt(`建模说明：\n${semanticPlan}\n\n模型 JSON（可能无效或与说明不一致）：\n${rawJson}`)
  } finally {
    options.signal?.removeEventListener('abort', abort)
  }
  options.signal?.throwIfAborted()
  if (!result?.trim()) throw new Error('Pi Agent 未提交模型 JSON。')
  return result
}
