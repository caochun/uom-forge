import type { ProviderId } from '../../shared/analysis.ts'
import { DEFAULT_PROVIDER } from '../../shared/analysis.ts'
import type { RunTurn } from './types.ts'
// ACP is disabled in the application; retain the adapter for manual experiments.
// import { createCodexProvider } from './codex.ts'
import { createDeepSeekProvider } from './deepseek.ts'
import { createGptProvider } from './gpt.ts'

export function resolveProvider(
  value: unknown = process.env.UOM_LLM_PROVIDER || DEFAULT_PROVIDER,
): ProviderId {
  if (value === 'codex')
    throw new Error('Codex ACP 已停用，请选择 DeepSeek 或 GPT。')
  if (value !== 'gpt' && value !== 'deepseek')
    throw new Error('不支持的推理提供方。')
  return value
}
// const codex = createCodexProvider()
const providers: Record<ProviderId, RunTurn> = {
  deepseek: createDeepSeekProvider(),
  gpt: createGptProvider(),
}
export const runProviderTurn: RunTurn = (prompt, options = {}) => {
  options.signal?.throwIfAborted()
  return providers[resolveProvider(options.provider)](prompt, options)
}
