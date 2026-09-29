import dns from 'node:dns'
import type { RunTurn } from './types.ts'
import { createChatCompletionsProvider } from './chat-completions.ts'
import { timeoutFromEnv } from './lifetime.ts'
import { requireModelProviderConfig } from './model-config.ts'
import { selectedReasoning } from './reasoning.ts'

export type GlmDnsResultOrder = 'ipv4first' | 'ipv6first' | 'verbatim'

/**
 * The GLM endpoint currently has an unstable IPv6 path in this environment.
 * Keep the workaround scoped to GLM and make the choice explicit so a host
 * with a healthy IPv6 route can opt back in without changing request code.
 */
export function glmDnsResultOrder(env: NodeJS.ProcessEnv = process.env): GlmDnsResultOrder {
  const order = env.GLM_DNS_RESULT_ORDER || 'ipv4first'
  if (order !== 'ipv4first' && order !== 'ipv6first' && order !== 'verbatim')
    throw new Error('GLM_DNS_RESULT_ORDER 仅支持 ipv4first、ipv6first 或 verbatim。')
  return order
}

export function configureGlmDns(env: NodeJS.ProcessEnv = process.env): GlmDnsResultOrder {
  const order = glmDnsResultOrder(env)
  dns.setDefaultResultOrder(order)
  return order
}

// GLM-5.3-Flash requires thinking, including tool handoff/retry turns.
// https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash
export function glmGenerationOptions(env: NodeJS.ProcessEnv = process.env): {
  reasoningEffort: 'low' | 'high' | 'max'
  parameters: Record<string, unknown>
} {
  const reasoningEffort = env.GLM_REASONING_EFFORT || 'max'
  if (reasoningEffort !== 'low' && reasoningEffort !== 'high' && reasoningEffort !== 'max')
    throw new Error('GLM_REASONING_EFFORT 仅支持 low、high 或 max。')
  return {
    reasoningEffort,
    parameters: {
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
    configureGlmDns(env)
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
