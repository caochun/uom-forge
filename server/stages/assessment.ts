import type { Assessment } from '../../shared/analysis.ts'
import type { CandidateModel } from '../../shared/model.ts'
import type { RunTurn } from '../providers/types.ts'
import { scopedTurn, type StageOptions } from './contracts.ts'
import { assessmentPrompt, assessmentRepairPrompt } from '../prompts/model-review.ts'
import { parseAssessment } from '../validation/assessment.ts'
import { errorMessage, parseJsonOutput } from '../validation/values.ts'
export { assessmentPrompt, assessmentRepairPrompt } from '../prompts/model-review.ts'

export async function assessModel(
  model: CandidateModel,
  businessBasis: string,
  runTurn: RunTurn,
  options: StageOptions = {},
): Promise<{ assessment: Assessment }> {
  let formatError = ''
  let previousOutput = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    options.signal?.throwIfAborted()
    const prompt = attempt === 0
      ? assessmentPrompt(model, businessBasis)
      : assessmentRepairPrompt(model, businessBasis, formatError, previousOutput)
    const raw = await runTurn(prompt, scopedTurn(options, 'assess'))
    options.signal?.throwIfAborted()
    try {
      return {
        assessment: parseAssessment(parseJsonOutput(raw, '评估结果'), model, businessBasis),
      }
    } catch (error) {
      formatError = errorMessage(error)
      previousOutput = raw
      if (attempt === 1) throw error
      options.onEvent?.({
        type: 'phase',
        text: '案例检查报告未通过校验，正在修复结构、引用和结论一致性。',
      })
    }
    options.signal?.throwIfAborted()
  }
  throw new Error('评估未返回有效结果。')
}
