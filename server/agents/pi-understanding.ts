import { Agent, type AgentTool } from '@earendil-works/pi-agent-core'
import { Type, type AssistantMessageEvent, type Model } from '@earendil-works/pi-ai'
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions'
import type { BusinessDocument, ProviderId } from '../../shared/analysis.ts'
import type { StageOptions } from '../stages/contracts.ts'
import type { RunTurn } from '../providers/types.ts'

const SECTION_NAMES = [
  '业务概述',
  '业务输入',
  '业务主体与业务事项',
  '可持续管理的资源和业务产出',
  '业务事实与对象联系',
  '业务过程与状态变化',
  '判断规则与计算依据',
  '临时计算结果',
  '不确定事项',
] as const

const finishSchema = Type.Object({
  narrative: Type.String({ description: '完整的业务理解 Markdown' }),
})

type FinishArgs = { narrative: string }
const coverageStatus = Type.Union([
  Type.Literal('complete'),
  Type.Literal('partial'),
  Type.Literal('uncovered'),
])
const checkSchema = Type.Object({
  coverage: Type.Array(
    Type.Object({
      blockId: Type.String(),
      status: coverageStatus,
      note: Type.String(),
    }),
  ),
})
type CoverageArgs = {
  coverage: { blockId: string; status: 'complete' | 'partial' | 'uncovered'; note: string }[]
}

type CriticResult = {
  coverage?: { blockId?: unknown; status?: unknown; note?: unknown }[]
}

function parseJsonObject(text: string): CriticResult {
  try {
    return JSON.parse(text) as CriticResult
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('覆盖评估没有返回有效 JSON。')
    return JSON.parse(match[0]) as CriticResult
  }
}

export async function independentlyCheck(
  narrative: string,
  sourceBlocks: { id: string; text: string }[],
  runTurn: RunTurn,
  provider: ProviderId,
  signal?: AbortSignal,
): Promise<{ id: string; text: string; status: string; note: string }[]> {
  const prompt = `你是独立的业务说明覆盖评估员。只判断业务说明是否表达了原文证据块中的业务事实，不评价文风，也不补写业务。
对每个 blockId 返回 complete、partial 或 uncovered：complete 表示业务说明明确表达了该块的主要事实及限制；partial 表示只表达了一部分；uncovered 表示没有表达。不要因为语义相近就忽略关键条件、数字、例外或主体。只输出 JSON：{"coverage":[{"blockId":"...","status":"complete|partial|uncovered","note":"简短说明"}]}。

业务说明：
${narrative}

原文证据块：
${sourceBlocks.map((block) => `[${block.id}] ${block.text}`).join('\n')}`
  const raw = await runTurn(prompt, { provider, signal, outputFormat: 'json' })
  const result = parseJsonObject(raw)
  const byId = new Map(
    (result.coverage || []).map((item) => [
      String(item.blockId || ''),
      { status: String(item.status || 'uncovered'), note: String(item.note || '') },
    ]),
  )
  return sourceBlocks
    .filter((block) => byId.get(block.id)?.status !== 'complete')
    .map((block) => ({
      id: block.id,
      text: block.text,
      status: byId.get(block.id)?.status || 'missing',
      note: byId.get(block.id)?.note || '独立评估未返回该证据块。',
    }))
}

function modelFor(provider: ProviderId, env: NodeJS.ProcessEnv): Model<'openai-completions'> {
  const model = provider === 'gpt' ? env.GPT_MODEL || 'gpt-6-astra' : env.LLM_MODEL || 'deepseek-chat'
  const endpoint = provider === 'gpt' ? env.GPT_API_URL : env.LLM_API_URL
  if (!endpoint) throw new Error(`${provider === 'gpt' ? 'GPT' : 'DeepSeek'} 未配置 API URL。`)
  const baseUrl = endpoint.replace(/\/chat\/completions\/?$/, '')
  return {
    id: model,
    name: model,
    api: 'openai-completions',
    provider: provider === 'gpt' ? 'openai' : 'deepseek',
    baseUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 24000,
  }
}

function textFromEvent(event: AssistantMessageEvent): string | undefined {
  return event.type === 'text_delta' ? event.delta : undefined
}

function emitDelta(options: StageOptions, text: string): void {
  options.onEvent?.({ type: 'delta', text, size: text.length })
}

/**
 * Opt-in Pi Agent runtime for the understanding stage. The runtime owns the
 * plan/check/revise loop; UOM still owns section requirements and persistence.
 */
export async function runPiUnderstanding(
  document: BusinessDocument,
  provider: ProviderId,
  runTurn: RunTurn,
  options: StageOptions = {},
): Promise<string> {
  const env = process.env
  const model = modelFor(provider, env)
  let finished: string | undefined
  let checks = 0
  let turns = 0
  let coverageComplete = false
  let independentAttempts = 0
  let lastIndependentGaps: { id: string; text: string; status: string; note: string }[] = []
  const sourceBlocks = document.blocks.map((block) => ({
    id: block.id,
    text: block.text,
  }))
  const sourceById = new Map(sourceBlocks.map((block) => [block.id, block.text]))
  const finishTool: AgentTool<typeof finishSchema> = {
    name: 'finish_understanding',
    label: '提交业务理解',
    description: '提交完整业务理解。只有覆盖所有要求的语义段落后才能调用。',
    parameters: finishSchema,
    execute: async (_id, args: FinishArgs) => {
      if (!checks) {
        return {
          content: [{ type: 'text', text: '请先调用 check_understanding。' }],
          isError: true,
          details: { accepted: false },
        }
      }
      if (!coverageComplete) {
        return {
          content: [{ type: 'text', text: '覆盖检查仍有缺口，请先补齐原文证据块。' }],
          isError: true,
          details: { accepted: false },
        }
      }
      // The Agent's self-reported coverage is only a plan. Re-evaluate the
      // submitted narrative independently before accepting it.
      options.onEvent?.({
        type: 'phase',
        part: 'reading',
        text: '正在由独立评估器复核原文覆盖度。',
      })
      independentAttempts += 1
      lastIndependentGaps = await independentlyCheck(
        args.narrative,
        sourceBlocks,
        runTurn,
        provider,
        options.signal,
      )
      if (lastIndependentGaps.length) {
        // Do not let an uncertain critic make the whole stage unfinishable.
        // Give the Agent one repair opportunity; on the second failed review,
        // accept the narrative with an explicit warning in the event stream.
        if (independentAttempts >= 2) {
          options.onEvent?.({
            type: 'phase',
            part: 'reading',
            text: `独立评估仍发现 ${lastIndependentGaps.length} 个覆盖缺口，保留结果并标记为待复核。`,
          })
          finished = args.narrative
          return {
            content: [{ type: 'text', text: '已保留业务理解；独立评估缺口将作为待复核提示。' }],
            details: {
              accepted: true,
              reviewRequired: true,
              incomplete: lastIndependentGaps.slice(0, 24),
              omitted: Math.max(0, lastIndependentGaps.length - 24),
              independentAttempts,
            },
            terminate: true,
          }
        }
        coverageComplete = false
        return {
          content: [{ type: 'text', text: `独立评估发现 ${lastIndependentGaps.length} 个证据块仍未完整覆盖，请补充后再次提交。` }],
          isError: true,
          details: {
            accepted: false,
            incomplete: lastIndependentGaps.slice(0, 24),
            omitted: Math.max(0, lastIndependentGaps.length - 24),
          },
        }
      }
      finished = args.narrative
      return {
        content: [{ type: 'text', text: '业务理解已提交。' }],
        details: { narrative: args.narrative },
        terminate: true,
      }
    },
  }
  const checkTool: AgentTool<typeof checkSchema> = {
    name: 'check_understanding',
    label: '检查业务理解覆盖度',
    description: '逐个检查原文证据块在业务理解中的覆盖情况。每个原文块都必须提交 complete、partial 或 uncovered。',
    parameters: checkSchema,
    execute: async (_id, args: CoverageArgs) => {
      checks += 1
      const seen = new Set<string>()
      const invalid: string[] = []
      const incomplete: { id: string; text: string; status: string; note: string }[] = []
      for (const item of args.coverage) {
        if (!sourceById.has(item.blockId) || seen.has(item.blockId)) {
          invalid.push(item.blockId)
          continue
        }
        seen.add(item.blockId)
        if (item.status !== 'complete')
          incomplete.push({
            id: item.blockId,
            text: sourceById.get(item.blockId) || '',
            status: item.status,
            note: item.note,
          })
      }
      for (const block of sourceBlocks) {
        if (!seen.has(block.id))
          incomplete.push({
            id: block.id,
            text: block.text,
            status: 'missing',
            note: '未提交覆盖判断',
          })
      }
      coverageComplete = incomplete.length === 0 && !invalid.length
      return {
        content: [{
          type: 'text',
          text: coverageComplete
            ? '所有原文证据块均已判断为完整覆盖。'
            : `发现 ${incomplete.length} 个证据块未完整覆盖${invalid.length ? `，${invalid.length} 个无效 blockId` : ''}。请根据返回的原文补充业务理解。`,
        }],
        details: {
          incomplete: incomplete.slice(0, 24),
          omitted: Math.max(0, incomplete.length - 24),
          invalid,
          check: checks,
        },
      }
    },
  }
  const systemPrompt = `你是业务分析 Agent。你的任务是理解业务文档，不设计对象关系模型。
先形成完整业务理解，调用 check_understanding 逐个检查原文证据块覆盖度；根据工具返回的原文缺口修正，再次检查，最后调用 finish_understanding。
最终文本必须使用以下 Markdown 二级标题：${SECTION_NAMES.join('、')}。覆盖检查必须提交全部原文 blockId，不得只检查标题。
只记录文档明确内容、合理推断和待确认事项，三者必须区分；不要编造领域概念。`
  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      thinkingLevel: 'minimal',
      tools: [checkTool, finishTool],
    },
    streamFn: (streamModel, context, streamOptions) =>
      streamSimple(streamModel as Model<'openai-completions'>, context, {
        ...streamOptions,
        apiKey: provider === 'gpt' ? env.GPT_API_KEY : env.LLM_API_KEY,
        maxTokens: 24000,
      }),
  })
  // Allow a repair/recheck pair after the independent critic. The previous
  // message-count guard could stop the agent before it reached submission on
  // larger documents.
  agent.shouldStopAfterTurn = () => turns >= 6
  agent.subscribe((event) => {
    if (event.type === 'turn_start') turns += 1
    if (event.type === 'tool_execution_start') {
      options.onEvent?.({
        type: 'phase',
        part: 'reading',
        text:
          event.toolName === 'check_understanding'
            ? 'Pi Agent 正在检查业务理解覆盖度。'
            : event.toolName === 'finish_understanding'
              ? 'Pi Agent 正在提交业务理解。'
              : `Pi Agent 正在执行 ${event.toolName}。`,
      })
    }
    if (event.type !== 'message_update') return
    const delta = textFromEvent(event.assistantMessageEvent)
    if (delta) emitDelta(options, delta)
  })
  options.onEvent?.({ type: 'phase', part: 'reading', text: 'Pi Agent 正在理解业务文档。' })
  const source = document.blocks.map((block) => `[${block.id}]\n${block.text}`).join('\n\n')
  const abort = () => agent.abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  try {
    await agent.prompt(`请理解以下业务文档，并按要求完成业务理解：\n\n文档名称：${document.name}\n\n${source}`)
  } finally {
    options.signal?.removeEventListener('abort', abort)
  }
  options.signal?.throwIfAborted()
  if (!finished?.trim()) throw new Error('Pi Agent 未提交业务理解。')
  return finished
}
