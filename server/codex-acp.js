import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import readline from 'node:readline'
import { discussionPrompt, modelingPrompt, modelNarrativePrompt, understandingPrompt, assessmentPrompt, validateDocument, validateModel, parseModel, normalizeModel, normalizeUnderstanding, normalizeAssessment, hydrateEvidence } from './modeling.js'

const require = createRequire(import.meta.url)
const ACP_ENTRY = require.resolve('@agentclientprotocol/codex-acp')

export async function analyzeWithProvider(document, currentModel, instruction = '', options = {}) {
  validateDocument(document)
  const text = await runProviderTurn(modelingPrompt(document, currentModel, instruction), options)
  const model = hydrateEvidence(normalizeModel(parseModel(text)), document)
  const validation = validateModel(model, document)
  return { model, validation }
}

export async function understandWithProvider(document, options = {}) {
  validateDocument(document)
  const result = normalizeUnderstanding(hydrateEvidence(parseModel(await runProviderTurn(understandingPrompt(document), options)), document))
  return { understanding: result }
}

export async function assessWithProvider(document, understanding, model, options = {}) {
  validateDocument(document)
  const result = normalizeAssessment(hydrateEvidence(parseModel(await runProviderTurn(assessmentPrompt(document, understanding, model), options)), document))
  return { assessment: result }
}

export async function narrateModelWithProvider(model, options = {}) {
  const narrative = await runProviderTurn(modelNarrativePrompt(model), options)
  return { narrative: narrative.trim() }
}

export async function discussWithProvider(document, model, messages, options = {}) {
  validateDocument(document)
  return runProviderTurn(discussionPrompt(document, model, messages), options)
}

export const analyzeWithCodex = analyzeWithProvider
export const understandWithCodex = understandWithProvider
export const assessWithCodex = assessWithProvider
export const narrateModelWithCodex = narrateModelWithProvider
export const discussWithCodex = discussWithProvider

async function runProviderTurn(prompt, options = {}) {
  const provider = options.provider || process.env.UOM_LLM_PROVIDER || 'deepseek'
  if (provider === 'deepseek') return runDeepSeekTurn(prompt, options)
  if (provider !== 'codex') throw new Error(`不支持的推理提供方：${provider}`)
  return runAcpTurn(prompt, options)
}

async function runDeepSeekTurn(prompt, options = {}) {
  const apiKey = process.env.LLM_API_KEY
  const configuredUrl = process.env.LLM_API_URL
  if (!apiKey || !configuredUrl) throw new Error('DeepSeek 未配置 LLM_API_KEY 或 LLM_API_URL。')
  const baseUrl = configuredUrl.replace(/\/+$/, '')
  const url = /\/chat\/completions$/i.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`
  const controller = new AbortController()
  const timeoutMs = Number.parseInt(process.env.LLM_API_TIMEOUT_MS || process.env.CODEX_ACP_TIMEOUT_MS || '300000', 10)
  const timer = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 300000)
  const report = typeof options.onEvent === 'function' ? options.onEvent : () => {}
  let response
  try {
    response = await fetch(url, { method: 'POST', signal: controller.signal, headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: process.env.LLM_MODEL || 'deepseek-chat', stream: true, messages: [{ role: 'user', content: prompt }] })
    })
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`DeepSeek 请求超时（超过 ${Math.round(timeoutMs / 60000)} 分钟）`)
    throw new Error(`DeepSeek 请求失败：${error.message}`)
  }
  if (!response.ok) throw new Error(`DeepSeek 返回 HTTP ${response.status}：${(await response.text()).slice(0, 800)}`)
  if (!response.body) throw new Error('DeepSeek 没有返回流式响应。')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let responseText = ''
  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      let chunk
      try { chunk = JSON.parse(data) } catch { continue }
      const delta = chunk.choices?.[0]?.delta || {}
      const reasoning = delta.reasoning_content || ''
      const text = delta.content || ''
      // DeepSeek may emit a long reasoning stream before the final answer.
      // Forward it as progress so the UI does not appear stuck, while only
      // accumulating answer content for the structured JSON parser.
      if (reasoning) report({ type: 'delta', text: reasoning, size: responseText.length + reasoning.length, reasoning: true })
      if (text) { responseText += text; report({ type: 'delta', text, size: responseText.length }) }
    }
    if (done) break
  }
  clearTimeout(timer)
  return responseText
}

function send(child, id, method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
}

async function runAcpTurn(prompt, options = {}) {
  const report = typeof options.onEvent === 'function' ? options.onEvent : () => {}
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'uom-forge-acp-'))
  const configuredCodex = (() => {
    try { return JSON.parse(process.env.CODEX_CONFIG || '{}') } catch { return {} }
  })()
  const child = spawn(process.execPath, [ACP_ENTRY], {
    cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: true,
    env: {
      ...process.env,
      NO_BROWSER: '1',
      INITIAL_AGENT_MODE: 'read-only',
      CODEX_CONFIG: JSON.stringify({ model_reasoning_effort: process.env.CODEX_REASONING_EFFORT || 'medium', ...configuredCodex }),
    },
  })
  const output = readline.createInterface({ input: child.stdout })
  let responseText = ''
  let failure
  let resolveDone
  const done = new Promise((resolve) => { resolveDone = resolve })
  const configuredTimeout = Number.parseInt(process.env.CODEX_ACP_TIMEOUT_MS || '300000', 10)
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 300000
  const timer = setTimeout(() => { failure = new Error(`Codex ACP 分析超时（超过 ${Math.round(timeoutMs / 60000)} 分钟）`); resolveDone() }, timeoutMs)
  let stderrText = ''
  child.stderr.on('data', (chunk) => { stderrText += String(chunk).slice(-4000) })
  const heartbeat = setInterval(() => report({ type: 'phase', text: 'Codex 正在推理模型结构，仍在处理文档证据。' }), 10000)
  output.on('line', (line) => {
    let message
    try { message = JSON.parse(line) } catch { return }
    if (message.error) {
      failure = new Error(message.error.message || 'ACP 请求失败')
      resolveDone()
      return
    }
    if (message.id === 1 && message.result) {
      report({ type: 'phase', text: 'ACP 已连接，正在创建 Codex 会话。' })
      send(child, 2, 'session/new', { cwd, mcpServers: [] })
    } else if (message.id === 2 && message.result) {
      report({ type: 'phase', text: 'Codex 会话已创建，开始分析证据块。' })
      send(child, 3, 'session/prompt', { sessionId: message.result.sessionId, prompt: [{ type: 'text', text: prompt }] })
    }
    else if (message.method === 'session/update') {
      const update = message.params?.update
      if (update?.sessionUpdate === 'agent_message_chunk') {
        const chunk = update.content?.text || ''
        responseText += chunk
        report({ type: 'delta', text: chunk, size: responseText.length })
      }
    } else if (message.id === 3) {
      report({ type: 'phase', text: 'Codex 输出已完成，正在校验模型和证据引用。' })
      if (message.result?.stopReason !== 'end_turn' && !failure) failure = new Error(`Codex ACP 未正常结束（${message.result?.stopReason || 'unknown'}）`)
      resolveDone()
    }
  })
  child.on('error', (error) => { failure = error; resolveDone() })
  child.on('exit', (code) => { if (!responseText && !failure) failure = new Error(`Codex ACP 进程退出（${code}）`); resolveDone() })
  send(child, 1, 'initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'uom-forge', version: '0.1.0' } })
  await done
  clearTimeout(timer)
  clearInterval(heartbeat)
  output.close()
  child.stdin.destroy()
  if (child.pid) { try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') } }
  await rm(cwd, { recursive: true, force: true })
  if (failure) {
    if (stderrText.trim()) failure.message += `：${stderrText.trim().slice(-1000)}`
    throw failure
  }
  return responseText
}
