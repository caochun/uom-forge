import type { StageOptions } from '../stages/contracts.ts'

export function piSignal(options: StageOptions, label: string) {
  const timeout = Number(process.env.UOM_PI_TIMEOUT_MS || 300000)
  const timeoutMs = Number.isFinite(timeout) && timeout > 0 ? timeout : 300000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`${label}超时（超过 ${Math.round(timeoutMs / 1000)} 秒）`)), timeoutMs)
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
  return { signal, dispose: () => clearTimeout(timer) }
}
