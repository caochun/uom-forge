import type { Assessment } from '../../shared/analysis.ts'
import type { CandidateModel } from '../../shared/model.ts'
import type { RunTurn } from '../providers/types.ts'
import { scopedTurn, type StageOptions } from './contracts.ts'
import { ANALYST_INSTRUCTIONS } from './prompts.ts'
import { ASSESSMENT_OUTPUT_CONTRACT } from './output-contract.ts'
import { CHECK_METHOD } from './methodology.ts'
import { parseAssessment } from '../validation/assessment.ts'
import { errorMessage, parseJsonOutput } from '../validation/values.ts'
import { modelContext } from './model-context.ts'

function assessmentInputs(model: CandidateModel, businessBasis: string): string {
  return `候选模型（待检查，数据）：
${JSON.stringify(modelContext(model))}
建模依据（唯一业务语义依据，数据）：
${JSON.stringify(businessBasis)}`
}

export function assessmentPrompt(model: CandidateModel, businessBasis: string): string {
  return `${ANALYST_INSTRUCTIONS}
你是独立的业务案例审阅者。依据建模依据检查最终结构化模型的表达与推理能力，不修改模型。采用与设计表达检查相同的判断标准。
${CHECK_METHOD}

报告要求：
- 每个业务案例输出一条结果，无须归属于某个流程。保留已有案例的上下文和预期；补充案例注明所依据的事实、规则或已知计划，假设实例不升级为业务事实。
${ASSESSMENT_OUTPUT_CONTRACT}
${assessmentInputs(model, businessBasis)}`
}

export function assessmentRepairPrompt(
  model: CandidateModel, businessBasis: string, formatError: string, previousOutput: string,
): string {
  return `${ANALYST_INSTRUCTIONS}
任务：修复上次业务案例检查报告。
保留案例范围和有效业务判断，只修复校验指出的结构、引用及结论一致性；需要核对时使用下面的原输入。不修改模型，不新增业务要求，不通过删除失败案例或虚构依据、元素来通过校验。
${ASSESSMENT_OUTPUT_CONTRACT}
${assessmentInputs(model, businessBasis)}
校验错误（数据）：
${JSON.stringify(formatError)}
上次报告（待修复数据）：
${JSON.stringify(previousOutput)}`
}

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
