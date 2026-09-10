import type { RunTurn } from './types.ts'
import { createDeadline, timeoutFromEnv } from './lifetime.ts'
import { readSseData } from './sse.ts'
import { isRecord } from '../validation/values.ts'
import { createTurnTiming } from './timing.ts'

export function createDeepSeekProvider(
  fetcher: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): RunTurn {
  return async (prompt, options = {}) => {
    options.signal?.throwIfAborted()
    const apiKey = env.LLM_API_KEY
    const configuredUrl = env.LLM_API_URL
    if (!apiKey || !configuredUrl)
      throw new Error('DeepSeek 未配置 LLM_API_KEY 或 LLM_API_URL。')
    const baseUrl = configuredUrl.replace(/\/+$/, '')
    const url = /\/chat\/completions$/i.test(baseUrl)
      ? baseUrl
      : `${baseUrl}/chat/completions`
    const model = env.LLM_MODEL || 'deepseek-chat'
    const timing = createTurnTiming(
      { provider: 'deepseek', model },
      prompt,
      options.onEvent,
    )
    const deadline = createDeadline(
      options.signal,
      timeoutFromEnv(env.LLM_API_TIMEOUT_MS),
      'DeepSeek 请求',
    )
    try {
      const response = await fetcher(url, {
        method: 'POST',
        signal: deadline.signal,
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          stream: true,
          thinking: { type: 'disabled' },
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      timing.connected()
      if (!response.ok)
        throw new Error(
          `DeepSeek 返回 HTTP ${response.status}：${(await response.text()).slice(0, 800)}`,
        )
      if (!response.body) throw new Error('DeepSeek 没有返回流式响应。')
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
          throw new Error('DeepSeek 返回了无效的流式 JSON。')
        }
        if (!isRecord(chunk)) throw new Error('DeepSeek 返回了无效的消息。')
        if (isRecord(chunk.error))
          throw new Error(
            `DeepSeek：${String(chunk.error.message || '推理失败')}`,
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
            `DeepSeek 输出未正常完成（${String(choice.finish_reason)}）。`,
          )
      }
      deadline.signal.throwIfAborted()
      if (!completed) throw new Error('DeepSeek 连接提前结束，输出尚未完成。')
      timing.finish('completed')
      return text
    } catch (error) {
      timing.finish(options.signal?.aborted ? 'cancelled' : 'failed')
      deadline.signal.throwIfAborted()
      throw error
    } finally {
      deadline.dispose()
    }
  }
}
