export function createDeadline(
  external: AbortSignal | undefined,
  timeoutMs: number,
  label: string,
) {
  external?.throwIfAborted()
  const controller = new AbortController()
  // Zero means no execution deadline; caller cancellation remains active.
  const timer = Number.isFinite(timeoutMs) && timeoutMs > 0 ? setTimeout(
    () =>
      controller.abort(
        new Error(`${label}超时（超过 ${Math.round(timeoutMs / 1000)} 秒）`),
      ),
    timeoutMs,
  ) : undefined
  return {
    signal: external
      ? AbortSignal.any([external, controller.signal])
      : controller.signal,
    dispose: () => clearTimeout(timer),
  }
}

export function createProgressDeadline(
  external: AbortSignal | undefined,
  limits: { firstOutputMs: number; idleMs: number; totalMs: number },
  label: string,
) {
  const total = createDeadline(external, limits.totalMs, `${label} 总时限`)
  const inactivity = new AbortController()
  const signal = AbortSignal.any([total.signal, inactivity.signal])
  let receivedOutput = false
  const schedule = (timeoutMs: number) =>
    timeoutMs > 0 ? setTimeout(() => {
      const reason = receivedOutput
        ? `输出中断（连续 ${Math.round(timeoutMs / 1000)} 秒没有新内容）`
        : `等待首段输出超时（超过 ${Math.round(timeoutMs / 1000)} 秒）`
      inactivity.abort(new Error(`${label} ${reason}`))
    }, timeoutMs) : undefined
  let timer = schedule(limits.firstOutputMs)
  return {
    signal,
    output() {
      if (signal.aborted) return
      receivedOutput = true
      clearTimeout(timer)
      timer = schedule(limits.idleMs)
    },
    dispose() {
      clearTimeout(timer)
      total.dispose()
    },
  }
}

export function timeoutFromEnv(value: string | undefined, fallback = 0): number {
  if (!value?.trim()) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}
