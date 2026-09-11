import type { ProviderEvent, ProviderId } from '../../shared/analysis.ts'

export interface TurnOptions {
  outputFormat?: 'json'
  provider?: ProviderId
  signal?: AbortSignal
  onEvent?: (event: ProviderEvent) => void
}
// Each invocation receives only its explicit prompt, without session history.
export type RunTurn = (prompt: string, options: TurnOptions) => Promise<string>
