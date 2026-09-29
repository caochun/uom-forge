import type { Agent, StreamFn } from '@earendil-works/pi-agent-core'
import type { AssistantMessage, AssistantMessageEvent, Model } from '@earendil-works/pi-ai'
import { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream'
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions'
import type { ProviderId } from '../../shared/analysis.ts'
import { requireModelProviderConfig } from './model-config.ts'
import { configureGlmDns, glmGenerationOptions } from './glm.ts'
import { selectedReasoning } from './reasoning.ts'
import type { ReasoningEffort } from '../../shared/reasoning.ts'
import { connectionFailure, exhaustedConnectionMessage, MAX_STREAM_RETRIES, retryNotice, transportFetch, waitToRetry, type StreamReset } from '../llm/transport/upstream-retry.ts'

// Deliver resets in stream order, after all old deltas have been consumed.
// The internal marker never reaches Pi: a second start would add a second
// assistant message and incorrectly increment the design review round.
class RecoveringAssistantStream extends AssistantMessageEventStream {
  private resets = new WeakMap<AssistantMessageEvent, StreamReset>()
  constructor(private onReset?: (event: StreamReset) => void) { super() }
  reset(partial: AssistantMessage, notice: StreamReset) {
    const marker: AssistantMessageEvent = { type: 'start', partial }
    this.resets.set(marker, notice)
    this.push(marker)
  }
  override async *[Symbol.asyncIterator]() {
    const iterator = super[Symbol.asyncIterator]()
    for await (const event of { [Symbol.asyncIterator]: () => iterator }) {
      const reset = this.resets.get(event)
      if (reset) this.onReset?.(reset)
      else yield event
    }
  }
}

/** Shared by business understanding, model design and JSON repair. */
export function createPiModel(
  provider: ProviderId,
  env: NodeJS.ProcessEnv = process.env,
  reasoningEffort?: ReasoningEffort,
): Model<'openai-completions'> {
  const config = requireModelProviderConfig(provider, env)
  const selected = selectedReasoning(provider, reasoningEffort, env)
  const glm = provider === 'glm' ? glmGenerationOptions(selected.effort ? { ...env, GLM_REASONING_EFFORT: selected.effort } : env) : undefined
  // pi-ai requires a numeric model ceiling for its internal thinking-budget
  // calculation. It is metadata only; createPiStream uses a zero sentinel
  // below so no max_tokens field is sent to the upstream API.
  const modelContextWindow = glm ? 1048576 : 128000
  return {
    id: config.model,
    name: config.model,
    api: 'openai-completions',
    provider: config.piProvider,
    baseUrl: config.url!.replace(/\/+$/, '').replace(/\/chat\/completions$/i, ''),
    reasoning: !!glm || !!selected.effort,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: modelContextWindow,
    maxTokens: modelContextWindow,
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
  onReset?: (event: StreamReset) => void,
): StreamFn {
  const config = requireModelProviderConfig(provider, env)
  if (provider === 'glm') configureGlmDns(env)
  const selected = selectedReasoning(provider, reasoningEffort, env)
  const glm = provider === 'glm' ? glmGenerationOptions(selected.effort ? { ...env, GLM_REASONING_EFFORT: selected.effort } : env) : undefined
  return (model, context, options) => {
    let transportCode: string | undefined
    const streamOptions = {
      ...options,
      // Exact vendor values are applied below after the SDK's generic level map.
      ...(selected.effort ? { reasoning: selected.effort === 'none' ? undefined : 'low' as const } : {}),
      // GLM only supports auto. Handoff retries still use the agent's follow-up
      // instruction; never send required or disable thinking to force a tool.
      ...(glm ? { reasoning: glm.reasoningEffort, toolChoice: 'auto' as const } : {}),
      samplingParams: {
        ...options?.samplingParams,
        ...(!glm && requireTool() ? { tool_choice: 'required' } : {}),
        ...(glm ? glm.parameters : provider === 'deepseek' && requireTool() && !selected.effort ? { thinking: { type: 'disabled' } } : {}),
        ...selected.parameters,
      },
      apiKey: config.apiKey,
      // The SDK also wraps failures before headers as "Connection error.".
      fetch: transportFetch(options?.fetch || globalThis.fetch, code => { transportCode = code }),
      maxRetries: 0,
      // pi-ai otherwise copies model.maxTokens into the request. Zero is
      // treated as an omitted optional value by its OpenAI adapter while the
      // model metadata above remains available for reasoning-budget math.
      maxTokens: 0,
    }
    // Retry only this unfinished assistant turn, from the original messages.
    // Pi executes tools only after the terminal success event; failed partial
    // tool calls are discarded and previously completed tools are not replayed.
    const original = { ...context, messages: structuredClone(context.messages) }
    const create = () => streamSimple(model as Model<'openai-completions'>, original, streamOptions)
    const result = new RecoveringAssistantStream(onReset)
    void (async () => {
      let retries = 0
      let started = false
      const empty: AssistantMessage = {
        role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
        timestamp: Date.now(), stopReason: 'error',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      }
      try {
        for (;;) {
          options?.signal?.throwIfAborted()
          transportCode = undefined
          const attemptStarted = performance.now()
          let retry = false
          for await (const event of create()) {
            if (event.type === 'start') {
              if (!started) { result.push(event); started = true }
              continue
            }
            if (event.type === 'error' && event.reason !== 'aborted' && !options?.signal?.aborted) {
              const code = transportCode || connectionFailure(event.error.errorMessage)
              if (code) {
                console.warn('[upstream-stream]', { provider, code, attempt: retries + 1, elapsedMs: Math.round(performance.now() - attemptStarted), retrying: retries < MAX_STREAM_RETRIES })
                if (retries < MAX_STREAM_RETRIES) {
                  retries++
                  result.reset(empty, retryNotice(config.label, retries))
                  await waitToRetry(retries, options?.signal)
                  retry = true
                  break
                }
                event.error.errorMessage = exhaustedConnectionMessage(code, retries)
              }
            }
            result.push(event)
            if (event.type === 'done' || event.type === 'error') return
          }
          if (!retry) throw new Error('推理流未返回结束事件。')
        }
      } catch (error) {
        const reason = options?.signal?.aborted ? 'aborted' : 'error'
        result.push({ type: 'error', reason, error: { ...empty, stopReason: reason,
          errorMessage: (error instanceof Error ? error.message : String(error)).replaceAll(config.apiKey!, '[redacted]') } })
      } finally {
        result.end()
      }
    })()
    return result
  }
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
