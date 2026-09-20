import type { RunTurn } from './types.ts'
import { createChatCompletionsProvider } from './chat-completions.ts'
import { timeoutFromEnv } from './lifetime.ts'
import { requireModelProviderConfig } from './model-config.ts'
import { selectedReasoning } from './reasoning.ts'

// GLM-5.3-Flash requires thinking, including tool handoff/retry turns.
// https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash
export function glmGenerationOptions(env: NodeJS.ProcessEnv = process.env): {
  maxTokens: number
  reasoningEffort: 'low' | 'high' | 'max'
  parameters: Record<string, unknown>
} {
  const maxTokens = Number(env.GLM_MAX_OUTPUT_TOKENS || 32768)
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 131072)
    throw new Error('GLM_MAX_OUTPUT_TOKENS 必须为 1 到 131072 之间的整数。')
  const reasoningEffort = env.GLM_REASONING_EFFORT || 'max'
  if (reasoningEffort !== 'low' && reasoningEffort !== 'high' && reasoningEffort !== 'max')
    throw new Error('GLM_REASONING_EFFORT 仅支持 low、high 或 max。')
  return {
    maxTokens,
    reasoningEffort,
    parameters: {
      max_tokens: maxTokens,
      reasoning_effort: reasoningEffort,
      thinking: { type: 'enabled', clear_thinking: false },
      temperature: 1,
      top_p: 0.95,
    },
  }
}

export function createGlmProvider(
  fetcher: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): RunTurn {
  return createChatCompletionsProvider((options) => {
    const config = requireModelProviderConfig('glm', env)
    const selected = selectedReasoning('glm', options.reasoningEffort, env)
    const generation = glmGenerationOptions(selected.effort ? { ...env, GLM_REASONING_EFFORT: selected.effort } : env)
    return {
      provider: 'glm',
      label: config.label,
      apiKey: config.apiKey!,
      url: config.url!,
      model: config.model,
      timeoutMs: timeoutFromEnv(env.GLM_API_TIMEOUT_MS),
      reasoningEffort: generation.reasoningEffort,
      parameters: generation.parameters,
    }
  }, fetcher)
}
