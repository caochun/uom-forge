// Compatibility barrel for stage callers. Prompt implementations live in
// server/prompts so workflow code does not own the entire prompt catalogue.
export { INPUT_CONTENT_BOUNDARY, ANALYST_INSTRUCTIONS } from '../prompts/common.ts'
export { UNDERSTANDING_INSTRUCTIONS, understandingPrompt } from '../prompts/understanding.ts'
export { businessBasisPrompt } from '../prompts/business-basis.ts'
export type { BasisCorrection } from '../prompts/business-basis.ts'
export { modelDesignPrompt } from '../prompts/modeling.ts'
export { compileModelPrompt, compileModelRepairPrompt } from '../prompts/compilation.ts'
