import type { StageOptions } from '../stages/contracts.ts'
import { createDeadline, timeoutFromEnv } from '../providers/lifetime.ts'

export function piSignal(options: StageOptions, label: string) {
  return createDeadline(options.signal, timeoutFromEnv(process.env.UOM_PI_TIMEOUT_MS), label)
}
