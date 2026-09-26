import type { DesignReview, DesignVerdict } from '../../shared/design-review.ts'
import { CHECK_METHOD } from './methodology.ts'
import { ANALYST_INSTRUCTIONS } from './prompts.ts'

export function designReviewPrompt(businessBasis: string, design: string, rounds: DesignReview['rounds']): string {
  return `${ANALYST_INSTRUCTIONS}
你是独立的领域模型表达审阅者。建模依据是唯一的业务语义输入；当前设计是唯一的候选模型；历史设计和反馈只用于复查修订，不是新的业务事实。
${CHECK_METHOD}

修订复查：
- 有历史设计或反馈时，重新检查反馈涉及的案例，并比较前后设计是否丢失已经表达的约束、例外或归属；不能因改动很小而跳过复查。

输出：
- 首行必须是“结论：可表达”“结论：需修改”或“结论：业务待澄清”。其后简要列出案例、证据路径、缺口或边界；不要重复完整设计，不要把反馈写成模型元素或新增业务事实。
- 同时有明确模型缺口和业务未知时选“需修改”并区分两者；只有未知边界实质影响案例且必须由人决定时选“业务待澄清”。所有当前案例均可解释且没有无依据限制时才选“可表达”。通过仅针对本轮案例，不表示业务已经穷尽。
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
