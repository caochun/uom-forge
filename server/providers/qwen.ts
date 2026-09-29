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
    const selected = selectedReasoning('qwen', options.reasoningEffort, env)
    return {
      provider: 'qwen',
      label: 'Qwen',
      apiKey,
      url,
      model: env.QWEN_MODEL || 'Qwen3.6',
      reasoningEffort: selected.effort,
      timeoutMs: timeoutFromEnv(env.QWEN_API_TIMEOUT_MS),
      // Do not send max_tokens; let the configured Qwen endpoint choose its
      // model-specific default and enforce its own context limit.
      parameters: { ...selected.parameters },
    }
  }, fetcher)
}
