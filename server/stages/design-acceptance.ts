import { businessContextPrompt, type BusinessContext } from './business-context.ts'
import type { DesignAcceptance } from '../../shared/design-acceptance.ts'
import type { RunTurn, TurnOptions } from '../providers/types.ts'
import { parseAcceptanceShape, parseDesignAcceptance, sourceContains } from '../validation/design-acceptance.ts'
import { isRecord, parseJsonOutput } from '../validation/values.ts'

export { designAcceptancePrompt, acceptanceQuoteRepairPrompt } from '../prompts/design-acceptance.ts'
import { designAcceptancePrompt, acceptanceQuoteRepairPrompt } from '../prompts/design-acceptance.ts'

// A quote-only repair cannot mutate the questions, expectations or scenario.
export async function prepareDesignAcceptance(context: BusinessContext, runTurn: RunTurn, options: TurnOptions, savedRaw?: string): Promise<DesignAcceptance> {
  const raw = savedRaw ?? await runTurn(designAcceptancePrompt(context), options)
  options.signal?.throwIfAborted()
  const acceptance = parseAcceptanceShape(raw)
  const invalid = acceptance.questions.filter(q => !sourceContains(context, q.sourceQuote))
  if (!invalid.length) return acceptance
  options.onEvent?.({ type: 'phase', text: '业务验收问题已生成，正在核对引文的抄写差异。' })
  const patches = parseJsonOutput(await runTurn(acceptanceQuoteRepairPrompt(context, invalid), options), '验收引文校正')
  options.signal?.throwIfAborted()
  if (!isRecord(patches) || Object.keys(patches).some(k => k !== 'quotes') || !Array.isArray(patches.quotes) || patches.quotes.length !== invalid.length)
    throw new Error('验收引文校正必须只返回待校正编号及引文。')
  const replacements = new Map<string, string>()
  for (const p of patches.quotes) {
    if (!isRecord(p) || Object.keys(p).some(k => k !== 'id' && k !== 'sourceQuote') || typeof p.id !== 'string' ||
      typeof p.sourceQuote !== 'string' || !invalid.some(q => q.id === p.id) || replacements.has(p.id) || !sourceContains(context, p.sourceQuote))
      throw new Error('验收引文校正包含无效编号或无法定位的原句。')
    replacements.set(p.id, p.sourceQuote)
  }
  const corrected = { ...acceptance, questions: acceptance.questions.map(q => replacements.has(q.id) ? { ...q, sourceQuote: replacements.get(q.id)! } : q) }
  return parseDesignAcceptance(JSON.stringify(corrected), context)
}

export const DESIGN_CHECK_CONTRACT = `验收报告：
- 只返回一个 JSON 对象，不加代码围栏，不自行输出总通过结论。程序依据完整性校验和各项状态确定结论，再生成可读报告。
- Report = { summary: string, answers: Answer[], issues: Issue[] }
- Answer = { questionId: string, status: "supported" | "gap" | "clarify" | "bounded" | "not-applicable", sourceQuote: string, evidence: Evidence[], scenario: string, result: string, gap: string }
- Evidence = { quote: string, reason: string }
- Issue = { id: string, type: "basis" | "model" | "business", status: "open" | "resolved", sourceQuote: string, problem: string, acceptance: string, resolution: string, evidence: IssueEvidence[] }
- IssueEvidence = Evidence + { artifact: "design" | "basis" }
- 所有字段必填，除 supported 的 gap 必须为空外，文字均非空；数组无内容用 []。summary 说明来源核查范围、依据准确性和核心场景覆盖。
- answers 必须逐项覆盖固定清单，questionId 不重复，不遗漏，不增加未知编号。清单外新发现的问题写入 issues。
- 清单中的 scenario 和 outcome 是验收用的假设实例与预期，不是模型已有的信息。沿实际定义回放到结果，核对每项必要内容和所有已知路径；不能从假设实例或预期结果直接补值。清单聚焦核心结果，仍须核查其他来源要求及依据案例，发现问题写入 issues。
- 每项 sourceQuote 逐字摘录业务来源中的连续原句；逐项复核问题及预期是否有来源支持。scenario 使用注明假设的具体实例，result 只说明当前定义能表达或推出什么；不得把场景输入直接当作结果已有的信息。
- evidence.quote 逐字摘录当前设计中实际参与表达的定义，reason 说明该定义承载什么或如何传递信息。间接路径逐段引用，必须追到实际承载所需内容的定义；引用一个关联、名称或“决定内容”的概述不能代替检查终点内容。原文预期和历史设计不能冒充当前定义。
- supported：预期有完整的定义证据，evidence 非空且 gap 为空。bounded：真正的业务未知在设计中明确保留，引用相关定义并说明为何不阻碍已确定部分；evidence 非空，gap 写未决边界。clarify：真正的业务未知阻碍必要判断，gap 写影响及待确认内容。
- gap：来源已确定的要求缺少模型表达或存在无依据限制，gap 写具体缺口和验收条件；“完整构成未展开”“可以追踪”等宣称不能豁免。即使另有业务未知，也先指出确定缺口。
- not-applicable：问题或其预期自身带入了来源不支持的要求。保留原编号，sourceQuote 给出核对依据，gap 解释为何不成立和适用范围；不能因设计没表达就使用此状态，也不能用它隐藏依据提炼错误。
- 对有业务意义的差异作对照探针：只改变一项有来源支持的信息，核对模型能否区分两种结果或行为。若不能，明确差异丢在何处；不要求保存假设实例，不人为要求不存在的差异。
- issues 用于依据错误、清单外模型缺口及阻断性的业务未知。每项写来源、具体问题、受影响场景、修复验收条件及当前处理说明；非阻断未知留在相应 bounded 项或 summary。
- 复查必须携带历史报告中所有问题（含已解决项，以便发现回归），沿用 id、type、sourceQuote、problem、acceptance，不删除、改号或改弱验收条件。resolved 必须引用当前设计或当前依据中的修复证据；问题仍在则 open。resolution 解释解决情况或剩余缺口。
- 有可由来源直接判定的依据错误时，以 open 的 basis 问题提出校正，同时保留模型缺口。业务本身需选择解释时用 business，不让审阅意见成为新业务事实。`
