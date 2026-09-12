import type { StageEvent, StagePart } from '../../shared/analysis.ts'
import type { TurnOptions } from '../providers/types.ts'
import type { AgentRuntimeId } from '../../shared/analysis.ts'

export interface StageOptions extends Omit<TurnOptions, 'onEvent'> {
  runtime?: AgentRuntimeId
  onEvent?: (event: StageEvent) => void
}
// Providers emit inference events. Stage labels are attached only here.
export function scopedTurn(
  options: StageOptions,
  part: StagePart,
): TurnOptions {
  return {
    ...options,
    ...(['compile', 'expression', 'repair', 'recheck'].includes(part)
      ? { outputFormat: 'json' as const }
      : {}),
    onEvent: (event) => options.onEvent?.({ ...event, part }),
  }
}
