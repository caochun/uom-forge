import type { Agent, StreamFn } from '@earendil-works/pi-agent-core'
import type { Model } from '@earendil-works/pi-ai'
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions'
import type { ProviderId } from '../../shared/analysis.ts'
import { requireModelProviderConfig } from './model-config.ts'
import { glmGenerationOptions } from './glm.ts'
import { selectedReasoning } from './reasoning.ts'
import type { ReasoningEffort } from '../../shared/reasoning.ts'

/** Shared by understanding, semantic modeling and JSON repair. */
export function createPiModel(
  provider: ProviderId,
  env: NodeJS.ProcessEnv = process.env,
  reasoningEffort?: ReasoningEffort,
): Model<'openai-completions'> {
  const config = requireModelProviderConfig(provider, env)
  const selected = selectedReasoning(provider, reasoningEffort, env)
  const glm = provider === 'glm' ? glmGenerationOptions(selected.effort ? { ...env, GLM_REASONING_EFFORT: selected.effort } : env) : undefined
  return {
    id: config.model,
    name: config.model,
    api: 'openai-completions',
    provider: config.piProvider,
    baseUrl: config.url!.replace(/\/+$/, '').replace(/\/chat\/completions$/i, ''),
    reasoning: !!glm || !!selected.effort,
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
    } : selected.effort ? {
      compat: {
        supportsReasoningEffort: provider !== 'qwen',
        requiresThinkingAsText: false,
        thinkingFormat: provider === 'deepseek' ? 'deepseek' as const
          : provider === 'qwen' ? ('enable_thinking' in selected.parameters ? 'qwen' as const : 'qwen-chat-template' as const)
            : 'openai' as const,
      },
    } : {}),
  }
}

export function createPiStream(
  provider: ProviderId,
  requireTool: () => boolean,
  env: NodeJS.ProcessEnv = process.env,
  reasoningEffort?: ReasoningEffort,
): StreamFn {
  const config = requireModelProviderConfig(provider, env)
  const selected = selectedReasoning(provider, reasoningEffort, env)
  const glm = provider === 'glm' ? glmGenerationOptions(selected.effort ? { ...env, GLM_REASONING_EFFORT: selected.effort } : env) : undefined
  return (model, context, options) => streamSimple(model as Model<'openai-completions'>, context, {
    ...options,
    // Exact vendor values are applied below after the SDK's generic level map.
    ...(selected.effort ? { reasoning: selected.effort === 'none' ? undefined : 'low' as const } : {}),
    // GLM only supports auto. Handoff retries still use the agent's follow-up
    // instruction; never send required or disable thinking to force a tool.
    ...(glm ? { reasoning: glm.reasoningEffort, toolChoice: 'auto' } : {}),
    samplingParams: {
      ...options?.samplingParams,
      ...(!glm && requireTool() ? { tool_choice: 'required' } : {}),
      ...(glm ? glm.parameters : provider === 'deepseek' && requireTool() && !selected.effort ? { thinking: { type: 'disabled' } } : {}),
      ...selected.parameters,
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
