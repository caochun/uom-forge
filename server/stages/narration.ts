import type { CandidateModel } from '../../shared/model.ts'
import type { RunTurn } from '../providers/types.ts'
import type { StageOptions } from './contracts.ts'
import { scopedTurn } from './contracts.ts'
import { modelContext } from './model-context.ts'
import { modelNarrativePrompt } from '../prompts/model-review.ts'
export { modelNarrativePrompt } from '../prompts/model-review.ts'

export async function narrateModel(
  model: CandidateModel,
  runTurn: RunTurn,
  options: StageOptions = {},
): Promise<{ narrative: string }> {
  const narrative = await runTurn(modelNarrativePrompt(model), scopedTurn(options, 'narrate'))
  options.signal?.throwIfAborted()
  if (!narrative.trim()) throw new Error('未返回模型自述。')
  return { narrative: narrative.trim() }
}
