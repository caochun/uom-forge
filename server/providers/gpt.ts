import type { RunTurn } from './types.ts'
import { createChatCompletionsProvider } from './chat-completions.ts'
import { timeoutFromEnv } from './lifetime.ts'

export function createGptProvider(
  fetcher: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): RunTurn {
  return createChatCompletionsProvider(() => {
    const apiKey = env.GPT_API_KEY
    const url = env.GPT_API_URL
    if (!apiKey || !url)
      throw new Error('GPT 未配置 GPT_API_KEY 或 GPT_API_URL。')
    const reasoningEffort = env.GPT_REASONING_EFFORT || 'medium'
    return {
      provider: 'gpt',
      label: 'GPT',
      apiKey,
      url,
      model: env.GPT_MODEL || 'gpt-6-astra',
      reasoningEffort,
      timeoutMs: timeoutFromEnv(env.GPT_API_TIMEOUT_MS),
      parameters: { reasoning_effort: reasoningEffort },
    }
  }, fetcher)
}
