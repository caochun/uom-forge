import { readFile, writeFile } from 'node:fs/promises'
import type { CandidateModel } from '../shared/model.ts'
import { TEXT_SYSTEM_PROMPT } from '../server/agents/pi-text.ts'
import {
  MODELING_SYSTEM_PROMPT, EXPRESSION_CHECK_DESCRIPTION, designRevisionMessage,
} from '../server/agents/pi-modeling.ts'
import {
  understandingPrompt, businessBasisPrompt, modelDesignPrompt,
  compileModelPrompt, compileModelRepairPrompt,
} from '../server/stages/prompts.ts'
import { designReviewPrompt } from '../server/stages/design-review.ts'
import { assessmentPrompt, assessmentRepairPrompt } from '../server/stages/assessment.ts'
import { modelNarrativePrompt } from '../server/stages/narration.ts'
import { discussionPrompt } from '../server/stages/discussion.ts'

const placeholder = (label: string) => `⟨${label}⟩`
const document = {
  name: placeholder('文档名称'),
  blocks: [{ id: 'block-1', text: placeholder('原文块一') }, { id: 'block-2', text: placeholder('原文块二') }],
}
const narrative = placeholder('业务理解整理稿（含已保存的用户确认）')
const basis = placeholder('建模依据 Markdown：事实、约束、已知计划、业务案例和未决边界')
const design = placeholder('完整的模型设计 Markdown')
const feedback = placeholder('模型表达调整反馈')
const previousDesign = placeholder('上一版完整模型设计')
const review = placeholder('上一轮表达检查反馈')
const error = placeholder('程序校验错误')
const model: CandidateModel = {
  schemaVersion: '1', name: placeholder('候选模型名称'), summary: placeholder('候选模型摘要'),
  objects: [{ id: 'object-a', name: placeholder('对象'), description: placeholder('对象说明'), properties: [], evidence: [] }],
  relations: [], actions: [], functions: [], rules: [], boundaries: [placeholder('未决边界')],
}

const sections: [string, string][] = [
  ['Pi 文本 Agent：system prompt（业务理解、建模依据）', TEXT_SYSTEM_PROMPT],
  ['01 业务理解：understandingPrompt(document)', understandingPrompt(document)],
  ['02 建模依据：businessBasisPrompt(narrative)', businessBasisPrompt(narrative)],
  ['Pi 模型设计 Agent：system prompt', MODELING_SYSTEM_PROMPT],
  ['Pi 模型设计 Agent：check_expression 工具描述（参数为空对象）', EXPRESSION_CHECK_DESCRIPTION],
  ['03 模型设计：modelDesignPrompt(input, businessBasis)', modelDesignPrompt({ currentModel: model, feedback }, basis)],
  ['04 设计表达检查：designReviewPrompt(businessBasis, design, rounds)', designReviewPrompt(basis, design, [
    { design: previousDesign, feedback: review, verdict: 'revise' },
  ])],
  ['Pi 模型设计 Agent：修订 follow-up 用户消息', designRevisionMessage(review)],
  ['05 模型 JSON 编译：compileModelPrompt(modelDesign)', compileModelPrompt(design)],
  ['05b 编译校验失败后的修复：compileModelRepairPrompt(modelDesign, formatError, previousOutput)',
    compileModelRepairPrompt(design, error, placeholder('上一轮模型 JSON 输出'))],
  ['06 独立业务案例检查：assessmentPrompt(model, businessBasis)', assessmentPrompt(model, basis)],
  ['06b 评估校验失败后的修复：assessmentRepairPrompt(model, businessBasis, formatError, previousOutput)',
    assessmentRepairPrompt(model, basis, error, placeholder('上一轮业务案例检查报告'))],
  ['07 模型自述：modelNarrativePrompt(model)', modelNarrativePrompt(model)],
  ['08 业务讨论：discussionPrompt(document, model, messages)', discussionPrompt(document, {
    candidate: model, understanding: narrative, review: placeholder('当前界面位置'),
  }, [{ role: 'assistant', content: placeholder('上一轮回答') }, { role: 'user', content: placeholder('当前用户问题') }])],
]

const output = `# 运行时提示词：领域建模流程

> 本文件由实际提示词函数和 Agent 指令生成，动态输入使用“⟨…⟩”占位。生成命令：\`npm run docs:prompts\`；校验是否同步：\`npm run docs:prompts -- --check\`。
>
> 模型设计示例包含已有候选和表达反馈；没有候选时对应输入省略。设计检查示例包含一轮历史；首轮不传历史。Pi 修订通过检查工具结果返回反馈，未调用工具时使用下面列出的 follow-up 消息。
>
> 主流程：业务理解 → 建模依据 → 模型设计（内部表达检查）→ JSON 编译。独立案例检查、模型自述和业务讨论按需调用。

## 调用与来源

| 调用 | 运行时来源 | 主要输入 | 职责与输出 |
| --- | --- | --- | --- |
| 业务理解 | \`server/stages/understanding.ts\` | 原始文档 blocks | Markdown 整理稿；理顺业务内容和问题，程序保存原文关联 |
| 建模依据 | \`server/stages/business-basis.ts\` | 业务理解及已保存确认 | Markdown 领域语义需求；说明表达与推理要求 |
| 模型设计 | \`server/agents/pi-modeling.ts\` | 建模依据、候选模型、表达反馈 | 完整 Markdown 设计；最多三轮检查 |
| 设计表达检查 | \`server/stages/design-review.ts\` | 建模依据、文字设计、历史检查 | 检查案例表达；自由文本，首行给出结论 |
| JSON 编译 | \`server/stages/modeling.ts\` | 已完成的设计 | 保留语义转换为模型 JSON；失败最多修复一次 |
| 独立业务案例检查 | \`server/stages/assessment.ts\` | 结构化模型、建模依据 | 按案例检查表达与推理；报告校验失败最多修复一次 |
| 模型自述 | \`server/stages/narration.ts\` | 候选模型 | 复述已有语义、边界和内部歧义 |
| 业务讨论 | \`server/stages/discussion.ts\` | 文档、当前上下文、对话 | 回答用户问题；不直接修改业务或模型 |

## 运行时文本

${sections.map(([title, prompt]) => `### ${title}\n\n\`\`\`text\n${prompt}\n\`\`\``).join('\n\n')}

## 输入与产物边界

建模依据是设计和检查共同使用的业务语义依据。案例给出初始事实、目标和预期；模型提供表达与推理所需的语义，预期结果不能替模型补缺口。新增或修改业务事实、规则须先保存到业务理解；表达反馈不自动成为新的业务要求。

模型包含对象、关系、业务操作、只读能力、规则和边界，不包含流程定义或案例数据。当前不展开属性和输入字段结构，必要的业务属性、状态和输入含义保留在对应定义中。编译只转换设计，修复只纠正报告或模型的校验问题。
`

const destination = new URL('../docs/运行时提示词-领域建模流程.md', import.meta.url)
if (process.argv.includes('--check')) {
  if (await readFile(destination, 'utf8') !== output) throw new Error('运行时提示词文档未同步，请运行 npm run docs:prompts。')
  console.log('运行时提示词文档与实际生成内容一致。')
} else {
  await writeFile(destination, output)
  console.log(`已导出 ${sections.length} 段运行时提示词。`)
}
