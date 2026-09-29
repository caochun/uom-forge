import { Agent } from '@earendil-works/pi-agent-core'
import { DEFAULT_PROVIDER, type StagePart } from '../../shared/analysis.ts'
import type { StageOptions } from '../stages/contracts.ts'
import { createPiModel, createPiStream, throwIfPiFailed } from '../providers/pi.ts'
import { piSignal } from './runtime.ts'
import { INPUT_CONTENT_BOUNDARY } from '../prompts/common.ts'

export const TEXT_SYSTEM_PROMPT = `只完成当前提示词指定的文档整理或建模依据提炼任务；具体输入及用途由阶段说明确定。不使用工具，不输出交接或审批说明。
${INPUT_CONTENT_BOUNDARY}`

/** Human-readable artifacts need one generation, not a format/approval loop. */
export async function runPiText(prompt: string, part: StagePart, options: StageOptions = {}): Promise<string> {
  const provider = options.provider || DEFAULT_PROVIDER
  const agent = new Agent({
    initialState: {
      systemPrompt: TEXT_SYSTEM_PROMPT,
      model: createPiModel(provider, process.env, options.reasoningEffort), thinkingLevel: 'minimal', tools: [],
    },
    streamFn: createPiStream(provider, () => false, process.env, options.reasoningEffort,
      event => options.onEvent?.({ ...event, part })),
  })
  const deadline = piSignal(options, 'Pi 文本生成')
  let draft = ''
  agent.shouldStopAfterTurn = () => true
  agent.subscribe(event => {
    if (event.type === 'message_update') {
      const update = event.assistantMessageEvent
      if (update.type === 'text_delta') options.onEvent?.({ type: 'delta', part, text: update.delta, size: update.delta.length })
      if (update.type === 'thinking_delta') options.onEvent?.({ type: 'delta', part, text: update.delta, reasoning: true })
    }
    if (event.type === 'message_end' && event.message.role === 'assistant')
      draft = event.message.content.filter(block => block.type === 'text').map(block => block.text).join('').trim()
  })
  const abort = () => agent.abort()
  deadline.signal.addEventListener('abort', abort, { once: true })
  try {
    deadline.signal.throwIfAborted()
    await agent.prompt(prompt)
    deadline.signal.throwIfAborted()
    throwIfPiFailed(agent, provider)
    if (!draft) throw new Error('未返回正文，请重试。')
    return draft
  } finally {
    deadline.signal.removeEventListener('abort', abort)
    deadline.dispose()
  }
}
