import type { ProviderId } from '../../../shared/analysis.ts'
import { DEFAULT_PROVIDER } from '../../../shared/analysis.ts'
import type { RunTurn } from '../../providers/types.ts'
import { createDeepSeekProvider } from '../../providers/deepseek.ts'
import { createGptProvider } from '../../providers/gpt.ts'
import { createQwenProvider } from '../../providers/qwen.ts'
import { createGlmProvider } from '../../providers/glm.ts'

/** Runtime registry for selectable model providers. */
export function resolveProvider(
  value: unknown = process.env.UOM_LLM_PROVIDER || DEFAULT_PROVIDER,
): ProviderId {
  if (value === 'codex') throw new Error('Codex ACP 已停用，请选择 DeepSeek、GPT、Qwen 或 GLM。')
  if (value !== 'gpt' && value !== 'deepseek' && value !== 'qwen' && value !== 'glm')
    throw new Error('不支持的推理提供方。')
  return value
}

const providers: Record<ProviderId, RunTurn> = {
  deepseek: createDeepSeekProvider(),
  gpt: createGptProvider(),
  qwen: createQwenProvider(),
  glm: createGlmProvider(),
}

export const runProviderTurn: RunTurn = (prompt, options = {}) => {
  options.signal?.throwIfAborted()
  return providers[resolveProvider(options.provider)](prompt, options)
}

