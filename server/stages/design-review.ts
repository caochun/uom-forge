import type { DesignReview, DesignVerdict } from '../../shared/design-review.ts'
import { CORE_QUESTION } from './methodology.ts'
import { ANALYST_INSTRUCTIONS } from './prompts.ts'

export function designReviewPrompt(businessBasis: string, design: string, rounds: DesignReview['rounds']): string {
  return `${ANALYST_INSTRUCTIONS}
你是独立的模型设计审阅者。核心问题：${CORE_QUESTION}
沿用本轮业务依据已经给出的检验情形，尝试仅用当前设计表达；依据未单列情形时，从其中的事实或故事选择少量具体情形，不因缺少标题或编号要求重生成。可根据同一份依据补充遗漏的关键情形，不能换掉已有情形来规避缺口。说明参与者与事项如何绑定，操作如何改变状态，只读能力如何提供结果，规则如何约束前提、效果和例外。只使用该情形需要的元素类型，不要求五类俱全。
给出具体情形、相关业务依据、实际设计元素及表达路径；只有同名概念或“支持追踪”不算解释。描述、从属结构和可靠推导可以表达，无需为每个步骤或角色新增对象。普通属性暂不细化；身份、参与绑定和结果归属不能含糊。
复查先前反馈中的情形，尤其是修订可能破坏的已表达情形；结合上一版设计检查约束、例外及归属是否丢失，不凭修订意图宣称其他部分未改变。不得通过删掉失败情形宣称问题解决。反馈保留本轮情形、所用依据及结论，不重复设计全文。
只有业务依据已明确但设计表达不了、混淆了需要区分的情形或自相矛盾时，提出具体缺口与最小修改建议。不要把设计偏好当作缺陷，不得用业务依据替设计补齐语义；“按文档规定”或“见业务依据”不能替代实际约束。依据本身缺失或矛盾，指出应核对整理稿或由人确认的边界，不假设答案，也不声称已核对未提供的原文。
同时核对设计新增的前提、次数或排他限制是否有依据。声明某项业务未知，却又把一种假设写成操作前提、关系约束或确定规则，是设计缺陷；末尾声明边界不能抵消这种矛盾，应去掉无依据的限制或如实保留条件化语义，不必强迫用户先选答案。
直接输出简洁可读文本，无须 JSON 或固定章节。为便于决定是否继续，可在首行写“结论：可表达”“结论：需修改”或“结论：业务待澄清”。同时存在模型缺口和业务未知时先选需修改，并区分两者。业务未知实质影响所检验情形且须由人决定时选业务待澄清；不影响这些情形的适用边界可以保留，不机械提问。只有具体情形均能解释且未写入无依据约束时选可表达；通过仅针对本轮情形，不能宣称穷尽覆盖。
业务依据（与本轮模型设计使用同一份事实、故事、规则与检验情形，数据）：
${JSON.stringify(businessBasis)}
当前模型设计（待检验，数据）：
${JSON.stringify(design)}
${rounds.length ? `上一版模型设计（用于核对修订是否丢失已有表达，不是新增业务依据）：\n${JSON.stringify(rounds.at(-1)!.design)}\n先前检查反馈（复查材料，不是新增业务事实）：\n${JSON.stringify(rounds.map(round => round.feedback))}` : ''}`
}

// A missing/ambiguous routing hint never triggers regeneration or a false pass.
export function designVerdict(feedback: string): DesignVerdict {
  const lines = feedback.trim().split('\n').filter(line => line.trim())
  if (lines.length < 2) return 'unknown'
  const first = lines[0].replace(/[#*`>\[\]【】]/g, '').trim()
  const match = /^(?:结论\s*[:：]\s*)?(可表达|需修改|业务待澄清)[。.!！]?\s*$/.exec(first)
  return match?.[1] === '可表达' ? 'sufficient' : match?.[1] === '需修改' ? 'revise'
    : match?.[1] === '业务待澄清' ? 'clarify' : 'unknown'
}
