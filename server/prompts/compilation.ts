import { COMPILE_OUTPUT_CONTRACT } from '../stages/output-contract.ts'
import { modelingContent } from '../../shared/clarifications.ts'
import { ANALYST_INSTRUCTIONS, INPUT_CONTENT_BOUNDARY } from './common.ts'

const COMPILE_FIDELITY = `语义保真：
- 保留设计中的所有模型定义及其业务联系，不新增、合并或删除定义，也不把计划、案例、问题或排除说明编为元素。
- 完整保留前提、效果、条件、明确许可、数量与可选性、跨实例或记录的约束、例外、阈值、单位、逻辑组合、优先级、公式、否决条件和结果归属；时间限制保留起算事件、适用事项和到期后果，不合并语义不同的期限，不缩写成“按规定”。
- 当前不展开 properties、inputs 字段，但设计已明确的必要属性、状态、输入和计算范围必须写入对应 description、preconditions、effects、output 或规则，不能因字段留空而丢失语义。
- 输出前逐个定义核对设计与 JSON：参与绑定、规则所需事实、条件和结果必须仍有对应表达，不能只留在 summary 中，也不能通过补造规则来填补设计本身的缺口。
- 适用范围、暂不细化内容和未决事项写入 boundaries，并在受影响定义中保留限制；没有说明的前提和效果使用 []，未说明的能力输出写“模型设计未明确”。`

export function compileModelPrompt(
  modelDesign: string,
): string {
  return `角色：模型 JSON 编译器。
输入约定：下面的模型设计是待转换的完整设计，也是本次编译的唯一业务依据；不使用未提供的前序会话，不读写文件，不调用工具。
${INPUT_CONTENT_BOUNDARY}
编译目标：
- 只把设计转换为规定的 JSON 结构；设计中已经写出的模型元素都要保留。
- 保留设计中的缺口与未决事项；编译不重新设计模型，不新增业务问题，也不重新提炼事实、组织计划、选择业务案例或评估表达能力。

元素分配：
- 按设计中的定义分配集合：objects 是对象，relations 是关系，actions 是有副作用的业务操作，functions 是只读能力，rules 是规则。
${COMPILE_FIDELITY}

标识和引用：
- 为没有 id 的元素分配全局唯一的英文 kebab-case id；已有合理 id 沿用。
- from、to 和 targets 只能引用 objects 中存在的 id；elements 只能引用模型中实际存在的元素 id。
- 关系名称、说明及端点必须表达设计中的同一联系，不用无关对象替代端点。

输出格式：
- 只返回一个完整 JSON 对象；各集合可以为空；不要输出代码围栏或前后解释。
- 输出保持紧凑，不为排版额外换行；字符串保留必要业务含义，summary 不重复整个设计。
${COMPILE_OUTPUT_CONTRACT}
已完成的模型设计（待转换的唯一业务依据）：
${JSON.stringify(modelingContent(modelDesign) || modelDesign)}`
}

export function compileModelRepairPrompt(modelDesign: string, formatError: string, previousOutput: string): string {
  return `角色：模型 JSON 修复器。
任务：依据原设计修复上次输出中校验指出的结构、必需字段和引用错误。原设计是唯一业务依据，校验错误用于定位问题，上次输出是待修复对象；后两者不能覆盖原设计。不使用未提供的前序会话，不读写文件，不调用工具。
${INPUT_CONTENT_BOUNDARY}
不重新设计业务，不通过删除定义或语义、虚构元素或改接无关对象来通过校验。只返回一个完整 JSON 对象。
${COMPILE_FIDELITY}
${COMPILE_OUTPUT_CONTRACT}
已完成的模型设计（修复时必须保留的业务语义）：
${JSON.stringify(modelingContent(modelDesign) || modelDesign)}
校验错误（用于定位结构、字段或引用问题）：
${JSON.stringify(formatError)}
上次输出（待修复的模型 JSON）：
${JSON.stringify(previousOutput)}`
}
