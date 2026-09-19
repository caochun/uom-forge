import { CHECK_METHOD } from '../stages/methodology.ts'
import { Agent, type AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'
import type { ModelingInput, ProviderId } from '../../shared/analysis.ts'
import type { RunTurn } from '../providers/types.ts'
import type { StageOptions } from '../stages/contracts.ts'
import { semanticModelPrompt } from '../stages/prompts.ts'
import { piSignal } from './runtime.ts'
import { createPiModel, createPiStream, throwIfPiFailed } from '../providers/pi.ts'
import { buildSemanticPreparation } from '../stages/semantic.ts'
import type { SemanticPlanV2 } from '../../shared/semantic.ts'
import { validateSemanticPlan } from '../validation/semantic.ts'
import { containsBasis, questionKey } from '../../shared/clarifications.ts'

const finishSchema = Type.Object({ semanticPlan: Type.String({ description: '完整建模说明 Markdown' }) })
const checkSchema = Type.Object({ semanticPlan: Type.String({ description: '当前完整建模说明 Markdown' }) })
const clarifySchema = Type.Object({
  question: Type.String({ description: '需要用户回答的业务问题' }),
  basis: Type.String({ description: '当前业务理解中的原句依据' }),
  ambiguity: Type.String({ description: '至少两种有依据的业务解释' }),
  impact: Type.String({ description: '不同答案分别如何改变本轮模型' }),
  options: Type.Optional(Type.Array(Type.String(), { description: '可选答案' })),
  multiple: Type.Optional(Type.Boolean({ description: '是否允许多选' })),
})
const REQUIRED_SECTIONS = [
  '## 模型概述',
  '## 对象及边界',
  '## 关系',
  '## 业务操作',
  '## 只读能力',
  '## 业务规则',
  '## 业务过程',
]

function parseResult(text: string): { checked?: unknown; gaps?: { id?: unknown; status?: unknown; note?: unknown }[] } {
  try { return JSON.parse(text) }
  catch { const match = text.match(/\{[\s\S]*\}/); if (!match) throw new Error('建模覆盖评估没有返回有效 JSON。'); return JSON.parse(match[0]) }
}

async function checkPlan(plan: string, narrative: string, runTurn: RunTurn, provider: ProviderId, signal?: AbortSignal) {
  const prompt = `你是独立的本体建模评估员。${CHECK_METHOD}
只检查候选建模说明能否支撑业务理解中的核心业务过程，不重新设计模型，也不评价格式。先选择最能区分对象边界、关系上下文、业务分支、状态变化和持久记录的代表性业务情形，判断候选说明能否表达这些事实；不追求穷尽，也不要因为缺少技术字段或另一种可选设计而提出缺口。确有依据且影响核心过程表达的遗漏或混淆才放入 gaps；note 写明业务依据、具体情形、已有表达及缺失的绑定，不把设计偏好作为缺口。只输出 JSON：{"checked":true,"gaps":[{"id":"...","status":"partial|uncovered","note":"..."}]}。不得省略 checked 字段，不得用空结果代替未检查。
业务理解：\n${narrative}\n\n候选建模说明：\n${plan}`
  const result = parseResult(await runTurn(prompt, { provider, signal, outputFormat: 'json' }))
  if (result.checked !== true || !Array.isArray(result.gaps))
    throw new Error('建模独立检查结果不完整，未确认检查了候选模型的全部语义。')
  return (result.gaps || []).filter((gap) => gap.status !== 'complete').map((gap) => ({ id: String(gap.id || 'model-semantic-gap'), status: String(gap.status || 'uncovered'), note: String(gap.note || '未说明缺口') }))
}

export async function runPiModeling(
  input: ModelingInput,
  runTurn: RunTurn,
  options: StageOptions = {},
  prepared?: SemanticPlanV2,
): Promise<string> {
  const provider = options.provider || 'gpt'
  const env = process.env
  const deadline = piSignal(options, 'Pi 语义建模')
  const model = createPiModel(provider, env)
  let finished: string | undefined
  let gaps: { id: string; status: string; note: string }[] = []
  let checks = 0
  let turns = 0
  let deliveryRetryQueued = false
  let lastAssistantText = ''
  let requireTool = false
  const finishTool: AgentTool<typeof finishSchema> = { name: 'finish', label: '提交建模说明', description: '提交你认为能够支撑核心业务过程的完整候选建模说明；必要时先使用独立检查意见修正。', parameters: finishSchema, execute: async (_id, args) => {
    finished = args.semanticPlan
    return { content: [{ type: 'text', text: gaps.length ? '建模说明已提交，独立检查意见保留供复核。' : '建模说明已提交。' }], details: { reviewRequired: gaps.length > 0, gaps }, terminate: true }
  } }
  const checkTool: AgentTool<typeof checkSchema> = { name: 'check_expression', label: '检查业务过程支撑', description: '可选地提交当前建模说明，由独立评估器指出影响核心业务过程表达的缺口；检查结果是修正建议，不是新增业务事实。', parameters: checkSchema, execute: async (_id, args) => {
    checks += 1; options.onEvent?.({ type: 'phase', part: 'semantic', text: '正在独立检查候选模型对业务的支撑。' }); gaps = await checkPlan(args.semanticPlan, input.narrative, runTurn, provider, deadline.signal)
    const text = gaps.length
      ? `独立检查发现 ${gaps.length} 个可能影响核心业务表达的缺口。请判断哪些确有依据，必要时修正；也可以保留合理的模型边界后提交。`
      : '独立检查未发现影响核心业务表达的缺口，可以提交建模说明。'
    return { content: [{ type: 'text', text }], details: { gaps, check: checks, submitNow: checks >= 2 || gaps.length === 0 } }
  } }
  let semantic: SemanticPlanV2
  try {
    semantic = prepared || await buildSemanticPreparation(input.narrative, runTurn, { ...options, signal: deadline.signal })
  } catch (error) {
    deadline.dispose()
    throw error
  }
  let clarificationsAdded = false
  const clarifyTool: AgentTool<typeof clarifySchema> = { name: 'request_clarification', label: '登记业务澄清问题', description: '登记一个只有用户能回答、且不同答案会改变本轮模型的业务歧义。必须给出业务理解中的原句依据；登记后在建模说明中把该语义保留为未决边界，不要假设答案。', parameters: clarifySchema, execute: async (_id, args) => {
    if (!containsBasis(input.narrative, args.basis))
      return { content: [{ type: 'text', text: '依据必须是当前业务理解中的原句，未登记。' }], details: { recorded: false } }
    const entry = {
      text: args.question.trim(),
      basis: args.basis.trim(),
      ambiguity: args.ambiguity.trim(),
      impact: args.impact.trim(),
      options: args.options || [],
      multiple: args.multiple === true,
    }
    const duplicate = semantic.clarifications.some((item) => questionKey(item.text) === questionKey(entry.text))
    if (!duplicate) {
      try {
        semantic = validateSemanticPlan(
          { ...semantic, clarifications: [...semantic.clarifications, entry] },
          input.narrative,
        )
        clarificationsAdded = true
      } catch (error) {
        return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], details: { recorded: false } }
      }
    }
    options.onEvent?.({ type: 'phase', part: 'semantic', text: '已登记待用户确认的业务澄清问题。' })
    return { content: [{ type: 'text', text: duplicate ? '同一问题已登记。' : '澄清问题已登记，请继续建模并保留未决边界。' }], details: { recorded: !duplicate } }
  } }
  const agent = new Agent({ initialState: { systemPrompt: '你是业务本体建模 Agent。依据业务理解、事实、故事和代表性情形形成表达充分且简洁的候选建模说明；程序校验不代表业务解释正确。先理解业务过程并构造代表性业务情形，在对象、关系、业务操作、只读能力和规则之间持续判断能否表达这些事实；只有遇到真实表达缺口时才调整模型。必要时调用 check_expression 获取独立意见。发现只有用户能回答、且不同答案会改变本轮模型的业务歧义时，调用 request_clarification 登记；不要假设答案。完成后必须调用 finish 提交完整建模说明，不要把正文作为普通回复。', model, thinkingLevel: 'minimal', tools: [checkTool, clarifyTool, finishTool] }, streamFn: createPiStream(provider, () => requireTool, env) })
  agent.shouldStopAfterTurn = () => turns >= 6
  agent.subscribe((event) => {
    if (event.type === 'turn_start') turns += 1
    if (event.type === 'tool_execution_start') {
      requireTool = false
      options.onEvent?.({ type: 'phase', part: 'semantic', text: event.toolName === 'check_expression' ? 'Pi Agent 正在检查候选模型。' : event.toolName === 'request_clarification' ? 'Pi Agent 正在登记业务澄清问题。' : event.toolName === 'finish' ? 'Pi Agent 正在提交建模说明。' : `Pi Agent 正在执行 ${event.toolName}。` })
    }
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') options.onEvent?.({ type: 'delta', text: event.assistantMessageEvent.delta, size: event.assistantMessageEvent.delta.length })
    if (provider === 'glm' && event.type === 'message_update' && event.assistantMessageEvent.type === 'thinking_delta') options.onEvent?.({ type: 'delta', text: event.assistantMessageEvent.delta, reasoning: true })
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      lastAssistantText = event.message.content.filter((block) => block.type === 'text').map((block) => block.text).join('')
    }
    if (event.type === 'turn_end' && event.message.role === 'assistant' && event.message.stopReason !== 'error' && event.message.stopReason !== 'aborted' && event.toolResults.length === 0 && !finished && !deliveryRetryQueued) {
      deliveryRetryQueued = true
      requireTool = true
      agent.followUp({ role: 'user', content: '你已经生成了建模说明。请不要再次直接输出正文，立即调用 finish，并将上一轮的完整建模说明原样放入 semanticPlan 参数。', timestamp: Date.now() })
      options.onEvent?.({ type: 'phase', part: 'semantic', text: '建模说明已生成，正在请求 Agent 通过提交工具交接。' })
    }
  })
  options.onEvent?.({ type: 'phase', part: 'semantic', text: 'Pi Agent 正在形成候选建模说明。' })
  const abort = () => agent.abort(); deadline.signal.addEventListener('abort', abort, { once: true })
  try { await agent.prompt(semanticModelPrompt(input, 'tool', semantic)) } finally { deadline.signal.removeEventListener('abort', abort); deadline.dispose() }
  deadline.signal.throwIfAborted()
  if (provider === 'glm') throwIfPiFailed(agent, provider, env)
  if (!finished?.trim() && deliveryRetryQueued && REQUIRED_SECTIONS.every((section) => lastAssistantText.includes(section))) finished = lastAssistantText
  if (!finished?.trim()) throw new Error('Pi Agent 未通过提交工具交接建模说明。')
  semantic = validateSemanticPlan(semantic, input.narrative)
  if (clarificationsAdded) options.onEvent?.({ type: 'semantic-plan', part: 'semantic', semantic })
  return finished
}
