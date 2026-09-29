import type { RunTurn, TurnOptions } from './types.ts'
import type { ProviderId } from '../../shared/analysis.ts'
import { createDeadline } from './lifetime.ts'
import { readSseData } from '../llm/transport/sse.ts'
import { isRecord } from '../validation/values.ts'
import { createTurnTiming } from '../llm/transport/timing.ts'
import { connectionFailure, exhaustedConnectionMessage, MAX_STREAM_RETRIES, retryNotice, transportFetch, UpstreamConnectionError, waitToRetry } from '../llm/transport/upstream-retry.ts'

interface ChatCompletionsConfig {
  provider: ProviderId
  label: string
  apiKey: string
  url: string
  model: string
  timeoutMs: number
  reasoningEffort?: string
  parameters: Record<string, unknown>
}

export function createChatCompletionsProvider(
  configure: (options: TurnOptions) => ChatCompletionsConfig,
  fetcher: typeof fetch = fetch,
): RunTurn {
  return async (prompt, options = {}) => {
    options.signal?.throwIfAborted()
    // Resolve lazily: Vite loads the server environment after module imports.
    const config = configure(options)
    const { apiKey, model, label } = config
    const baseUrl = config.url.replace(/\/+$/, '')
    const url = /\/chat\/completions$/i.test(baseUrl)
      ? baseUrl
      : `${baseUrl}/chat/completions`
    const deadline = createDeadline(
      options.signal,
      config.timeoutMs,
      `${label} 请求`,
    )
    try {
      for (let retries = 0; ; retries++) {
        const attemptStarted = performance.now()
        const timing = createTurnTiming(
          {
            provider: config.provider,
            model,
            reasoningEffort: config.reasoningEffort,
          },
          prompt,
          options.onEvent,
        )
        try {
          const response = await transportFetch(fetcher)(url, {
            method: 'POST',
            signal: deadline.signal,
            headers: {
              authorization: `Bearer ${apiKey}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              ...config.parameters,
              ...(options.outputFormat === 'json'
                ? { response_format: { type: 'json_object' } }
                : {}),
              model,
              stream: true,
              messages: [{ role: 'user', content: prompt }],
            }),
          })
          timing.connected()
          if (!response.ok)
            throw new Error(
              `${label} 返回 HTTP ${response.status}：${(await response.text()).replaceAll(apiKey, '[redacted]').slice(0, 800)}`,
            )
          if (!response.body) throw new Error(`${label} 没有返回流式响应。`)
          let text = ''
          let completed = false
          for await (const data of readSseData(response.body, deadline.signal)) {
            if (data === '[DONE]') {
              completed = true
              break
            }
            let chunk: unknown
            try {
              chunk = JSON.parse(data) as unknown
            } catch {
              throw new Error(`${label} 返回了无效的流式 JSON。`)
            }
            if (!isRecord(chunk)) throw new Error(`${label} 返回了无效的消息。`)
            if (isRecord(chunk.error))
              throw new Error(
                `${label}：${String(chunk.error.message || '推理失败').replaceAll(apiKey, '[redacted]')}`,
              )
            const choice: unknown = Array.isArray(chunk.choices)
              ? chunk.choices[0]
              : undefined
            if (!isRecord(choice)) continue
            const delta = isRecord(choice.delta) ? choice.delta : {}
            if (
              typeof delta.reasoning_content === 'string' &&
              delta.reasoning_content
            )
              options.onEvent?.({
                type: 'delta',
                text: delta.reasoning_content,
                reasoning: true,
              })
            if (typeof delta.content === 'string' && delta.content) {
              text += delta.content
              timing.output(delta.content)
              options.onEvent?.({
                type: 'delta',
                text: delta.content,
                size: text.length,
              })
            }
            if (choice.finish_reason === 'stop') completed = true
            else if (choice.finish_reason)
              throw new Error(
                `${label} 输出未正常完成（${String(choice.finish_reason)}）。`,
              )
          }
          deadline.signal.throwIfAborted()
          if (!completed) throw new UpstreamConnectionError('INCOMPLETE_STREAM')
          if (!text.trim()) throw new Error(`${label} 没有返回正文。`)
          timing.finish('completed')
          return text
        } catch (error) {
          timing.finish(options.signal?.aborted ? 'cancelled' : 'failed')
          deadline.signal.throwIfAborted()
          const code = connectionFailure(error)
          if (!code) throw error
          console.warn('[upstream-stream]', { provider: config.provider, code, attempt: retries + 1, elapsedMs: Math.round(performance.now() - attemptStarted), retrying: retries < MAX_STREAM_RETRIES })
          if (retries >= MAX_STREAM_RETRIES) throw new Error(`${label}：${exhaustedConnectionMessage(code, retries)}`, { cause: error })
          options.onEvent?.(retryNotice(label, retries + 1))
          await waitToRetry(retries + 1, deadline.signal)
        }
      }
    } finally {
      deadline.dispose()
    }
  }
}
