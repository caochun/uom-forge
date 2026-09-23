import type { ModelingInput, StageEvent, StagePart } from '../../shared/analysis.ts'
import type { DesignReview } from '../../shared/design-review.ts'
import type { RunTurn, TurnOptions } from '../providers/types.ts'

export interface StageAgents {
  text: (prompt: string, part: StagePart, options: StageOptions) => Promise<string>
  modeling: (
    input: ModelingInput,
    runTurn: RunTurn,
    options: StageOptions,
    businessBasis: string,
  ) => Promise<{ modelDesign: string; designReview: DesignReview }>
}

export interface StageOptions extends Omit<TurnOptions, 'onEvent'> {
  /** Injectable Pi runners used by deterministic orchestration tests. */
  agents?: Partial<StageAgents>
  onEvent?: (event: StageEvent) => void
}
// Providers emit inference events. Stage labels are attached only here.
export function scopedTurn(
  options: StageOptions,
  part: StagePart,
): TurnOptions {
  const { agents: _agents, ...turnOptions } = options
  return {
    ...turnOptions,
    ...(part === 'compile' || part === 'assess'
      ? { outputFormat: 'json' as const }
      : {}),
    onEvent: (event) => options.onEvent?.({ ...event, part }),
  }
}
