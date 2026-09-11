import type { RunTurn } from './types.ts'
import { createChatCompletionsProvider } from './chat-completions.ts'
import { timeoutFromEnv } from './lifetime.ts'

export function createDeepSeekProvider(
  fetcher: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): RunTurn {
  return createChatCompletionsProvider(() => {
    const apiKey = env.LLM_API_KEY
    const url = env.LLM_API_URL
    if (!apiKey || !url)
      throw new Error('DeepSeek 未配置 LLM_API_KEY 或 LLM_API_URL。')
    // Candidate JSON can be large; reserve enough room for validation rather
    // than allowing the provider to truncate a structurally valid model.
    const maxTokens = Number(env.LLM_MAX_OUTPUT_TOKENS || 16384)
    if (!Number.isSafeInteger(maxTokens) || maxTokens < 1)
      throw new Error('LLM_MAX_OUTPUT_TOKENS 必须为正整数。')
    return {
      provider: 'deepseek',
      label: 'DeepSeek',
      apiKey,
      url,
      model: env.LLM_MODEL || 'deepseek-chat',
      timeoutMs: timeoutFromEnv(env.LLM_API_TIMEOUT_MS),
      parameters: { thinking: { type: 'disabled' }, max_tokens: maxTokens },
    }
  }, fetcher)
}
