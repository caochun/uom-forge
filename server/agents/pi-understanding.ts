import type { BusinessDocument, ProviderId } from '../../shared/analysis.ts'
import type { StageOptions } from '../stages/contracts.ts'
import type { RunTurn } from '../providers/types.ts'
import { understandingPrompt } from '../stages/prompts.ts'
import { runPiText } from './pi-text.ts'

export function runPiUnderstanding(
  document: BusinessDocument, provider: ProviderId, _runTurn: RunTurn, options: StageOptions = {},
): Promise<string> {
  return runPiText(understandingPrompt(document), 'reading', { ...options, provider })
}
