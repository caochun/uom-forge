import { reviewUnderstanding } from '../stages/understanding-review.ts'
import { READING_METHOD } from '../stages/methodology.ts'
import { Agent, type AgentTool } from '@earendil-works/pi-agent-core'
import { Type, type AssistantMessageEvent } from '@earendil-works/pi-ai'
import type { BusinessDocument, ProviderId } from '../../shared/analysis.ts'
import type { StageOptions } from '../stages/contracts.ts'
import type { RunTurn } from '../providers/types.ts'
import { piSignal } from './runtime.ts'
import { createPiModel, createPiStream, throwIfPiFailed } from '../providers/pi.ts'
import { SOURCE_INSTRUCTIONS, stripSourceMarkers } from '../../shared/understanding-sources.ts'
import {
  UNDERSTANDING_SECTIONS,
  UNDERSTANDING_SECTION_INSTRUCTIONS,
} from '../stages/prompts.ts'

const SECTION_NAMES = UNDERSTANDING_SECTIONS.map(({ title }) => title)

const finishSchema = Type.Object({
  narrative: Type.String({ description: '完整的业务理解 Markdown' }),
})

type FinishArgs = { narrative: string }
const checkSchema = Type.Object({
  narrative: Type.String({ description: '当前完整业务理解 Markdown' }),
})
type CheckArgs = { narrative: string }

type CriticResult = {
  coverage?: {
    id?: unknown
    text?: unknown
    status?: unknown
    note?: unknown
  }[]
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
): Promise<{ text: string; status: string; note: string }[]> {
  const prompt = `你是独立的业务说明覆盖评估员。只判断业务说明是否表达了原文片段中的业务事实，不评价文风，也不补写业务。
对每个原文片段返回 complete、partial 或 uncovered：complete 表示业务说明明确表达了该片段的主要事实及限制；partial 表示只表达了一部分；uncovered 表示没有表达。不要因为语义相近就忽略关键条件、数字、例外或主体。必须原样返回每个输入 id，不要回抄原文。只输出 JSON：{"coverage":[{"id":"输入片段 id","status":"complete|partial|uncovered","note":"简短说明"}]}。

业务说明：
${stripSourceMarkers(narrative)}

原文片段（JSON 数据）：
${JSON.stringify(sourceBlocks)}`
  const raw = await runTurn(prompt, { provider, signal, outputFormat: 'json' })
  const result = parseJsonObject(raw)
  const remaining = [...(result.coverage || [])]
  const byId = new Map<string, { status: string; note: string }>()
  const normalize = (value: string) => value.replace(/\s+/g, '')
  for (const block of sourceBlocks) {
    const index = remaining.findIndex((item) => {
      if (String(item.id || '') === block.id) return true
      // Accept legacy critic output during a rolling deployment.
      const returned = normalize(String(item.text || ''))
      const source = normalize(block.text)
      return returned === source || (returned.length >= 12 && source.includes(returned))
    })
    if (index >= 0) {
      const item = remaining.splice(index, 1)[0]
      byId.set(block.id, {
        status: String(item.status || 'uncovered'),
        note: String(item.note || ''),
      })
    }
  }
  return sourceBlocks
    .filter((block) => byId.get(block.id)?.status !== 'complete')
    .map((block) => ({
      text: block.text,
      status: byId.get(block.id)?.status || 'missing',
      note: byId.get(block.id)?.note || '独立评估未返回该原文片段。',
    }))
}

function gapFeedback(
  incomplete: { text: string; status: string; note: string }[],
  reviewOnly: boolean,
): string {
  if (!incomplete.length) return '本轮理解核对未发现遗漏、无依据新增或冲突。请调用 finish_understanding 提交刚才检查的完整文本。'
  const shown = incomplete.slice(0, 12)
  const lines = shown.map(
    (item, index) =>
      `${index + 1}. [${item.status}] ${item.text}${item.note ? `\n   原因：${item.note}` : ''}`,
  )
  const omitted = incomplete.length - shown.length
  return [
    `发现 ${incomplete.length} 项理解差异或未完成检查。`,
    ...lines,
    ...(omitted > 0 ? [`另有 ${omitted} 个片段未在本次反馈中展开。`] : []),
    reviewOnly
      ? '已完成两次独立检查。请保留仍无法可靠整合的内容作为待复核边界，并立即调用 finish_understanding 提交刚才检查的完整文本。'
      : '请核对上述差异，补充遗漏并纠正无依据解释，然后再检查一次。',
  ].join('\n')
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
  const deadline = piSignal(options, 'Pi 业务理解')
  const model = createPiModel(provider, env)
  let finished: string | undefined
  let checks = 0
  let turns = 0
  let deliveryRetryQueued = false
  let requireTool = false
  let coverageComplete = false
  let independentAttempts = 0
  let checkedNarrative = ''
  let reviewOnly = false
  let lastIndependentGaps: { text: string; status: string; note: string }[] = []
  const sourceBlocks = document.blocks.map((block) => ({
    id: block.id,
    text: block.text,
  }))
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
      if (!coverageComplete && !reviewOnly) {
        return {
          content: [{ type: 'text', text: '覆盖检查仍有缺口，请先补齐原文内容。' }],
          isError: true,
          details: { accepted: false },
        }
      }
      if (reviewOnly) {
        finished = checkedNarrative
        return { content: [{ type: 'text', text: '已提交最后一次检查的业务理解；独立评估缺口保留为待复核提示。' }], details: { accepted: true, reviewRequired: true, ignoredUncheckedRevision: args.narrative !== checkedNarrative, incomplete: lastIndependentGaps.slice(0, 24), omitted: Math.max(0, lastIndependentGaps.length - 24), independentAttempts }, terminate: true }
      }
      finished = checkedNarrative
      return {
        content: [{ type: 'text', text: '业务理解已提交。' }],
        details: {
          narrative: checkedNarrative,
          ignoredUncheckedRevision: args.narrative !== checkedNarrative,
        },
        terminate: true,
      }
    },
  }
  const checkTool: AgentTool<typeof checkSchema> = {
    name: 'check_understanding',
    label: '核对业务理解',
    description: '提交当前业务理解，由独立评估器核对原文遗漏、无依据新增和冲突，并返回具体差异。',
    parameters: checkSchema,
    execute: async (_id, args: CheckArgs) => {
      if (independentAttempts >= 2) {
        return {
          content: [{ type: 'text', text: '已达到两次独立检查上限。不要继续检查或改写，请立即调用 finish_understanding；系统将提交最后一次检查的完整文本。' }],
          details: {
            incomplete: lastIndependentGaps.slice(0, 24),
            omitted: Math.max(0, lastIndependentGaps.length - 24),
            check: checks,
            submitNow: true,
          },
        }
      }
      checks += 1
      checkedNarrative = args.narrative
      independentAttempts += 1
      options.onEvent?.({ type: 'phase', part: 'reading', text: '正在核对原文事实是否保留，以及说明是否引入无依据解释。' })
      const review = await reviewUnderstanding(args.narrative, sourceBlocks, runTurn, provider, deadline.signal)
      options.onEvent?.({ type: 'understanding-review', review })
      const incomplete = [
        ...review.findings.map(item => ({
          text: item.passage || item.blockIds.map(id => sourceBlocks.find(b => b.id === id)?.text || id).join('；'),
          status: item.kind, note: item.note,
        })),
        ...review.warnings.map(note => ({ text: '核对未完成', status: 'incomplete', note })),
      ]
      lastIndependentGaps = incomplete
      coverageComplete = review.status === 'passed'
      reviewOnly = !coverageComplete && independentAttempts >= 2
      return {
        content: [{
          type: 'text',
          text: gapFeedback(incomplete, reviewOnly),
        }],
        details: {
          incomplete: incomplete.slice(0, 24),
          omitted: Math.max(0, incomplete.length - 24),
          check: checks,
        },
      }
    },
  }
  const systemPrompt = `你是业务分析 Agent。你的任务是理解业务文档，不设计对象关系模型。
先形成完整业务理解，调用 check_understanding 提交当前完整文本，由独立评估器逐个检查原文覆盖度；根据工具返回的原文缺口增量修正。最多检查两次：第二次检查后即使仍有待复核片段，也要保留边界并立即调用 finish_understanding 提交最后一次检查的完整文本，不要继续反复压缩或扩写。
最终文本必须使用以下 Markdown 二级标题，并按每节要求组织内容：
${UNDERSTANDING_SECTION_INSTRUCTIONS}
${READING_METHOD}
${SOURCE_INSTRUCTIONS}

只记录文档明确内容、合理推断和待确认事项，三者必须区分；不要编造领域概念。业务过程用于说明业务如何展开，不等于模型对象；代表性业务事实用于后续检验，不是对象清单。
只对影响业务目标、主体与事项、对象边界、关系、过程判断或约束含义，且无法由上下文合理解释的歧义提问。需要用户回答的问题放在“## 待确认问题”下，能有限列举的答案使用“选项：”或“多选：”。check_understanding 的 narrative 必须是当前完整文本，不要提交 block 覆盖清单。最终完成时必须调用 finish_understanding；不要把业务理解正文作为最终文本回复。`
  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      thinkingLevel: 'minimal',
      tools: [checkTool, finishTool],
    },
    streamFn: createPiStream(provider, () => requireTool, env),
  })
  // Allow a repair/recheck pair after the independent critic. The previous
  // message-count guard could stop the agent before it reached submission on
  // larger documents.
  // A long document may require a generation turn, a coverage review, a
  // repair turn and a final submission. Stop only after that bounded budget.
  agent.shouldStopAfterTurn = () => turns >= 8
  agent.subscribe((event) => {
    if (event.type === 'turn_start') turns += 1
    if (event.type === 'tool_execution_start') {
      options.onEvent?.({
        type: 'phase',
        part: 'reading',
        text:
          event.toolName === 'check_understanding'
            ? 'Pi Agent 正在核对业务理解。'
            : event.toolName === 'finish_understanding'
              ? 'Pi Agent 正在提交业务理解。'
              : `Pi Agent 正在执行 ${event.toolName}。`,
      })
    }
    if (event.type === 'message_update') {
      const delta = textFromEvent(event.assistantMessageEvent)
      if (delta) emitDelta(options, delta)
      if (provider === 'glm' && event.assistantMessageEvent.type === 'thinking_delta')
        options.onEvent?.({ type: 'delta', text: event.assistantMessageEvent.delta, reasoning: true })
    }
    if (event.type === 'tool_execution_start') requireTool = false
    if (event.type === 'turn_end' && event.message.role === 'assistant' && event.message.stopReason !== 'error' && event.message.stopReason !== 'aborted' && event.toolResults.length === 0 && !finished && !deliveryRetryQueued) {
      deliveryRetryQueued = true
      requireTool = true
      agent.followUp({ role: 'user', content: '你已经生成了业务理解。请不要再次直接输出正文，立即调用 finish_understanding，并将上一轮的完整业务理解原样放入 narrative 参数。', timestamp: Date.now() })
      options.onEvent?.({ type: 'phase', part: 'reading', text: '业务理解已生成，正在请求 Agent 通过提交工具交接。' })
    }
  })
  options.onEvent?.({ type: 'phase', part: 'reading', text: 'Pi Agent 正在理解业务文档。' })
  const source = JSON.stringify(document.blocks)
  const abort = () => agent.abort()
  deadline.signal.addEventListener('abort', abort, { once: true })
  try {
    await agent.prompt(`请理解以下业务文档，并按要求完成业务理解：\n\n文档名称：${document.name}\n\n${source}`)
  } finally {
    deadline.signal.removeEventListener('abort', abort)
    deadline.dispose()
  }
  deadline.signal.throwIfAborted()
  if (provider === 'glm') throwIfPiFailed(agent, provider, env)
  if (
    !finished?.trim() &&
    checks > 0 &&
    (coverageComplete || reviewOnly) &&
    SECTION_NAMES.every((section) => checkedNarrative.includes(section))
  )
    finished = checkedNarrative
  if (!finished?.trim()) throw new Error('Pi Agent 未通过提交工具交接业务理解。')
  return finished
}
