import type { RunTurn } from './types.ts'
import { createChatCompletionsProvider } from './chat-completions.ts'
import { timeoutFromEnv } from './lifetime.ts'
import { selectedReasoning } from './reasoning.ts'

export function createDeepSeekProvider(
  fetcher: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): RunTurn {
  return createChatCompletionsProvider((options) => {
    const apiKey = env.LLM_API_KEY
    const url = env.LLM_API_URL
    if (!apiKey || !url)
      throw new Error('DeepSeek 未配置 LLM_API_KEY 或 LLM_API_URL。')
    const selected = selectedReasoning('deepseek', options.reasoningEffort, env)
    return {
      provider: 'deepseek',
      label: 'DeepSeek',
      apiKey,
      url,
      model: env.LLM_MODEL || 'deepseek-chat',
      reasoningEffort: selected.effort,
      timeoutMs: timeoutFromEnv(env.LLM_API_TIMEOUT_MS),
      // Do not send max_tokens. The upstream model default and context window
      // decide the response ceiling.
      parameters: { thinking: { type: 'disabled' }, ...selected.parameters },
    }
  }, fetcher)
}
