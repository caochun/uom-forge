import type { Agent, StreamFn } from '@earendil-works/pi-agent-core'
import type { Model } from '@earendil-works/pi-ai'
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions'
import type { ProviderId } from '../../shared/analysis.ts'
import { requireModelProviderConfig } from './model-config.ts'
import { glmGenerationOptions } from './glm.ts'

/** Shared by understanding, semantic modeling and JSON repair. */
export function createPiModel(
  provider: ProviderId,
  env: NodeJS.ProcessEnv = process.env,
): Model<'openai-completions'> {
  const config = requireModelProviderConfig(provider, env)
  const glm = provider === 'glm' ? glmGenerationOptions(env) : undefined
  return {
    id: config.model,
    name: config.model,
    api: 'openai-completions',
    provider: config.piProvider,
    baseUrl: config.url!.replace(/\/+$/, '').replace(/\/chat\/completions$/i, ''),
    reasoning: !!glm,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: glm ? 1048576 : 128000,
    maxTokens: glm?.maxTokens || 24000,
    ...(glm ? {
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: true,
        supportsStrictMode: false,
        maxTokensField: 'max_tokens' as const,
        thinkingFormat: 'zai' as const,
        zaiToolStream: true,
      },
    } : {}),
  }
}

export function createPiStream(
  provider: ProviderId,
  requireTool: () => boolean,
  env: NodeJS.ProcessEnv = process.env,
): StreamFn {
  const config = requireModelProviderConfig(provider, env)
  const glm = provider === 'glm' ? glmGenerationOptions(env) : undefined
  return (model, context, options) => streamSimple(model as Model<'openai-completions'>, context, {
    ...options,
    // GLM only supports auto. Handoff retries still use the agent's follow-up
    // instruction; never send required or disable thinking to force a tool.
    ...(glm ? { reasoning: glm.reasoningEffort, toolChoice: 'auto' } : {}),
    samplingParams: {
      ...options?.samplingParams,
      ...(!glm && requireTool() ? { tool_choice: 'required' } : {}),
      ...(glm ? glm.parameters : provider === 'deepseek' && requireTool() ? { thinking: { type: 'disabled' } } : {}),
    },
    apiKey: config.apiKey,
    maxTokens: glm?.maxTokens || 24000,
  })
}

export function throwIfPiFailed(
  agent: Agent,
  provider: ProviderId,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const message = agent.state.errorMessage
  if (!message) return
  const config = requireModelProviderConfig(provider, env)
  throw new Error(`${config.label}：${message.replaceAll(config.apiKey!, '[redacted]').slice(0, 1000)}`)
}
