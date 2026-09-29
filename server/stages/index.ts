import type { AnalysisRequest, AnalysisResult } from '../../shared/analysis.ts'
import type { RunTurn } from '../providers/types.ts'
import type { StageOptions } from './contracts.ts'
import { readBusiness } from './understanding.ts'
import { buildModel, compileModel } from './modeling.ts'
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
    reasoningEffort: request.reasoningEffort,
  }
  switch (request.stage) {
    case 'understand':
      return readBusiness(request.document, configured)
    case 'model':
      return buildModel(
        {
          narrative: request.narrative,
          sources: request.sources,
          currentModel: request.model,
          feedback: request.instruction,
        },
        runTurn,
        configured,
      )
    case 'compile':
      return compileModel(
        request.modelDesign,
        request.narrative,
        runTurn,
        configured,
        request.businessBasis,
        request.designReview,
        request.sources,
      )
    case 'narrate':
      return narrateModel(request.model, runTurn, configured)
    case 'assess':
      return assessModel(request.model, request.businessBasis, runTurn, configured)
  }
}
