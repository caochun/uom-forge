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
- 有历史设计或反馈时，沿用建模依据中的案例以及此前补充且有依据支持的案例，保留标识、上下文和预期；补充案例不能替换失败案例。重新检查受影响的案例，并回放其余案例，比较前后设计是否丢失已有约束、许可、例外或归属；不能因改动很小而跳过复查。
- 历史依据有校正时，先核对校正是否有业务来源支持；受影响案例保留标识并说明预期为何改变，其余案例继续回放。旧的通过结论不能直接沿用。修正尚未完成时不能判为通过。

${DESIGN_CHECK_CONTRACT}
固定业务验收清单（设计前从来源生成；保留全部问题及预期，不能从当前设计反推范围）：
${JSON.stringify(acceptance)}
当前建模依据（与设计使用同一版本；需对照业务来源核查）：
${JSON.stringify(businessBasis)}
当前模型设计（待检查的表达与推理能力）：
${JSON.stringify(design)}
${rounds.length ? `上一版模型设计（用于比较修订前后的表达）：\n${JSON.stringify(rounds.at(-1)!.design)}\n先前检查反馈及所用依据版本（用于沿用案例和复查缺口，不是业务来源）：\n${JSON.stringify(rounds.map(round => ({ feedback: round.feedback, report: round.report, businessBasisVersion: round.businessBasisVersion, ...(round.businessBasis && round.businessBasis !== businessBasis ? { businessBasis: round.businessBasis } : {}) })))}` : ''}`
}

