import type { ProviderEvent, ProviderId } from '../../shared/analysis.ts'
import type { ReasoningEffort } from '../../shared/reasoning.ts'

export interface TurnOptions {
  outputFormat?: 'json'
  provider?: ProviderId
  reasoningEffort?: ReasoningEffort
  signal?: AbortSignal
  onEvent?: (event: ProviderEvent) => void
}
// Each invocation receives only its explicit prompt, without session history.
export type RunTurn = (prompt: string, options: TurnOptions) => Promise<string>
