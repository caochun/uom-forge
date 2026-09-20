import type { RunTurn } from './types.ts'
import { createChatCompletionsProvider } from './chat-completions.ts'
import { timeoutFromEnv } from './lifetime.ts'
import { selectedReasoning } from './reasoning.ts'

/** Qwen uses the same OpenAI-compatible streaming API as the other providers. */
export function createQwenProvider(
  fetcher: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): RunTurn {
  return createChatCompletionsProvider((options) => {
    const apiKey = env.QWEN_API_KEY
    const url = env.QWEN_API_URL
    if (!apiKey || !url)
      throw new Error('Qwen 未配置 QWEN_API_KEY 或 QWEN_API_URL。')
    const maxTokens = Number(env.QWEN_MAX_OUTPUT_TOKENS || 16384)
    if (!Number.isSafeInteger(maxTokens) || maxTokens < 1)
      throw new Error('QWEN_MAX_OUTPUT_TOKENS 必须为正整数。')
    const selected = selectedReasoning('qwen', options.reasoningEffort, env)
    return {
      provider: 'qwen',
      label: 'Qwen',
      apiKey,
      url,
      model: env.QWEN_MODEL || 'Qwen3.6',
      reasoningEffort: selected.effort,
      timeoutMs: timeoutFromEnv(env.QWEN_API_TIMEOUT_MS),
      parameters: { max_tokens: maxTokens, ...selected.parameters },
    }
  }, fetcher)
}
