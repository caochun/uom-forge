export function createDeadline(
  external: AbortSignal | undefined,
  timeoutMs: number,
  label: string,
) {
  external?.throwIfAborted()
  const controller = new AbortController()
  const timer = setTimeout(
    () =>
      controller.abort(
        new Error(`${label}超时（超过 ${Math.round(timeoutMs / 1000)} 秒）`),
      ),
    timeoutMs,
  )
  return {
    signal: external
      ? AbortSignal.any([external, controller.signal])
      : controller.signal,
    dispose: () => clearTimeout(timer),
  }
}

export function timeoutFromEnv(value: string | undefined): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300000
}
