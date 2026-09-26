import { normalizeModelPlan } from './markdown-sections.ts'
import { validateCompiledModel } from '../validation/compiled-model.ts'
import { requireText } from '../validation/document.ts'
import { compileModelPrompt } from './prompts.ts'
import type { ModelingInput, ModelingResult } from '../../shared/analysis.ts'
import type { RunTurn } from '../providers/types.ts'
import { scopedTurn, type StageOptions } from './contracts.ts'
import {
  questionKey,
  reviewModelClarifications,
  type ClarificationReview,
} from '../../shared/clarifications.ts'
import { runPiModeling } from '../agents/pi-modeling.ts'
import { prepareBusinessBasis } from './business-basis.ts'
import { artifactVersion } from '../../shared/workflow.ts'
import type { DesignReview } from '../../shared/design-review.ts'

export async function buildModel(
  input: ModelingInput,
  runTurn: RunTurn,
  options: StageOptions = {},
): Promise<ModelingResult> {
  requireText(input.narrative, '业务说明')
  const report = options.onEvent || (() => {})
  options.signal?.throwIfAborted()
  const businessBasis = await prepareBusinessBasis(input.narrative, options)
  options.signal?.throwIfAborted()
  report({ type: 'phase', part: 'design', text: '正在生成模型设计。' })
  let modelDesign: string
  let designReview: DesignReview | undefined
  const designed = await (options.agents?.modeling || runPiModeling)(input, runTurn, options, businessBasis)
  modelDesign = designed.modelDesign
  designReview = designed.designReview
  options.signal?.throwIfAborted()
  if (!modelDesign.trim()) throw new Error('未返回建模说明。')
  modelDesign = normalizeModelPlan(modelDesign)
  const review = reviewModelClarifications(modelDesign, input.narrative, businessBasis)
  // Publish before compilation so errors or cancellation cannot erase it.
  report({ type: 'model-design', part: 'design', modelDesign, ...review })
  options.signal?.throwIfAborted()
  const compiled = await compileReviewedPlan(
    modelDesign,
    review,
    runTurn,
    options,
  )
  return { ...compiled, businessBasis, ...(designReview ? { designReview } : {}) }
}

// Compilation is the only mandatory machine-readable boundary.
export async function compileModel(
  modelDesign: string,
  narrative: string,
  runTurn: RunTurn,
  options: StageOptions = {},
  businessBasis?: string,
  designReview?: DesignReview,
): Promise<ModelingResult> {
  if (typeof modelDesign !== 'string' || !modelDesign.trim())
    throw new Error('请先完成建模说明。')
  requireText(narrative, '业务说明')
  const compiled = await compileReviewedPlan(
    modelDesign,
    reviewModelClarifications(modelDesign, narrative, businessBasis),
    runTurn,
    options,
  )
  return { ...compiled, ...(businessBasis !== undefined ? { businessBasis } : {}),
    ...(designReview?.planVersion === artifactVersion(modelDesign) && designReview.narrativeVersion === artifactVersion(narrative) &&
      (designReview.businessBasisVersion === undefined || (businessBasis !== undefined && designReview.businessBasisVersion === artifactVersion(businessBasis)))
      ? { designReview } : {}) }
}

async function compileReviewedPlan(
  modelDesign: string,
  review: ClarificationReview,
  runTurn: RunTurn,
  options: StageOptions,
): Promise<ModelingResult> {
  if (modelDesign.length > 120000)
    throw new Error('建模说明超过 12 万个字符，请先缩小建模范围。')
  options.signal?.throwIfAborted()
  const report = options.onEvent || (() => {})
  report({ type: 'phase', part: 'compile', text: '正在整理候选模型。' })
  try {
    const prompt = compileModelPrompt(modelDesign)
    const raw = await runTurn(prompt, scopedTurn(options, 'compile'))
    options.signal?.throwIfAborted()
    let model: ReturnType<typeof validateCompiledModel>
    try {
      model = validateCompiledModel(raw)
    } catch (error) {
      report({ type: 'phase', part: 'compile', text: '模型 JSON 未通过程序校验，正在进行一次修复。' })
      const repaired = await runTurn(`${prompt}
修复任务：上一轮 JSON 未通过程序校验。
- 错误信息：${error instanceof Error ? error.message : String(error)}
- 只修复 JSON 结构、必需字段和引用关系；保留原有模型定义，不重新设计业务。
- 只返回完整 JSON，不调用工具，也不要附加解释。
上一轮输出（数据）：${JSON.stringify(raw)}`, scopedTurn(options, 'compile'))
      options.signal?.throwIfAborted()
      model = validateCompiledModel(repaired)
    }
    const elements =
      model.objects.length +
      model.relations.length +
      model.actions.length +
      model.functions.length +
      model.rules.length
    const clarificationMap = new Map(
      review.clarifications.map((item) => [questionKey(item.text), item]),
    )
    return {
      modelDesign,
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
