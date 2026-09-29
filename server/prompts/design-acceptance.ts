import { ANALYST_INSTRUCTIONS } from './common.ts'
import { businessContextPrompt, type BusinessContext } from '../stages/business-context.ts'
import type { DesignAcceptance } from '../../shared/design-acceptance.ts'

export function designAcceptancePrompt(context: BusinessContext): string {
  return `${ANALYST_INSTRUCTIONS}
任务：在模型设计开始前，从业务来源确定核心业务结果及其信息承接的验收问题。本阶段不设计模型、不审阅建模依据，也不重做业务理解。
${businessContextPrompt(context)}

方法：
- 先用少量注明假设的实例值写一个代表性完整场景 scenario，明确初始事实、目标和有来源支持的不同路径；再写目标达成时的具体业务事实 outcome。原文没有过程时，用代表性业务状态及其查询目标；不编造流程。无法确定的内容保留未决。
- outcome 要使人知道最终形成或确认了什么、其内容是什么、属于谁，以及该业务需要的数量、期间、条件等；按实际业务选择，不能套通用字段模板。不能只写“完成某操作”“形成某结果”或“关联所选项”。假设实例不是新增业务要求，也不要求保存示例数据。
- 从这份结果事实反推 questions，逐项询问信息怎样从输入、选择或变化承接到结果，并保留不同路径下的必要区别。只有输入条件或操作名称，不能回答结果内容；只存在一个关联，也不能代替被关联内容的定义。
- 清单聚焦核心结果及必要信息承接。许可、限制、变化和未决仅在影响这些验收问题时列入；其余业务条款及案例由后续完整审阅继续核查，不在这里把每段原文机械改写成问题。
- 每项预期简要写明适用场景及验收标准；同一业务判断涉及的信息可以合并提问，避免反复拆分同义问题。问题可以通过不同的模型表达方式满足，不预定属性、类、关系、数据库结构或保存方式。
- sourceBlockIds 必须填写直接支持该问题的原文块编号；只使用输入中真实存在的编号。提供 sourceBlockIds 时 sourceQuote 可以留空，服务端会从编号对应的原文块复制准确引文；若填写 sourceQuote，仍须逐字摘录同一来源块中的必要连续原句。没有原文快照时可以省略 sourceBlockIds，但 sourceQuote 仍须逐字来自整理稿。reason 用简短说明解释它为何支持该问题。
- 区分表达已知业务所需的信息与原文未规定的业务政策。缺少建模术语不是业务未知；叙述顺序不自动成为强制先后。不得凭常识追加业务要求。
- 清单生成后在本次设计循环中固定编号、问题及预期。它是待验证的验收依据，不是新增业务事实；后续发现问题本身不成立时，必须保留该项并依据来源解释，不能删除或改弱预期以通过。

长度与数量：
- 通常只生成 3～6 个核心问题；来源实际只有 1～2 个独立核心结果时按实际保留，不为凑数拆分同义问题；不要超过 6 个。
- scope 控制在一两句，scenario 和 outcome 各用一小段说明即可。每个 question、reason、expected 各用一两句，直接说明验收点。
- sourceQuote 只摘录支撑该问题所必需的连续原句，优先一条、最多两条相邻短句；禁止复制整篇原文、完整整理稿或与问题无关的背景。
- 不输出分析过程、章节说明、重复的业务背景、实现建议或模型术语；JSON 之外不输出任何文字。

输出：只返回一个 JSON 对象，不加代码围栏。所有字段必填；文字用中文；数组 questions 至少一项，编号唯一；不能形成确定预期时明确未决和影响，不编造要求。
{ scope: string, scenario: string, outcome: string, questions: Question[] }
Question = { id: string, question: string, kind: "result" | "behavior" | "boundary", grounding: "explicit" | "inferred" | "unknown", sourceQuote: string, sourceBlockIds?: string[], reason: string, expected: string }
kind 分别表示结果内容、行为与约束、未决边界；只生成业务需要的项。`
}

export function acceptanceQuoteRepairPrompt(context: BusinessContext, questions: DesignAcceptance['questions']): string {
  return `${ANALYST_INSTRUCTIONS}
任务：定位下面验收问题所引用的原文，只修复引文的抄写差异。不重新生成问题、不改变验收预期、不作模型设计。逐项在已提供来源中找出原本引用的来源块编号；sourceBlockIds 必须逐字使用输入中存在的编号，服务端会从该来源块复制准确引文。找不到对应来源块时 sourceBlockIds 返回空数组，不能选一条无关来源来通过校验。
${businessContextPrompt(context)}
待校正引文的验收问题（问题及预期保持不变）：
${JSON.stringify(questions)}
只返回 JSON 对象 { "quotes": [{ "id": "原问题编号", "sourceBlockIds": ["来源块编号"] }] }，恰好覆盖给定编号。旧版兼容时可以同时返回 sourceQuote，但不得返回或修改其他字段。`
}
