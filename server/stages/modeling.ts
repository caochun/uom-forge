import { normalizeModelPlan } from './markdown-sections.ts'
import { validateCompiledModel } from '../validation/compiled-model.ts'
import { requireText } from '../validation/document.ts'
import { semanticModelPrompt, compileModelPrompt } from './prompts.ts'
import type { ModelingInput, ModelingResult } from '../../shared/analysis.ts'
import type { RunTurn } from '../providers/types.ts'
import { scopedTurn, type StageOptions } from './contracts.ts'
import { checkAndRepair } from './expression.ts'
import {
  questionKey,
  reviewModelClarifications,
  type ClarificationReview,
} from '../../shared/clarifications.ts'
import { runPiModeling } from '../agents/pi-modeling.ts'
import type { SemanticPlanV2 } from '../../shared/semantic.ts'
import { mapSemanticPlan } from './semantic.ts'
import { prepareBusinessBasis } from './business-basis.ts'
import { validateSemanticPlan } from '../validation/semantic.ts'
import { artifactVersion } from '../../shared/workflow.ts'
import type { DesignReview } from '../../shared/design-review.ts'

function unreviewedModel(result: Omit<ModelingResult, 'expressionReview'>, narrative: string, options: StageOptions): ModelingResult {
  const expressionReview: ModelingResult['expressionReview'] = {
    status: 'not-run', snapshots: [{ model: result.model }], selectedSnapshot: 0, changes: [], warnings: [],
    lineage: { narrativeVersion: artifactVersion(narrative), planVersion: artifactVersion(result.semanticPlan),
      compiledModelVersion: artifactVersion(result.model), candidateVersion: artifactVersion(result.model) },
  }
  options.onEvent?.({ type: 'model-checkpoint', model: result.model, expressionReview })
  return { ...result, expressionReview }
}

export async function buildModel(
  input: ModelingInput,
  runTurn: RunTurn,
  options: StageOptions = {},
): Promise<ModelingResult> {
  requireText(input.narrative, '业务说明')
  const report = options.onEvent || (() => {})
  options.signal?.throwIfAborted()
  const usePi = options.runtime === 'pi' || (options.runtime === undefined && process.env.UOM_AGENT_RUNTIME === 'pi')
  const businessBasis = await prepareBusinessBasis(input.narrative, runTurn, options)
  options.signal?.throwIfAborted()
  report({ type: 'phase', part: 'semantic', text: '正在生成模型设计。' })
  let semanticPlan: string
  let designReview: DesignReview | undefined
  if (usePi) {
    const designed = await runPiModeling(input, runTurn, options, businessBasis)
    semanticPlan = designed.semanticPlan
    designReview = designed.designReview
  } else {
    semanticPlan = await runTurn(
      semanticModelPrompt(input, businessBasis),
      scopedTurn(options, 'semantic'),
    )
  }
  options.signal?.throwIfAborted()
  if (!semanticPlan.trim()) throw new Error('未返回建模说明。')
  semanticPlan = normalizeModelPlan(semanticPlan)
  const review = reviewModelClarifications(semanticPlan, input.narrative, businessBasis)
  // Publish before compilation so errors or cancellation cannot erase it.
  report({ type: 'model-plan', part: 'semantic', semanticPlan, ...review })
  options.signal?.throwIfAborted()
  const compiled = await compileReviewedPlan(
    semanticPlan,
    review,
    runTurn,
    options,
    undefined,
  )
  return unreviewedModel({ ...compiled, businessBasis, ...(designReview ? { designReview } : {}) }, input.narrative, options)
}

// Compilation is the only mandatory machine-readable boundary.
export async function compileModel(
  semanticPlan: string,
  narrative: string,
  runTurn: RunTurn,
  options: StageOptions = {},
  semantic?: SemanticPlanV2,
  businessBasis?: string,
  designReview?: DesignReview,
): Promise<ModelingResult> {
  if (typeof semanticPlan !== 'string' || !semanticPlan.trim())
    throw new Error('请先完成建模说明。')
  requireText(narrative, '业务说明')
  const checkedSemantic = semantic
    ? validateSemanticPlan(semantic, narrative)
    : undefined
  const semanticForCompilation = checkedSemantic
    ? { ...checkedSemantic, status: 'stories' as const, mappings: [], mappedModelVersion: undefined }
    : undefined
  const compiled = await compileReviewedPlan(
    semanticPlan,
    reviewModelClarifications(semanticPlan, narrative, businessBasis),
    runTurn,
    options,
    semanticForCompilation,
  )
  return unreviewedModel({ ...compiled, ...(businessBasis !== undefined ? { businessBasis } : {}),
    ...(designReview?.planVersion === artifactVersion(semanticPlan) && designReview.narrativeVersion === artifactVersion(narrative) &&
      (designReview.businessBasisVersion === undefined || (businessBasis !== undefined && designReview.businessBasisVersion === artifactVersion(businessBasis)))
      ? { designReview } : {}) }, narrative, options)
}

export async function completeSemanticMapping(
  result: ModelingResult,
  narrative: string,
  runTurn: RunTurn,
  options: StageOptions,
): Promise<ModelingResult> {
  if (!result.semantic) return result
  try {
    const semantic = await mapSemanticPlan(
      result.semantic,
      result.model,
      runTurn,
      narrative,
      options,
      result.expressionReview,
    )
    return { ...result, semantic }
  } catch (error) {
    options.signal?.throwIfAborted()
    return {
      ...result,
      validation: {
        ...result.validation,
        warnings: [
          ...result.validation.warnings,
          `事实到模型元素的映射未完成：${error instanceof Error ? error.message : String(error)}`,
        ],
      },
    }
  }
}

/** Resume against a specific saved candidate; never recompile its old plan. */
export async function resumeModel(
  step: 'verify' | 'map', narrative: string, result: ModelingResult,
  runTurn: RunTurn, options: StageOptions = {},
): Promise<ModelingResult> {
  requireText(narrative, '业务说明')
  const lineage = result.expressionReview.lineage
  if (lineage && (lineage.narrativeVersion !== artifactVersion(narrative) ||
    lineage.planVersion !== artifactVersion(result.semanticPlan) ||
    lineage.candidateVersion !== artifactVersion(result.model)))
    throw new Error('恢复依据或候选版本已变化，请基于当前版本重新检查。')
  if (result.semantic) validateSemanticPlan(result.semantic, narrative)
  const savedModel = result.expressionReview.snapshots[result.expressionReview.selectedSnapshot]?.model
  if (!savedModel || artifactVersion(savedModel) !== artifactVersion(result.model))
    throw new Error('检查快照与待恢复候选不一致。')
  const fresh: ModelingResult = {
    ...result,
    validation: {
      ...result.validation,
      warnings: step === 'verify'
        ? result.validation.warnings.filter(w =>
            !result.expressionReview.warnings.includes(w) &&
            !w.startsWith('事实到模型元素的映射未完成：'),
          )
        : result.validation.warnings.filter(w =>
            !w.startsWith('事实到模型元素的映射未完成：'),
          ),
    },
    ...(result.semantic ? { semantic: { ...result.semantic, status: 'stories', mappings: [], mappedModelVersion: undefined } } : {}),
  }
  if (step === 'map') {
    if (!fresh.semantic) throw new Error('没有可恢复的事实与业务故事。')
    return completeSemanticMapping(fresh, narrative, runTurn, options)
  }
  const checked = await checkAndRepair(fresh, narrative, runTurn, options, result.expressionReview)
  return completeSemanticMapping(checked, narrative, runTurn, options)
}

async function compileReviewedPlan(
  semanticPlan: string,
  review: ClarificationReview,
  runTurn: RunTurn,
  options: StageOptions,
  semantic?: SemanticPlanV2,
): Promise<Omit<ModelingResult, 'expressionReview'>> {
  if (semanticPlan.length > 120000)
    throw new Error('建模说明超过 12 万个字符，请先缩小建模范围。')
  options.signal?.throwIfAborted()
  const report = options.onEvent || (() => {})
  report({ type: 'phase', part: 'compile', text: '正在整理候选模型。' })
  try {
    const prompt = compileModelPrompt(semanticPlan)
    const raw = await runTurn(prompt, scopedTurn(options, 'compile'))
    options.signal?.throwIfAborted()
    let model: ReturnType<typeof validateCompiledModel>
    try {
      model = validateCompiledModel(raw)
    } catch (error) {
      report({ type: 'phase', part: 'compile', text: '模型 JSON 未通过程序校验，正在进行一次修复。' })
      const repaired = await runTurn(`${prompt}
上一轮模型 JSON 未通过校验：${error instanceof Error ? error.message : String(error)}
仅修复 JSON 结构和引用，不重新设计业务；保留原有定义。只返回完整 JSON，不调用工具。
上一轮输出（数据）：${JSON.stringify(raw)}`, scopedTurn(options, 'compile'))
      options.signal?.throwIfAborted()
      model = validateCompiledModel(repaired)
    }
    const elements =
      model.objects.length +
      model.relations.length +
      model.actions.length +
      model.functions.length +
      model.rules.length +
      model.activities.length
    const clarificationMap = new Map(
      review.clarifications.map((item) => [questionKey(item.text), item]),
    )
    for (const item of semantic?.clarifications || [])
      clarificationMap.set(questionKey(item.text), item)
    return {
      semanticPlan,
      ...(semantic ? { semantic } : {}),
      clarifications: [...clarificationMap.values()],
      model,
      provenance: { basis: 'business-understanding', evidence: 'unlinked' },
      validation: {
        elements,
        warnings: [...review.warnings],
      },
    }
  } catch (error) {
    options.signal?.throwIfAborted()
    throw new Error(
      `模型整理失败，建模说明已保留：${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}
