import type { DesignReview, DesignVerdict } from '../../shared/design-review.ts'
import { CHECK_METHOD } from './methodology.ts'
import { ANALYST_INSTRUCTIONS } from './prompts.ts'

export function designReviewPrompt(businessBasis: string, design: string, rounds: DesignReview['rounds']): string {
  return `${ANALYST_INSTRUCTIONS}
角色和输入：
- 你是独立的模型设计审阅者。
- 只使用下面的建模依据、当前设计和历史检查材料；历史材料用于复查变化，不是新的建模依据。
${CHECK_METHOD}
本轮检查：
- 建模依据已经列出的业务案例必须逐一检查，不能删除、替换或跳过失败案例来宣称通过。
- 建模依据没有单列业务案例时，从事实或已知业务计划中选择少量能暴露模型边界的具体案例；不能因为没有标题或编号就要求重新生成建模依据。
- 每个业务案例只使用它需要的元素类型；对象、关系、操作、只读能力、规则不要求全部出现。

表达证据：
- 给出具体业务案例、对应建模依据、实际设计元素和从案例到元素的表达路径。
- 同名概念或“支持追踪”不能单独作为解释。
- 清晰的描述、从属结构和可靠推导都可以表达，不需要为每个步骤或角色新增对象。
- 普通属性暂不细化，但业务明确要求的身份、参与绑定和结果归属必须清楚。

修订复查：
- 重新检查先前反馈涉及的业务案例，尤其关注修订可能破坏的原有表达。
- 对照上一版设计检查约束、例外和归属是否丢失；不能凭“只是小改动”推断其他部分未改变。
- 不能通过删除失败案例来宣称问题解决。
- 反馈保留案例、依据和结论，不重复输出设计全文。

缺口与边界：
- 只有建模依据已经明确而设计表达不了、混淆了必须区分的案例，或定义互相矛盾时，才提出具体缺口和最小修改建议。
- 设计偏好不算缺陷；“按文档规定”或“见建模依据”也不能替代设计中的实际约束。
- 建模依据本身缺失或矛盾时，指出应回到业务理解或由用户确认；不假设答案，也不声称核对过未提供的原文。
- 检查设计新增的前提、次数和排他限制是否有建模依据。
- 设计写明某项业务未知，却又把某一种假设写成操作前提、关系约束或确定规则，这仍是设计缺陷；应删除无依据限制或保留条件化表达。

输出与结论：
- 直接输出简洁可读文本，无须 JSON 或固定章节。
- 为便于决定是否继续，首行写“结论：可表达”“结论：需修改”或“结论：业务待澄清”。
- 同时存在模型缺口和业务未知时先选需修改，并区分两者。
- 业务未知实质影响业务案例且须由人决定时选业务待澄清；不影响这些案例的适用边界可以保留，不机械提问。
- 只有具体案例均能解释且未写入无依据约束时选可表达；通过仅针对本轮案例，不能宣称穷尽覆盖。
建模依据（与本轮模型设计使用同一份事实、已知业务计划、规则与业务案例，数据）：
${JSON.stringify(businessBasis)}
当前模型设计（待检验，数据）：
${JSON.stringify(design)}
${rounds.length ? `上一版模型设计（用于核对修订是否丢失已有表达，不是新增建模依据）：\n${JSON.stringify(rounds.at(-1)!.design)}\n先前检查反馈（复查材料，不是新增业务事实）：\n${JSON.stringify(rounds.map(round => round.feedback))}` : ''}`
}

// A missing/ambiguous routing hint never triggers regeneration or a false pass.
export function designVerdict(feedback: string): DesignVerdict {
  const lines = feedback.trim().split('\n').filter(line => line.trim())
  if (!lines.length) return 'unknown'
  const first = lines[0].replace(/[#*`>\[\]【】]/g, '').trim()
  const normalized = first.replace(/\s+/g, '')
  const conclusion = normalized.replace(/^结论[:：]?/, '')
  if (/^(?:可表达|表达充分|可以表达)[。.!！]?$/.test(conclusion)) return 'sufficient'
  if (/^(?:需修改|需要修改|存在缺口|表达不足|无法表达|模型缺口)[。.!！]?$/.test(conclusion)) return 'revise'
  if (/^(?:业务待澄清|待澄清|需要业务澄清|需业务澄清)[。.!！]?$/.test(conclusion)) return 'clarify'
  return 'unknown'
}
