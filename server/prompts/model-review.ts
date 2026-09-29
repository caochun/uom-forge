import type { CandidateModel } from '../../shared/model.ts'
import { ANALYST_INSTRUCTIONS } from './common.ts'
import { CHECK_METHOD } from '../stages/methodology.ts'
import { ASSESSMENT_OUTPUT_CONTRACT } from '../stages/output-contract.ts'
import { modelContext } from '../stages/model-context.ts'

export function modelNarrativePrompt(model: CandidateModel) {
  return `${ANALYST_INSTRUCTIONS}
你现在处于候选模型复述阶段。你只能依据下面给出的候选模型，用业务人员容易理解的自然语言重新描述它所表达的业务。
不要使用或推测任何业务文档、第一阶段业务理解或外部知识；不要新增模型没有表达的事实、对象、关系、操作或规则。
重点说明：核心对象与联系、业务操作的前提和状态变化、只读能力的结果、业务规则，以及模型已声明的边界和定义内部的歧义。
本阶段不提供业务需求或案例，不自行设定业务目标、评价需求覆盖或补全业务计划。对定义中未明确的含义如实说明，不把它自动判为业务缺口。
输出一段结构清晰的中文 Markdown，供用户从语言角度审阅候选模型；不要输出 JSON、代码围栏或引文。
候选模型（待复述的唯一语义来源）：
${JSON.stringify(modelContext(model))}`
}

function assessmentInputs(model: CandidateModel, businessBasis: string): string {
  return `候选模型（待检查的表达与推理能力）：
${JSON.stringify(modelContext(model))}
建模依据（唯一业务语义依据）：
${JSON.stringify(businessBasis)}`
}

export function assessmentPrompt(model: CandidateModel, businessBasis: string): string {
  return `${ANALYST_INSTRUCTIONS}
你是独立的业务案例审阅者。依据建模依据检查最终结构化模型的表达与推理能力，不修改模型。采用与设计表达检查相同的判断标准。
${CHECK_METHOD}

报告要求：
- 每个业务案例输出一条结果，无须归属于某个流程。保留已有案例的标识、上下文和预期，对照案例分别报告两侧；输出前核对是否遗漏或合并了预期不同的案例。补充案例注明所依据的事实、规则或已知计划，假设实例不升级为业务事实。
${ASSESSMENT_OUTPUT_CONTRACT}
${assessmentInputs(model, businessBasis)}`
}

export function assessmentRepairPrompt(model: CandidateModel, businessBasis: string, formatError: string, previousOutput: string): string {
  return `${ANALYST_INSTRUCTIONS}
任务：修复上次业务案例检查报告。
保留案例范围和有效业务判断，只修复校验指出的结构、引用及结论一致性。建模依据用于判断业务要求，候选模型用于核对实际表达，校验错误用于定位问题，上次报告是待修复对象。不修改模型，不新增业务要求，不通过删除失败案例或虚构依据、元素来通过校验。
${ASSESSMENT_OUTPUT_CONTRACT}
${assessmentInputs(model, businessBasis)}
校验错误（用于定位报告结构、引用或结论一致性问题）：
${JSON.stringify(formatError)}
上次报告（待修复的业务案例检查报告）：
${JSON.stringify(previousOutput)}`
}

