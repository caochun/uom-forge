import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { analyzeWithProvider, understandWithProvider, assessWithProvider, narrateModelWithProvider, discussWithProvider } from './server/codex-acp.js'

// Vite exposes .env values to client code through import.meta.env, but the
// server middleware uses process.env. Load the parent UOM .env explicitly so
// the selected DeepSeek provider can read its credentials server-side.
const fileEnv = loadEnv(process.env.NODE_ENV === 'production' ? 'production' : 'development', path.resolve(process.cwd(), '..'), '')
for (const [key, value] of Object.entries(fileEnv)) if (process.env[key] === undefined) process.env[key] = value

export default defineConfig({
  server: {
    host: '0.0.0.0',
    allowedHosts: ['onto.njuics.cn'],
  },
  plugins: [react(), {
    name: 'uom-forge-api',
    configureServer(server) {
      const handleJson = (req) => new Promise((resolve, reject) => {
        const chunks = []
        req.on('data', (chunk) => chunks.push(chunk))
        req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch (error) { reject(new Error('请求内容不是有效 JSON')) } })
        req.on('error', reject)
      })
      server.middlewares.use(async (req, res, next) => {
        const pathname = (req.url || '').split('?')[0]
        if (!['/api/analyze', '/api/analyze/stream', '/api/discuss'].includes(pathname)) return next()
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method Not Allowed'); return }
        // `IncomingMessage.close` also fires after the request body has been
        // fully consumed.  That is a normal part of a POST and must not stop
        // the response stream.  Track the response socket instead so an
        // actual browser disconnect is handled correctly.
        let closed = false
        res.on('close', () => { closed = true })
        req.on('aborted', () => { closed = true })
        const streaming = pathname === '/api/analyze/stream'
        const emit = streaming ? (event) => { if (!closed) res.write(`data: ${JSON.stringify(event)}\n\n`) } : null
        if (streaming) {
          res.statusCode = 200
          res.setHeader('content-type', 'text/event-stream; charset=utf-8')
          res.setHeader('cache-control', 'no-cache, no-transform')
          res.setHeader('connection', 'keep-alive')
          res.flushHeaders?.()
          emit({ type: 'phase', text: '已收到分析请求，正在读取文档证据。' })
        }
        try {
          const body = await handleJson(req)
          const providerName = body.provider === 'deepseek' ? 'DeepSeek API' : 'Codex ACP'
          if (pathname === '/api/analyze') {
            const result = await analyzeWithProvider(body.document, body.model, body.instruction, { provider: body.provider })
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.end(JSON.stringify(result))
            return
          }
          if (pathname === '/api/discuss') {
            const text = await discussWithProvider(body.document, body.model, body.messages || [], { provider: body.provider })
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ text }))
            return
          }
          emit({ type: 'phase', text: `已读取文档，准备启动 ${providerName}。` })
          let result
          if (body.stage === 'understand') {
            result = await understandWithProvider(body.document, { provider: body.provider, onEvent: emit })
          } else if (body.stage === 'narrate') {
            // Model narration is deliberately isolated from the evidence and
            // business understanding: the provider receives only the candidate model.
            result = await narrateModelWithProvider(body.model, { provider: body.provider, onEvent: emit })
          } else if (body.stage === 'assess') {
            result = await assessWithProvider(body.document, body.understanding, body.model, { provider: body.provider, onEvent: emit })
          } else {
            const instruction = body.understanding ? `${body.instruction || ''}\n\n第一阶段业务理解（仅作为建模依据）：${JSON.stringify(body.understanding)}` : body.instruction
            result = await analyzeWithProvider(body.document, body.model, instruction, { provider: body.provider, onEvent: emit })
          }
          emit({ type: 'result', result })
          if (!closed) res.end()
        } catch (error) {
          if (pathname === '/api/analyze/stream') {
            if (!closed) { res.write(`data: ${JSON.stringify({ type: 'error', error: error.message || '推理提供方调用失败' })}\n\n`); res.end() }
          } else if (!closed) {
            res.statusCode = 502
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ error: error.message || 'Codex ACP 调用失败' }))
          }
        }
      })
    },
  }],
  // Keep the root .env available for future server-side adapters. Only VITE_*
  // variables are exposed to the browser by Vite.
  envDir: path.resolve(process.cwd(), '..'),
})
