import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AnalysisEvent, DiscussionEvent } from '../shared/analysis.ts'
import { PROVIDERS } from '../shared/analysis.ts'
import type { RunTurn } from './providers/types.ts'
import { runProviderTurn, resolveProvider } from './providers/index.ts'
import { runStage } from './stages/index.ts'
import { discuss } from './stages/discussion.ts'
import {
  parseAnalysisRequest,
  parseDiscussionRequest,
} from './validation/requests.ts'
import { isRecord, errorMessage } from './validation/values.ts'
import { publicModelOptions } from './providers/reasoning.ts'

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string))
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as unknown
  } catch {
    throw new Error('请求内容不是有效 JSON。')
  }
}

export function createApiMiddleware(runTurn: RunTurn = runProviderTurn) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ): Promise<void> => {
    const pathname = (request.url || '').split('?')[0]
    if (pathname === '/api/models') {
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.setHeader('cache-control', 'no-store')
      if (request.method !== 'GET') {
        response.statusCode = 405
        response.setHeader('allow', 'GET')
        response.end(JSON.stringify({ error: 'Method Not Allowed' }))
      } else response.end(JSON.stringify(publicModelOptions()))
      return
    }
    if (
      !['/api/analyze', '/api/analyze/stream', '/api/discuss', '/api/discuss/stream'].includes(
        pathname,
      )
    ) {
      next()
      return
    }
    if (request.method !== 'POST') {
      response.statusCode = 405
      response.setHeader('allow', 'POST')
      response.end('Method Not Allowed')
      return
    }
    const controller = new AbortController()
    const disconnected = () => {
      if (!response.writableEnded)
        controller.abort(new DOMException('客户端已断开连接', 'AbortError'))
    }
    // A request's normal close after reading its body is not a cancellation.
    response.on('close', disconnected)
    request.on('aborted', disconnected)
    const streaming = pathname === '/api/analyze/stream'
    const discussionStreaming = pathname === '/api/discuss/stream'
    const sse = streaming || discussionStreaming
    let invoked = false
    const emit = (event: AnalysisEvent) => {
      if (!controller.signal.aborted && !response.writableEnded)
        response.write(`data: ${JSON.stringify(event)}\n\n`)
    }
    const emitDiscussion = (event: DiscussionEvent) => {
      if (!controller.signal.aborted && !response.writableEnded)
        response.write(`data: ${JSON.stringify(event)}\n\n`)
    }
    if (sse) {
      response.setHeader('content-type', 'text/event-stream; charset=utf-8')
      response.setHeader('cache-control', 'no-cache, no-transform')
      response.setHeader('connection', 'keep-alive')
      response.flushHeaders()
    } else response.setHeader('content-type', 'application/json; charset=utf-8')
    try {
      const body = await readJson(request)
      controller.signal.throwIfAborted()
      const provider = resolveProvider(
        isRecord(body) ? body.provider : undefined,
      )
      if (pathname === '/api/discuss' || discussionStreaming) {
        const input = parseDiscussionRequest(body, provider)
        invoked = true
        const text = await discuss(
          input.document,
          input.model,
          input.messages,
          runTurn,
          {
            provider,
            reasoningEffort: input.reasoningEffort,
            signal: controller.signal,
            onEvent: discussionStreaming ? event => {
              if (event.type === 'delta')
                emitDiscussion({ type: 'delta', text: event.text, ...(event.reasoning ? { reasoning: true } : {}) })
            } : undefined,
          },
        )
        if (!controller.signal.aborted) {
          if (discussionStreaming) {
            emitDiscussion({ type: 'result', text })
            response.end()
          } else response.end(JSON.stringify({ text }))
        }
      } else {
        const input = parseAnalysisRequest(
          body,
          provider,
          streaming ? undefined : 'model',
        )
        if (streaming)
          emit({
            type: 'phase',
            text: `已收到阶段输入，准备启动 ${PROVIDERS[provider].label}。`,
          })
        invoked = true
        const result = await runStage(input, runTurn, {
          signal: controller.signal,
          onEvent: streaming ? emit : undefined,
        })
        if (!controller.signal.aborted) {
          if (streaming) {
            emit({ type: 'result', result })
            response.end()
          } else response.end(JSON.stringify(result))
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        if (streaming) {
          emit({ type: 'error', error: errorMessage(error) })
          response.end()
        } else if (discussionStreaming) {
          emitDiscussion({ type: 'error', error: errorMessage(error) })
          response.end()
        } else {
          response.statusCode = invoked ? 502 : 400
          response.end(JSON.stringify({ error: errorMessage(error) }))
        }
      }
    } finally {
      response.off('close', disconnected)
      request.off('aborted', disconnected)
    }
  }
}
