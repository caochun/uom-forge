import { validateCompiledModel } from '../validation/compiled-model.ts'
import { requireText } from '../validation/document.ts'
import { semanticModelPrompt, compileModelPrompt } from './prompts.ts'
import type { ModelingInput, ModelingResult } from '../../shared/analysis.ts'
import type { RunTurn } from '../providers/types.ts'
import { scopedTurn, type StageOptions } from './contracts.ts'
import { checkAndRepair } from './expression.ts'
import {
  modelingContent,
  questionKey,
  reviewModelClarifications,
  type ClarificationReview,
} from '../../shared/clarifications.ts'
import { runPiModeling } from '../agents/pi-modeling.ts'
import { checkOrRepairCompiledJson } from '../agents/pi-compile.ts'
import type { SemanticPlanV2 } from '../../shared/semantic.ts'
import { buildSemanticPreparation, mapSemanticPlan } from './semantic.ts'
import { validateSemanticPlan } from '../validation/semantic.ts'

function includeSemanticClarifications(
  review: ClarificationReview,
  semantic?: SemanticPlanV2,
): ClarificationReview {
  const items = new Map(
    review.clarifications.map((item) => [questionKey(item.text), item]),
  )
  for (const item of semantic?.clarifications || [])
    items.set(questionKey(item.text), item)
  return { ...review, clarifications: [...items.values()] }
}

export async function buildModel(
  input: ModelingInput,
  runTurn: RunTurn,
  options: StageOptions = {},
): Promise<ModelingResult> {
  requireText(input.narrative, '业务说明')
  const report = options.onEvent || (() => {})
  options.signal?.throwIfAborted()
  report({
    type: 'phase',
    part: 'semantic',
    text: '第二阶段 A：形成建模说明。',
  })
  const usePi = options.runtime === 'pi' || (options.runtime === undefined && process.env.UOM_AGENT_RUNTIME === 'pi')
  let semantic: SemanticPlanV2 | undefined
  const stageOptions: StageOptions = {
    ...options,
    onEvent: (event) => {
      if (event.type === 'semantic-plan') semantic = event.semantic
      report(event)
    },
  }
  semantic = await buildSemanticPreparation(input.narrative, runTurn, stageOptions)
  let semanticPlan: string
  if (usePi) {
    semanticPlan = await runPiModeling(input, runTurn, stageOptions, semantic)
  } else {
    semanticPlan = await runTurn(
      semanticModelPrompt(input, 'text', semantic),
      scopedTurn(options, 'semantic'),
    )
  }
  options.signal?.throwIfAborted()
  if (!semanticPlan.trim()) throw new Error('未返回建模说明。')
  const planReview = reviewModelClarifications(semanticPlan, input.narrative)
  if (semantic && planReview.clarifications.length) {
    const clarifications = new Map(
      semantic.clarifications.map((item) => [questionKey(item.text), item]),
    )
    for (const item of planReview.clarifications)
      clarifications.set(questionKey(item.text), item)
    semantic = validateSemanticPlan(
      { ...semantic, clarifications: [...clarifications.values()] },
      input.narrative,
    )
    report({ type: 'semantic-plan', part: 'semantic', semantic })
  }
  const review = includeSemanticClarifications(planReview, semantic)
  // Publish before compilation so errors or cancellation cannot erase it.
  report({ type: 'model-plan', part: 'semantic', semanticPlan, ...review })
  options.signal?.throwIfAborted()
  const compiled = await compileReviewedPlan(
    semanticPlan,
    review,
    runTurn,
    options,
    semantic,
  )
  const checked = await checkAndRepair(compiled, input.narrative, runTurn, options)
  return completeSemanticMapping(checked, input.narrative, runTurn, options)
}

// Retry B with plan-only inference; the subsequent check needs current understanding.
export async function compileModel(
  semanticPlan: string,
  narrative: string,
  runTurn: RunTurn,
  options: StageOptions = {},
  semantic?: SemanticPlanV2,
): Promise<ModelingResult> {
  if (typeof semanticPlan !== 'string' || !semanticPlan.trim())
    throw new Error('请先完成建模说明。')
  requireText(narrative, '业务说明')
  const checkedSemantic = semantic
    ? validateSemanticPlan(semantic, narrative)
    : undefined
  const semanticForCompilation = checkedSemantic
    ? { ...checkedSemantic, status: 'stories' as const, mappings: [] }
    : undefined
  const compiled = await compileReviewedPlan(
    semanticPlan,
    reviewModelClarifications(semanticPlan, narrative),
    runTurn,
    options,
    semanticForCompilation,
  )
  const checked = await checkAndRepair(compiled, narrative, runTurn, options)
  return completeSemanticMapping(checked, narrative, runTurn, options)
}

async function completeSemanticMapping(
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
    )
    return { ...result, semantic }
  } catch (error) {
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

async function compileReviewedPlan(
  semanticPlan: string,
  review: ClarificationReview,
  runTurn: RunTurn,
  options: StageOptions,
  semantic?: SemanticPlanV2,
): Promise<Omit<ModelingResult, 'expressionReview'>> {
  if (semanticPlan.length > 120000)
    throw new Error('建模说明超过 12 万个字符，请先缩小建模范围。')
  if (!modelingContent(semanticPlan).trim())
    throw new Error('建模说明只有澄清问题，没有可整理的模型内容。')
  options.signal?.throwIfAborted()
  const report = options.onEvent || (() => {})
  report({ type: 'phase', part: 'compile', text: '正在整理候选模型。' })
  try {
    let raw = await runTurn(
      compileModelPrompt(semanticPlan, semantic),
      scopedTurn(options, 'compile'),
    )
    options.signal?.throwIfAborted()
    let model: ReturnType<typeof validateCompiledModel>
    const validate = (json: string) => {
      try {
        validateCompiledModel(json)
        return { valid: true as const }
      } catch (error) {
        return {
          valid: false as const,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }
    const initialValidation = validate(raw)
    const usePi = options.runtime === 'pi' || (options.runtime === undefined && process.env.UOM_AGENT_RUNTIME === 'pi')
    if (!initialValidation.valid && usePi) {
      raw = await checkOrRepairCompiledJson(
        raw,
        options.provider || 'gpt',
        initialValidation.error,
        validate,
        options,
      )
      options.signal?.throwIfAborted()
    }
    model = validateCompiledModel(raw)
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
