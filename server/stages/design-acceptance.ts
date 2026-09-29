import { businessContextPrompt, type BusinessContext } from './business-context.ts'
import type { DesignAcceptance } from '../../shared/design-acceptance.ts'
import type { RunTurn, TurnOptions } from '../providers/types.ts'
import {
  canonicalizeAcceptanceSources,
  parseAcceptanceShape,
  parseDesignAcceptance,
  sourceContains,
  sourceQuoteForBlocks,
} from '../validation/design-acceptance.ts'
import { isRecord, parseJsonOutput } from '../validation/values.ts'

export { designAcceptancePrompt, acceptanceQuoteRepairPrompt } from '../prompts/design-acceptance.ts'
import { designAcceptancePrompt, acceptanceQuoteRepairPrompt } from '../prompts/design-acceptance.ts'

// A quote-only repair cannot mutate the questions, expectations or scenario.
export async function prepareDesignAcceptance(context: BusinessContext, runTurn: RunTurn, options: TurnOptions, savedRaw?: string): Promise<DesignAcceptance> {
  const raw = savedRaw ?? await runTurn(designAcceptancePrompt(context), options)
  options.signal?.throwIfAborted()
  const draft = parseAcceptanceShape(raw)
  const prepared = canonicalizeAcceptanceSources(context, draft)
  if (!prepared.invalid.length) return parseDesignAcceptance(JSON.stringify(prepared.acceptance), context)
  options.onEvent?.({ type: 'phase', text: '业务验收问题已生成，正在核对引文的抄写差异。' })
  const patches = parseJsonOutput(await runTurn(acceptanceQuoteRepairPrompt(context, prepared.invalid), options), '验收引文校正')
  options.signal?.throwIfAborted()
  const invalidIds = new Set(prepared.invalid.map(q => q.id))
  if (!isRecord(patches) || Object.keys(patches).some(k => k !== 'quotes') || !Array.isArray(patches.quotes) || patches.quotes.length !== prepared.invalid.length)
    throw new Error(`验收引文校正必须恰好返回待校正编号：${[...invalidIds].join('、')}。`)
  const replacements = new Map<string, { sourceQuote: string; sourceBlockIds?: string[] }>()
  for (const p of patches.quotes) {
    if (!isRecord(p) || Object.keys(p).some(k => k !== 'id' && k !== 'sourceQuote' && k !== 'sourceBlockIds') ||
      typeof p.id !== 'string' || !invalidIds.has(p.id) || replacements.has(p.id))
      throw new Error(`验收引文校正包含无效编号：应校正 ${[...invalidIds].join('、')}。`)
    const hasRefs = Object.hasOwn(p, 'sourceBlockIds')
    const rawRefs = p.sourceBlockIds
    if (hasRefs && (!Array.isArray(rawRefs) || !rawRefs.every(id => typeof id === 'string')))
      throw new Error(`验收引文校正的来源块编号格式无效：${p.id}。`)
    const refs = hasRefs ? (rawRefs as string[]).map(id => id.trim()).filter(Boolean) : undefined
    const referencedQuote = sourceQuoteForBlocks(context, refs)
    if (refs?.length && !referencedQuote)
      throw new Error(`验收引文校正的来源块无法定位：${p.id}。`)
    if (referencedQuote) {
      replacements.set(p.id, { sourceQuote: referencedQuote, sourceBlockIds: refs })
      continue
    }
    if (typeof p.sourceQuote !== 'string' || !sourceContains(context, p.sourceQuote))
      throw new Error(`验收引文校正的原句无法定位：${p.id}。`)
    replacements.set(p.id, { sourceQuote: p.sourceQuote })
  }
  if (replacements.size !== invalidIds.size)
    throw new Error(`验收引文校正遗漏编号：${[...invalidIds].filter(id => !replacements.has(id)).join('、')}。`)
  const corrected = {
    ...prepared.acceptance,
    questions: prepared.acceptance.questions.map(q => replacements.has(q.id)
      ? { ...q, ...replacements.get(q.id)! }
      : q),
  }
  return parseDesignAcceptance(JSON.stringify(corrected), context)
}

export const DESIGN_CHECK_CONTRACT = `验收报告输出：
- 只返回一个 JSON 对象，不加代码围栏，不输出总通过结论；程序根据状态计算结论。
- Report = { summary: string, answers: Answer[], issues: Issue[] }
- Answer = { questionId: string, status: "supported" | "gap" | "clarify" | "bounded" | "not-applicable", sourceQuote: string, evidence: Evidence[], scenario: string, result: string, gap: string }
- Evidence = { quote: string, reason: string }
- Issue = { id: string, type: "basis" | "model" | "business", status: "open" | "resolved", sourceQuote: string, problem: string, acceptance: string, resolution: string, evidence: IssueEvidence[] }
- IssueEvidence = Evidence + { artifact: "design" | "basis" }
- 所有字段必填，文字非空；supported 的 gap 必须为空，其他状态的 gap 写清边界或缺口；空数组用 []。
- answers 必须恰好覆盖固定清单的问题编号；清单外的依据错误、模型缺口或阻断性业务未知写入 issues。
- 每个 answer 用一两句写注明假设的场景和当前实际结果；sourceQuote 必须逐字来自业务来源，evidence.quote 必须逐字来自当前设计或依据。只引用支撑判断所需的最少定义，不复述完整设计。
- supported 需要完整证据且 gap 为空；bounded 需要设计中明确保留的非阻断未决边界和证据；clarify 表示业务未知阻碍判断；gap 表示来源已确定但模型缺少表达或增加了无依据限制；not-applicable 仅用于验收问题本身缺少来源支持。
- issues 必须保留具体来源、问题、修复验收条件和当前处理；历史问题沿用原 id、type、sourceQuote、problem、acceptance，已解决项也要复查并引用当前修复证据。不要把审阅意见写成新的业务事实。`
