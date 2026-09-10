import { randomUUID } from 'node:crypto'
import type { ProviderEvent, TurnTiming } from '../../shared/analysis.ts'

// Measure elapsed wall time with a monotonic clock. These observations cannot
// separate upstream queueing, inference and network time.
export function createTurnTiming(
  details: Pick<TurnTiming, 'provider' | 'model' | 'reasoningEffort'>,
  prompt: string,
  onEvent?: (event: ProviderEvent) => void,
) {
  const started = performance.now()
  const timing: TurnTiming = {
    ...details,
    callId: randomUUID(),
    startedAt: new Date().toISOString(),
    promptCharacters: Array.from(prompt).length,
    outputCharacters: 0,
    elapsedMs: 0,
    status: 'running',
  }
  const elapsed = () => Math.round(performance.now() - started)
  const emit = () => {
    timing.elapsedMs = elapsed()
    onEvent?.({ type: 'timing', timing: { ...timing } })
  }
  emit()
  return {
    connected() {
      timing.connectedMs = elapsed()
      emit()
    },
    sessionReady() {
      timing.sessionReadyMs = elapsed()
      emit()
    },
    output(text: string) {
      if (!text) return
      timing.outputCharacters += Array.from(text).length
      if (timing.firstTextMs === undefined) {
        timing.firstTextMs = elapsed()
        emit()
      }
    },
    finish(status: Exclude<TurnTiming['status'], 'running'>) {
      if (timing.status !== 'running') return
      timing.status = status
      emit()
    },
  }
}
