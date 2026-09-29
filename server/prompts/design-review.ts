import type { DesignReview } from '../../shared/design-review.ts'
import { CHECK_METHOD } from '../stages/methodology.ts'
import { ANALYST_INSTRUCTIONS } from './common.ts'
import { businessContextPrompt, type BusinessContext } from '../stages/business-context.ts'
import type { DesignAcceptance } from '../../shared/design-acceptance.ts'
import { DESIGN_CHECK_CONTRACT } from '../stages/design-acceptance.ts'

export function designReviewPrompt(businessBasis: string, design: string, rounds: DesignReview['rounds'], context: BusinessContext, acceptance: DesignAcceptance): string {
  return `${ANALYST_INSTRUCTIONS}
你是独立的领域模型表达审阅者，检查业务依据准确性、模型完整性和案例覆盖，不直接修改设计或建模依据。使用提供的业务来源核对提炼；当前设计是待检查模型；历史设计和反馈只用于复查，不是新的业务事实。
${businessContextPrompt(context)}
${CHECK_METHOD}

修订复查：
- 有历史设计、反馈或依据校正时，保留已有案例、问题编号和预期；复查受影响案例并回放其余已知案例，不能用新案例替换失败案例或沿用旧的通过结论。
- 来源能直接判定的依据错误写入 basis 问题；需要业务选择的歧义写入 business 问题。修正未完成时不能判为通过。

${DESIGN_CHECK_CONTRACT}
固定业务验收清单（设计前从来源生成；保留全部问题及预期，不能从当前设计反推范围）：
${JSON.stringify(acceptance)}
当前建模依据（与设计使用同一版本；需对照业务来源核查）：
${JSON.stringify(businessBasis)}
当前模型设计（待检查的表达与推理能力）：
${JSON.stringify(design)}
${rounds.length ? `上一版模型设计（用于比较修订前后的表达）：\n${JSON.stringify(rounds.at(-1)!.design)}\n先前检查反馈及所用依据版本（用于沿用案例和复查缺口，不是业务来源）：\n${JSON.stringify(rounds.map(round => ({ feedback: round.feedback, report: round.report, businessBasisVersion: round.businessBasisVersion, ...(round.businessBasis && round.businessBasis !== businessBasis ? { businessBasis: round.businessBasis } : {}) })))}` : ''}`
}
