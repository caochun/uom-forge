import { setTimeout as delay } from 'node:timers/promises'
import type { ProviderEvent } from '../../shared/analysis.ts'

export const MAX_STREAM_RETRIES = 2
export type StreamReset = Extract<ProviderEvent, { type: 'reset' }>

// Match transport failures only. HTTP/auth/quota, malformed JSON and token
// limits must remain visible instead of being retried as connection errors.
export function connectionFailure(error: unknown): string | undefined {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code && /^(ECONNRESET|EPIPE|ETIMEDOUT|UND_ERR_(SOCKET|BODY_TIMEOUT|HEADERS_TIMEOUT|CONNECT_TIMEOUT))$/.test(code)) return code
    if (error.cause) {
      const cause = connectionFailure(error.cause)
      if (cause) return cause
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  const normalized = /^上游连接中断（([A-Z_]+)）/.exec(message)
  if (normalized) return normalized[1]
  if (/^(?:TypeError: )?terminated$/i.test(message)) return 'TERMINATED'
  if (message === 'Stream ended without finish_reason') return 'INCOMPLETE_STREAM'
  return undefined
}

export class UpstreamConnectionError extends Error {
  constructor(code: string, cause?: unknown) {
    super(`上游连接中断（${code}），本次输出未完成。`, { cause })
  }
}

// Keep the safe transport code before the SDK flattens Error.cause. Do not log
// request headers, prompts, response bodies, credentials or socket addresses.
export function transportFetch(fetcher: typeof fetch, onFailure?: (code: string) => void): typeof fetch {
  return async (input, init) => {
    const normalize = (error: unknown) => {
      const code = connectionFailure(error)
      if (code) onFailure?.(code)
      return code ? new UpstreamConnectionError(code, error) : error
    }
    let response: Response
    try { response = await fetcher(input, init) } catch (error) { throw normalize(error) }
    if (!response.ok || !response.body) return response
    const reader = response.body.getReader()
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { value, done } = await reader.read()
          if (done) { reader.releaseLock(); controller.close() }
          else controller.enqueue(value)
        } catch (error) {
          // A failed read can leave the original fetch body attached to the
          // connection pool. Cancel it before releasing the lock so a retry
          // cannot inherit a half-closed socket.
          try { await reader.cancel(error) } catch { /* the read already failed */ }
          try { reader.releaseLock() } catch { /* already released by fetch */ }
          controller.error(normalize(error))
        }
      },
      async cancel(reason) {
        try { await reader.cancel(reason) } finally { reader.releaseLock() }
      },
    })
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
  }
}

export function retryNotice(label: string, retry: number): StreamReset {
  return { type: 'reset', text: `${label} 上游连接中断，正在重新生成当前内容（重试 ${retry}/${MAX_STREAM_RETRIES}）。` }
}

export async function waitToRetry(retry: number, signal?: AbortSignal) {
  signal?.throwIfAborted()
  try { await delay(500 * 2 ** (retry - 1), undefined, { signal }) }
  catch (error) { signal?.throwIfAborted(); throw error }
}

export function exhaustedConnectionMessage(code: string, retries: number) {
  return `上游连接中断（${code}），${retries ? `已重试 ${retries} 次仍未完成` : '输出未完成'}。请稍后重试；已完成的阶段仍保留。`
}
