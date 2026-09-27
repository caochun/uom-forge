import type { CandidateModel } from '../../shared/model.ts'
import type { RunTurn } from '../providers/types.ts'
import type { StageOptions } from './contracts.ts'
import { scopedTurn } from './contracts.ts'
import { ANALYST_INSTRUCTIONS } from './prompts.ts'
import { modelContext } from './model-context.ts'

export function modelNarrativePrompt(model: CandidateModel) {
  return `${ANALYST_INSTRUCTIONS}
你现在处于候选模型复述阶段。你只能依据下面给出的候选模型，用业务人员容易理解的自然语言重新描述它所表达的业务。
不要使用或推测任何业务文档、第一阶段业务理解或外部知识；不要新增模型没有表达的事实、对象、关系、操作或规则。
重点说明：核心对象与联系、业务操作的前提和状态变化、只读能力的结果、业务规则，以及模型已声明的边界和定义内部的歧义。
本阶段不提供业务需求或案例，不自行设定业务目标、评价需求覆盖或补全业务计划。对定义中未明确的含义如实说明，不把它自动判为业务缺口。
输出一段结构清晰的中文 Markdown，供用户从语言角度审阅候选模型；不要输出 JSON、代码围栏或引文。
候选模型：
${JSON.stringify(modelContext(model))}`
}

export async function narrateModel(
  model: CandidateModel,
  runTurn: RunTurn,
  options: StageOptions = {},
): Promise<{ narrative: string }> {
  const narrative = await runTurn(modelNarrativePrompt(model), scopedTurn(options, 'narrate'))
  options.signal?.throwIfAborted()
  if (!narrative.trim()) throw new Error('未返回模型自述。')
  return { narrative: narrative.trim() }
}
