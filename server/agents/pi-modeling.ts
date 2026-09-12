import { Agent, type AgentTool } from '@earendil-works/pi-agent-core'
import { Type, type AssistantMessageEvent, type Model } from '@earendil-works/pi-ai'
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions'
import type { ModelingInput, ProviderId } from '../../shared/analysis.ts'
import type { RunTurn } from '../providers/types.ts'
import type { StageOptions } from '../stages/contracts.ts'
import { semanticModelPrompt } from '../stages/prompts.ts'

const finishSchema = Type.Object({ semanticPlan: Type.String({ description: '完整建模说明 Markdown' }) })
const checkSchema = Type.Object({ semanticPlan: Type.String({ description: '当前完整建模说明 Markdown' }) })

function modelFor(provider: ProviderId, env: NodeJS.ProcessEnv): Model<'openai-completions'> {
  const model = provider === 'gpt' ? env.GPT_MODEL || 'gpt-6-astra' : env.LLM_MODEL || 'deepseek-chat'
  const endpoint = provider === 'gpt' ? env.GPT_API_URL : env.LLM_API_URL
  if (!endpoint) throw new Error(`${provider === 'gpt' ? 'GPT' : 'DeepSeek'} 未配置 API URL。`)
  return { id: model, name: model, api: 'openai-completions', provider: provider === 'gpt' ? 'openai' : 'deepseek', baseUrl: endpoint.replace(/\/chat\/completions\/?$/, ''), reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 24000 }
}

function parseResult(text: string): { gaps?: { id?: unknown; status?: unknown; note?: unknown }[] } {
  try { return JSON.parse(text) }
  catch { const match = text.match(/\{[\s\S]*\}/); if (!match) throw new Error('建模覆盖评估没有返回有效 JSON。'); return JSON.parse(match[0]) }
}

async function checkPlan(plan: string, narrative: string, runTurn: RunTurn, provider: ProviderId, signal?: AbortSignal) {
  const prompt = `你是独立的本体建模评估员。只检查候选建模说明是否能表达业务理解中的关键主体、业务事项、可持续管理对象、业务事实联系、业务操作、只读能力、规则和端到端过程。不要重新设计模型，不评价格式。对每个编号返回 complete、partial 或 uncovered；partial/uncovered 必须说明缺口。只输出 JSON：{"gaps":[{"id":"...","status":"complete|partial|uncovered","note":"..."}]}。候选模型中的每个关键定义或过程至少对应一个编号。
业务理解：\n${narrative}\n\n候选建模说明：\n${plan}`
  const result = parseResult(await runTurn(prompt, { provider, signal, outputFormat: 'json' }))
  return (result.gaps || []).filter((gap) => gap.status !== 'complete').map((gap) => ({ id: String(gap.id || 'model-semantic-gap'), status: String(gap.status || 'uncovered'), note: String(gap.note || '未说明缺口') }))
}

export async function runPiModeling(input: ModelingInput, runTurn: RunTurn, options: StageOptions = {}): Promise<string> {
  const provider = options.provider || 'gpt'
  const env = process.env
  const model = modelFor(provider, env)
  let finished: string | undefined
  let checked = ''
  let gaps: { id: string; status: string; note: string }[] = []
  let checks = 0
  let turns = 0
  let accepting = false
  const finishTool: AgentTool<typeof finishSchema> = { name: 'finish_modeling', label: '提交建模说明', description: '提交完整的候选建模说明；必须先通过独立检查。', parameters: finishSchema, execute: async (_id, args) => {
    if (checked !== args.semanticPlan) return { content: [{ type: 'text', text: '请先用当前文本调用 check_modeling。' }], isError: true, details: { accepted: false } }
    if (gaps.length && !accepting) return { content: [{ type: 'text', text: `仍有 ${gaps.length} 个建模缺口，请增量修正后重新检查。` }], isError: true, details: { gaps, accepted: false } }
    finished = args.semanticPlan
    return { content: [{ type: 'text', text: accepting ? '建模说明已保留并标记待复核。' : '建模说明已提交。' }], details: { reviewRequired: accepting, gaps }, terminate: true }
  } }
  const checkTool: AgentTool<typeof checkSchema> = { name: 'check_modeling', label: '检查业务过程支撑', description: '提交当前建模说明，由独立评估器检查业务语义覆盖和过程支撑。', parameters: checkSchema, execute: async (_id, args) => {
    checks += 1; checked = args.semanticPlan; options.onEvent?.({ type: 'phase', part: 'semantic', text: '正在独立检查候选模型对业务的支撑。' }); gaps = await checkPlan(args.semanticPlan, input.narrative, runTurn, provider, options.signal); accepting = gaps.length > 0 && checks >= 2
    return { content: [{ type: 'text', text: gaps.length ? `发现 ${gaps.length} 个建模缺口，请增量修正。` : '候选模型已覆盖业务理解中的关键语义。' }], details: { gaps, check: checks } }
  } }
  const agent = new Agent({ initialState: { systemPrompt: '你是业务本体建模 Agent。依据业务理解生成候选建模说明，不输出 JSON。先调用 check_modeling，再根据独立评估缺口增量修正，最后调用 finish_modeling。保持对象、关系、业务操作、只读能力、规则和完整业务过程的语义边界；不要因格式需要发明业务概念。', model, thinkingLevel: 'minimal', tools: [checkTool, finishTool] }, streamFn: (streamModel, context, streamOptions) => streamSimple(streamModel as Model<'openai-completions'>, context, { ...streamOptions, apiKey: provider === 'gpt' ? env.GPT_API_KEY : env.LLM_API_KEY, maxTokens: 24000 }) })
  agent.shouldStopAfterTurn = () => turns >= 6
  agent.subscribe((event) => { if (event.type === 'turn_start') turns += 1; if (event.type === 'tool_execution_start') options.onEvent?.({ type: 'phase', part: 'semantic', text: event.toolName === 'check_modeling' ? 'Pi Agent 正在检查候选模型。' : event.toolName === 'finish_modeling' ? 'Pi Agent 正在提交建模说明。' : `Pi Agent 正在执行 ${event.toolName}。` }); if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') options.onEvent?.({ type: 'delta', text: event.assistantMessageEvent.delta, size: event.assistantMessageEvent.delta.length }) })
  options.onEvent?.({ type: 'phase', part: 'semantic', text: 'Pi Agent 正在形成候选建模说明。' })
  const abort = () => agent.abort(); options.signal?.addEventListener('abort', abort, { once: true })
  try { await agent.prompt(semanticModelPrompt(input)) } finally { options.signal?.removeEventListener('abort', abort) }
  options.signal?.throwIfAborted(); if (!finished?.trim()) throw new Error('Pi Agent 未提交建模说明。'); return finished
}
