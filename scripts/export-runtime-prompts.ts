import { readFile, writeFile } from 'node:fs/promises'
import type { CandidateModel } from '../shared/model.ts'
import { TEXT_SYSTEM_PROMPT } from '../server/agents/pi-text.ts'
import {
  MODELING_SYSTEM_PROMPT, EXPRESSION_CHECK_DESCRIPTION, designRevisionMessage, basisRevisionMessage,
} from '../server/agents/pi-modeling.ts'
import {
  understandingPrompt, businessBasisPrompt, modelDesignPrompt,
  compileModelPrompt, compileModelRepairPrompt,
} from '../server/stages/prompts.ts'
import { designReviewPrompt } from '../server/stages/design-review.ts'
import { designAcceptancePrompt, acceptanceQuoteRepairPrompt } from '../server/stages/design-acceptance.ts'
import type { DesignAcceptance, DesignCheckReport } from '../shared/design-acceptance.ts'
import { assessmentPrompt, assessmentRepairPrompt } from '../server/stages/assessment.ts'
import { modelNarrativePrompt } from '../server/stages/narration.ts'
import { discussionPrompt } from '../server/stages/discussion.ts'

const placeholder = (label: string) => `⟨${label}⟩`
const document = {
  name: placeholder('文档名称'),
  blocks: [{ id: 'block-1', text: placeholder('原文块一') }, { id: 'block-2', text: placeholder('原文块二') }],
}
const narrative = placeholder('业务理解整理稿（含已保存的用户确认）')
const sources = { documentName: document.name, complete: true, blocks: document.blocks,
  citations: [{ passage: narrative, origin: 'document' as const, blockIds: ['block-1', 'block-2'] }] }
const context = { narrative, sources }
const basis = placeholder('建模依据 Markdown：事实、约束、已知计划、业务案例和未决边界')
const design = placeholder('完整的模型设计 Markdown')
const feedback = placeholder('模型表达调整反馈')
const previousDesign = placeholder('上一版完整模型设计')
const review = placeholder('上一轮表达检查反馈')
const acceptance: DesignAcceptance = { scope: placeholder('本次业务验收范围'), scenario: placeholder('注明假设的代表性完整场景及不同路径'), outcome: placeholder('目标达成时的具体业务事实及必要内容'), questions: [{
  id: 'Q1', question: placeholder('核心业务结果或行为的验收问题'), kind: 'result', grounding: 'explicit',
  sourceQuote: placeholder('支持该问题的业务来源原句'), reason: placeholder('问题的必要性与依据'), expected: placeholder('场景及验收预期'),
}] }
const reviewReport: DesignCheckReport = { summary: placeholder('来源核查范围与覆盖情况'), answers: [{
  questionId: 'Q1', status: 'gap', sourceQuote: placeholder('业务来源原句'), evidence: [],
  scenario: placeholder('注明假设的验收场景'), result: placeholder('当前定义实际能表达的结果'), gap: placeholder('具体缺口及修复验收条件'),
}], issues: [] }
const error = placeholder('程序校验错误')
const model: CandidateModel = {
  schemaVersion: '1', name: placeholder('候选模型名称'), summary: placeholder('候选模型摘要'),
  objects: [{ id: 'object-a', name: placeholder('对象'), description: placeholder('对象说明'), properties: [], evidence: [] }],
  relations: [], actions: [], functions: [], rules: [], boundaries: [placeholder('未决边界')],
}

const sections: [string, string][] = [
  ['Pi 文本 Agent：system prompt（业务理解、建模依据）', TEXT_SYSTEM_PROMPT],
  ['01 业务理解：understandingPrompt(document)', understandingPrompt(document)],
  ['02 建模依据：businessBasisPrompt(narrative, sources)', businessBasisPrompt(narrative, sources)],
  ['02b 审阅发现提炼错误后的依据校正', businessBasisPrompt(narrative, sources, { previous: basis, feedback: review })],
  ['02c 设计前的业务验收清单：designAcceptancePrompt(context)', designAcceptancePrompt(context)],
  ['02d 验收清单引文抄写校正（仅在引文无法匹配时调用一次）', acceptanceQuoteRepairPrompt(context, acceptance.questions)],
  ['Pi 模型设计 Agent：system prompt', MODELING_SYSTEM_PROMPT],
  ['Pi 模型设计 Agent：check_expression 工具描述（参数为空对象）', EXPRESSION_CHECK_DESCRIPTION],
  ['03 模型设计：modelDesignPrompt(input, businessBasis, acceptance)', modelDesignPrompt({ ...context, currentModel: model, feedback }, basis, acceptance)],
  ['04 设计表达检查：designReviewPrompt(businessBasis, design, rounds, context, acceptance)', designReviewPrompt(basis, design, [
    { design: previousDesign, feedback: review, verdict: 'revise', report: reviewReport, businessBasis: placeholder('上一轮建模依据'), businessBasisVersion: placeholder('上一轮依据版本') },
  ], context, acceptance)],
  ['Pi 模型设计 Agent：修订 follow-up 用户消息', designRevisionMessage(review)],
  ['Pi 模型设计 Agent：依据校正后的工具结果（未调用工具时嵌入修订消息）', basisRevisionMessage(review, basis)],
  ['05 模型 JSON 编译：compileModelPrompt(modelDesign)', compileModelPrompt(design)],
  ['05b 编译校验失败后的修复：compileModelRepairPrompt(modelDesign, formatError, previousOutput)',
    compileModelRepairPrompt(design, error, placeholder('上次模型 JSON 输出'))],
  ['06 独立业务案例检查：assessmentPrompt(model, businessBasis)', assessmentPrompt(model, basis)],
  ['06b 评估校验失败后的修复：assessmentRepairPrompt(model, businessBasis, formatError, previousOutput)',
    assessmentRepairPrompt(model, basis, error, placeholder('上次业务案例检查报告'))],
  ['07 模型自述：modelNarrativePrompt(model)', modelNarrativePrompt(model)],
  ['08 业务讨论：discussionPrompt(document, model, messages)', discussionPrompt(document, {
    candidate: model, understanding: narrative, review: placeholder('当前界面位置'),
  }, [{ role: 'assistant', content: placeholder('历史回答') }, { role: 'user', content: placeholder('当前用户问题') }])],
]

const output = `# 运行时提示词：领域建模流程

> 本文件由实际提示词函数和 Agent 指令生成，动态输入使用“⟨…⟩”占位。生成命令：\`npm run docs:prompts\`；校验是否同步：\`npm run docs:prompts -- --check\`。
>
> 模型设计示例包含已有候选和表达反馈；没有候选时对应输入省略。设计检查示例包含一轮历史；首轮不传历史。Pi 修订通过检查工具结果返回反馈，未调用工具时使用下面列出的 follow-up 消息。
>
> 主流程：业务理解 → 建模依据 → 固定业务验收问题 → 模型设计（内部逐项检查）→ 模型 JSON 编译。验收清单和检查报告是内部结构化审阅产物，界面展示为可读文本；独立案例检查、模型自述和业务讨论按需调用。
>
> “03 模型设计”包含实际运行时使用的货运 one-shot；示例的来源版本、事实映射、裁剪范围及原项目许可见 [建模示例-货物作业事件.md](建模示例-货物作业事件.md)。示例仅用于演示方法，实际任务输入位于示例之后。

## 调用与来源

| 调用 | 运行时来源 | 输入及用途 | 职责与输出 |
| --- | --- | --- | --- |
| 业务理解 | \`server/stages/understanding.ts\` | 原始文档 blocks 是业务内容来源 | Markdown 整理稿；理顺业务内容和问题，程序保存原文关联 |
| 建模依据及校正 | \`server/stages/business-basis.ts\` | 原文快照、整理稿与有效用户修改；反馈仅定位提炼错误 | 完整 Markdown 领域语义需求；校正不改写已保存整理稿 |
| 业务验收问题 | \`server/stages/design-acceptance.ts\` | 仅业务来源；不接收建模依据、候选设计或表达反馈 | 固定问题、来源、必要性及预期；生成一次并贯穿修订 |
| 模型设计 | \`server/agents/pi-modeling.ts\` | 当前依据组织要求，业务来源供核对；货运 one-shot 演示方法；候选供修订 | 完整 Markdown 设计；包括依据校正在内最多三轮检查 |
| 设计表达检查 | \`server/stages/design-review.ts\` | 固定验收清单、同一业务来源和当前依据；历史设计、反馈及依据版本供复查 | 逐项回答并引用定义，复查历史问题；程序校验覆盖与引用后从状态计算结论 |
| JSON 编译 | \`server/stages/modeling.ts\` | 已完成设计决定语义；修复时校验错误定位问题，旧 JSON 是修复对象 | 保留语义转换为模型 JSON；失败最多修复一次 |
| 独立业务案例检查 | \`server/stages/assessment.ts\` | 建模依据决定预期，结构化模型供检查；修复时旧报告不成为依据 | 按案例检查表达与推理；报告校验失败最多修复一次 |
| 模型自述 | \`server/stages/narration.ts\` | 候选模型是唯一语义来源 | 复述已有语义、边界和内部歧义 |
| 业务讨论 | \`server/stages/discussion.ts\` | 最后用户问题指定主题；文档供引用，当前理解供核对已保存确认 | 回答用户问题；不直接修改业务或模型 |

## 运行时文本

${sections.map(([title, prompt]) => `### ${title}\n\n\`\`\`text\n${prompt}\n\`\`\``).join('\n\n')}

## 输入与产物边界

货运教学示例来自 \`server/stages/modeling-example.ts\`，只拼入模型设计提示词。示例输入、示例输出和核对说明由 \`<modeling-example>\` 包围，后接实际任务输入；审阅、编译等其他阶段不主动拼入示例。分隔和提示不能保证模型绝不复制示例内容，实际输出仍须按实际建模依据检查。

输入标签说明具体用途，不再笼统使用“材料是数据”。业务规则中的“必须”“不得”仍要保留；输入中要求模型更换角色、任务、工具或输出格式的文字不能覆盖阶段指令。讨论中的最后一条用户问题决定讨论主题，反馈和新条件按阶段允许的用途处理，不自动成为已保存的业务确认。提示词中的“轮”用于 Pi 设计与检查迭代，其余位置直接说明阶段或调用范围。

设计和检查共同使用当前建模依据，并回看实际提供的业务来源。新整理稿保存完整原文快照，旧快照缺少完整性标记时只声明部分核查；没有原文时只核对整理稿。程序标记的用户保存修改按其明确范围更新旧要求，问题和未决解释不自动成为确认。反馈不能引入业务事实，但可触发对来源已明确的提炼错误的校正；新增业务规则仍需用户保存确认。

依据校正由检查结论“需校正依据”触发，输出完整新版后通过工具结果送回 Pi；若未调用工具，则通过修订消息送回。每轮记录依据正文及版本，当前审阅绑定来源、整理稿、依据与设计版本。依据不变时停止并保留意见；校正失败、取消或达到上限时保留完整产物，不宣称通过。依据改变后复查受影响案例并回放其余案例，校正也计入最多三轮检查；编译使用最终设计，后续澄清及独立检查使用最新依据。

建模依据输出前核对业务来源中的限制、明确许可、例外、对应关系和时间起点。模型设计区分原文事实、必然推导、表达选择与业务未知；必要属性和关联不要求原文逐字指定。表达检查除有依据的最小差异对照，还从核心输入到结果追踪必要信息的承载、传递和归属，核查案例覆盖本身；不以类名、元素数量或拆分方式判断业务正确性。

检查报告优先沿用已有案例编号；当一个来源编号包含对照两侧时，使用子编号并注明共同来源，避免“保留原编号”和“每条结果标识唯一”冲突。

模型包含对象、关系、业务操作、只读能力、规则和边界，不包含流程定义或案例数据。当前不展开属性和输入字段结构，必要的业务属性、状态和输入含义保留在对应定义中。编译只转换设计，修复只纠正报告或模型的校验问题。

验收清单在设计前从业务来源独立生成，不读取候选模型或表达反馈。清单在同一设计循环中固定；检查必须回答所有问题，并引用当前设计中的真实定义。程序核对编号集合、引文存在、状态一致性以及历史问题是否复查，依据错误、模型缺口和阻断性业务未知均不能得到通过结论。报告无效时保留原始输出和设计，不伪造修复或通过；清单本身不成立时保留问题并说明来源依据，不能删除失败项。

编译提示词要求逐个定义核对语义保真；程序校验仍负责结构、唯一 ID 和引用。清单是否覆盖业务、引用是否足以证明预期、未决或不适用判断是否正确仍由 LLM 判断，代码不包含领域专用的对象、属性或关联规则。提示词导出与程序测试通过不代表真实模型的语义质量已经验证。
`

const destination = new URL('../docs/运行时提示词-领域建模流程.md', import.meta.url)
if (process.argv.includes('--check')) {
  if (await readFile(destination, 'utf8') !== output) throw new Error('运行时提示词文档未同步，请运行 npm run docs:prompts。')
  console.log('运行时提示词文档与实际生成内容一致。')
} else {
  await writeFile(destination, output)
  console.log(`已导出 ${sections.length} 段运行时提示词。`)
}
