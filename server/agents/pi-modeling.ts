// Compatibility entry point. The modeling Agent now lives with the modeling
// workflow; existing stage and script imports can migrate independently.
export {
  runPiModeling,
  MODELING_SYSTEM_PROMPT,
  EXPRESSION_CHECK_DESCRIPTION,
  designRevisionMessage,
  basisRevisionMessage,
} from '../modeling/workflow.ts'
