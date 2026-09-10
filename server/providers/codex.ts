import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import type { RunTurn } from './types.ts'
import { createDeadline, timeoutFromEnv } from './lifetime.ts'
import { isRecord } from '../validation/values.ts'
import { createTurnTiming } from './timing.ts'

const require = createRequire(import.meta.url)
export function codexConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> {
  const parsed: unknown = JSON.parse(env.CODEX_CONFIG || '{}')
  if (!isRecord(parsed)) throw new Error('CODEX_CONFIG 必须是 JSON 对象。')
  return {
    ...parsed,
    model: env.CODEX_MODEL || parsed.model || 'gpt-6-astra',
    model_reasoning_effort:
      env.CODEX_REASONING_EFFORT || parsed.model_reasoning_effort || 'medium',
  }
}

export function createCodexProvider(
  launch = {
    command: process.execPath,
    args: [require.resolve('@agentclientprotocol/codex-acp')],
  },
  env: NodeJS.ProcessEnv = process.env,
): RunTurn {
  return async (prompt, options = {}) => {
    options.signal?.throwIfAborted()
    const config = codexConfigFromEnv(env)
    const timing = createTurnTiming(
      {
        provider: 'codex',
        model: String(config.model),
        reasoningEffort: String(config.model_reasoning_effort),
      },
      prompt,
      options.onEvent,
    )
    const deadline = createDeadline(
      options.signal,
      timeoutFromEnv(env.CODEX_ACP_TIMEOUT_MS),
      'Codex ACP 请求',
    )
    let cwd: string
    try {
      cwd = await mkdtemp(path.join(os.tmpdir(), 'uom-forge-acp-'))
    } catch (error) {
      deadline.dispose()
      timing.finish(options.signal?.aborted ? 'cancelled' : 'failed')
      throw error
    }
    const child = spawn(launch.command, launch.args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
      env: {
        ...env,
        NO_BROWSER: '1',
        INITIAL_AGENT_MODE: 'read-only',
        CODEX_CONFIG: JSON.stringify(config),
      },
    })
    const lines = readline.createInterface({ input: child.stdout })
    let stderr = ''
    let text = ''
    let removeAbort = () => {}
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000)
    })
    const heartbeat = setInterval(
      () =>
        options.onEvent?.({
          type: 'phase',
          text: text ? 'Codex 正在输出本次结果。' : 'Codex 请求仍在等待返回。',
        }),
      10000,
    )
    try {
      const result = await new Promise<string>((resolve, reject) => {
        let settled = false
        const finish = (error?: unknown) => {
          if (settled) return
          settled = true
          error ? reject(error) : resolve(text)
        }
        const abort = () => finish(deadline.signal.reason)
        deadline.signal.addEventListener('abort', abort, { once: true })
        removeAbort = () => deadline.signal.removeEventListener('abort', abort)
        const send = (id: number, method: string, params: unknown) => {
          if (!settled)
            child.stdin.write(
              JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n',
            )
        }
        child.stdin.on('error', finish)
        child.on('error', finish)
        child.on('exit', (code, signal) =>
          finish(
            new Error(
              `Codex ACP 进程在完成响应前退出（${code ?? signal}）。${stderr ? '\n' + stderr.slice(-1000) : ''}`,
            ),
          ),
        )
        lines.on('line', (line) => {
          if (settled) return
          try {
            let message: unknown
            try {
              message = JSON.parse(line) as unknown
            } catch {
              return
            }
            if (!isRecord(message)) return
            if (isRecord(message.error)) {
              finish(new Error(String(message.error.message || 'ACP 请求失败')))
              return
            }
            if (message.id === 1 && isRecord(message.result)) {
              timing.connected()
              options.onEvent?.({
                type: 'phase',
                text: 'ACP 已连接，正在创建 Codex 会话。',
              })
              send(2, 'session/new', { cwd, mcpServers: [] })
            } else if (message.id === 2 && isRecord(message.result)) {
              if (typeof message.result.sessionId !== 'string')
                throw new Error('Codex ACP 未返回会话 id。')
              timing.sessionReady()
              options.onEvent?.({
                type: 'phase',
                text: 'Codex 会话已创建，正在处理本次任务。',
              })
              send(3, 'session/prompt', {
                sessionId: message.result.sessionId,
                prompt: [{ type: 'text', text: prompt }],
              })
            } else if (
              message.method === 'session/update' &&
              isRecord(message.params)
            ) {
              const update = message.params.update
              if (
                isRecord(update) &&
                update.sessionUpdate === 'agent_message_chunk' &&
                isRecord(update.content) &&
                typeof update.content.text === 'string'
              ) {
                text += update.content.text
                timing.output(update.content.text)
                options.onEvent?.({
                  type: 'delta',
                  text: update.content.text,
                  size: text.length,
                })
              }
            } else if (message.id === 3) {
              if (
                !isRecord(message.result) ||
                message.result.stopReason !== 'end_turn'
              )
                throw new Error('Codex ACP 未正常结束本次响应。')
              options.onEvent?.({ type: 'phase', text: 'Codex 输出已完成。' })
              finish()
            }
          } catch (error) {
            finish(error)
          }
        })
        if (deadline.signal.aborted) abort()
        else
          send(1, 'initialize', {
            protocolVersion: 1,
            clientCapabilities: {},
            clientInfo: { name: 'uom-forge', version: '0.1.0' },
          })
      })
      timing.finish('completed')
      return result
    } catch (error) {
      timing.finish(options.signal?.aborted ? 'cancelled' : 'failed')
      throw error
    } finally {
      deadline.dispose()
      clearInterval(heartbeat)
      removeAbort()
      lines.close()
      child.stdin.destroy()
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          child.kill('SIGKILL')
        }
      }
      await rm(cwd, { recursive: true, force: true })
    }
  }
}
