import type { ProviderEvent, ProviderId } from '../../shared/analysis.ts'

export interface TurnOptions {
  provider?: ProviderId
  signal?: AbortSignal
  onEvent?: (event: ProviderEvent) => void
}
// Each invocation receives only its explicit prompt, without session history.
export type RunTurn = (prompt: string, options: TurnOptions) => Promise<string>
