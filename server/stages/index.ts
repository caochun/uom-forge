import type { AnalysisRequest, AnalysisResult } from '../../shared/analysis.ts'
import type { RunTurn } from '../providers/types.ts'
import type { StageOptions } from './contracts.ts'
import { readBusiness } from './understanding.ts'
import { buildModel, compileModel, resumeModel } from './modeling.ts'
import { narrateModel } from './narration.ts'
import { assessModel } from './assessment.ts'

export async function runStage(
  request: AnalysisRequest,
  runTurn: RunTurn,
  options: StageOptions = {},
): Promise<AnalysisResult> {
  const configured = {
    ...options,
    provider: request.provider,
    runtime: request.runtime,
  }
  switch (request.stage) {
    case 'understand':
      return readBusiness(request.document, runTurn, configured)
    case 'model':
      return buildModel(
        {
          narrative: request.narrative,
          currentModel: request.model,
          feedback: request.instruction,
          understandingReview: request.understandingReview,
        },
        runTurn,
        configured,
      )
    case 'verify':
    case 'map':
      return resumeModel(request.stage, request.narrative, request.result, runTurn, configured)
    case 'compile':
      return compileModel(
        request.semanticPlan,
        request.narrative,
        runTurn,
        configured,
        request.semantic,
      )
    case 'narrate':
      return narrateModel(request.model, runTurn, configured)
    case 'assess':
      return assessModel(request.model, runTurn, configured)
  }
}
