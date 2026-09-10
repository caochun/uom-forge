import type { ProviderId } from '../../shared/analysis.ts'
import type { RunTurn } from './types.ts'
import { createCodexProvider } from './codex.ts'
import { createDeepSeekProvider } from './deepseek.ts'

export function resolveProvider(
  value: unknown = process.env.UOM_LLM_PROVIDER || 'deepseek',
): ProviderId {
  if (value !== 'codex' && value !== 'deepseek')
    throw new Error('不支持的推理提供方。')
  return value
}
const codex = createCodexProvider()
const deepseek = createDeepSeekProvider()
export const runProviderTurn: RunTurn = (prompt, options = {}) => {
  options.signal?.throwIfAborted()
  return resolveProvider(options.provider) === 'codex'
    ? codex(prompt, options)
    : deepseek(prompt, options)
}
