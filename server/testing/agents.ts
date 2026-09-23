import type { RunTurn } from '../providers/types.ts'
import type { StageAgents } from '../stages/contracts.ts'
import { scopedTurn } from '../stages/contracts.ts'
import { modelDesignPrompt } from '../stages/prompts.ts'

/**
 * Deterministic Pi runner replacements for orchestration tests.
 *
 * Production always uses the real Pi runners. These replacements keep the
 * stage tests focused on persistence, cancellation, and compilation without
 * making a test call the production provider.
 */
export function testAgents(runTurn: RunTurn): StageAgents {
  return {
    text: (prompt, part, options) => runTurn(prompt, scopedTurn(options, part)),
    modeling: async (input, _reviewTurn, options, businessBasis) => ({
      modelDesign: await runTurn(
        modelDesignPrompt(input, businessBasis),
        scopedTurn(options, 'design'),
      ),
      designReview: {
        status: 'completed',
        round: 1,
        rounds: [],
        reason: 'sufficient',
      },
    }),
  }
}
