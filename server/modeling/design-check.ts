import { INPUT_CONTENT_BOUNDARY } from '../prompts/common.ts'

export const MAX_DESIGN_ROUNDS = 3

export const MODELING_SYSTEM_PROMPT = `依据模型设计提示词给定的业务来源和当前建模依据完成设计与修订。仅可调用提供的 check_expression 表达检查工具。
${INPUT_CONTENT_BOUNDARY}
Pi 设计迭代：
- 每轮先输出一份完整而简洁的当前模型设计，再在同一轮调用 check_expression。
- 首轮已提供从业务来源独立生成的固定验收清单。逐项将必要语义落在实际定义中；修订沿用问题编号和验收预期，不能删掉失败项。
- check_expression 会自动读取这份正文；不要把设计复制到工具参数中。
- 工具先检查固定验收和核心表达/推理，再按业务依据检查相关边界；依据正确时修订受影响的定义。
- 依据有可直接纠正的提炼错误时，程序先校正依据并通过工具结果返回新版，再据此修订设计；保留没有受到影响的定义和已有案例，不用新案例替换失败案例。
- 审阅意见不是新的业务事实；业务本身未决时保留边界，不替用户选择答案。
- 工具返回的最新依据取代此前版本；复查受影响案例，模型必须承载核心结果的必要信息，不能只列操作名称或把确定的模型缺口推给业务澄清。
- 修订轮仍然输出完整设计并调用检查；不要输出工作计划或重复整份检查报告。
- 最多进行三轮检查。`

export const EXPRESSION_CHECK_DESCRIPTION = '先对照业务来源和固定验收清单检查核心表达与推理，再按业务依据检查相关边界和历史回归。可直接纠正的提炼错误由程序校正依据并返回新版；模型缺口返回修订意见。先输出完整设计；工具自动读取正文，无须传入参数。'

export const designRevisionMessage = (feedback: string) => `表达检查反馈（不是新增业务事实）：\n${feedback}\n请按问题编号及修复验收条件修订完整设计，将缺失内容、承接或条件写入实际定义；复查受影响路径并回放已通过项，然后再次检查。保留业务未决边界，不删除验收问题。`

export const basisRevisionMessage = (feedback: string, basis: string) => `上一轮审阅意见（用于定位问题，不是业务事实）：\n${feedback}\n程序已完成一次依据校正；下列完整新版取代初始及历史依据，仍须在后续审阅中核对业务来源。按新版修订完整设计，重新检查受影响案例并回放其余案例。\n当前建模依据：\n${JSON.stringify(basis)}`
