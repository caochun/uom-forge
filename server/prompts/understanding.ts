import type { BusinessDocument } from '../../shared/analysis.ts'
import { READING_METHOD } from '../stages/methodology.ts'
import { SOURCE_INSTRUCTIONS } from '../../shared/understanding-sources.ts'
import { ANALYST_INSTRUCTIONS } from './common.ts'

export const UNDERSTANDING_INSTRUCTIONS = `${ANALYST_INSTRUCTIONS}

阶段目标：
- 第一阶段是一项文档阅读工作：整理文档实际说了什么，并指出哪些地方没有说清楚或前后不一致。
- 它回答：“文档在说什么，是否说清楚、说一致了？”
- 产出要让业务人员可以直接审阅，并能作为下一阶段提取建模依据的输入。

输出形式：
- 输出忠实、清晰的 Markdown 整理稿，必要时附问题说明。
- 组织方式自由，不要求固定章节；正文要保留业务内容，不能只给摘要、修改建议或自检报告。

整理规则：
- 按原文最容易理解的方式重排章节、句子、条件和结论。
- 可以合并真正表达同一含义的重复句，也可以补出上下文已经明确的省略和指代。
- 每处改写都必须能在上下文中找到依据；含义不同的说法不能为了简洁合并。
- 上下文唯一确定的含义可以直接整理；从明确条件推导出的结论说明推导依据。存在多种解释或需要增加前提才能成立的内容保留未决。
${READING_METHOD}

本阶段的产出边界：
- 本阶段的输出是文档整理稿，不是领域模型设计。不要把内容改写成对象、关系、操作、能力或规则清单。
- 业务事实、已知业务计划和业务案例由下一阶段从整理稿中提取；本阶段只把原文和问题整理清楚。
- 原文已经表达的业务内容必须保留；无法判断的内容保留为未决，不用模型设计替它补答案。

待确认问题：
- 只有上下文无法解决，且不同答案会改变文档含义的问题才请求确认。
- 原文没有涉及的业务或实现细节不自动列为问题。
- 有问题时增加“## 待确认问题”，逐项编号；有限答案在下一行写“选项：答案一；答案二”，允许多个答案时写“多选：答案一；答案二”。没有合理选项时省略选项行。

${SOURCE_INSTRUCTIONS}`

export function understandingPrompt(document: BusinessDocument): string {
  return `${UNDERSTANDING_INSTRUCTIONS}
输入文档（待阅读的原文，业务内容来源）：
${JSON.stringify({ name: document.name, blocks: document.blocks })}`
}

