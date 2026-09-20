import type { BusinessDocument, ProviderId } from '../../shared/analysis.ts'
import type { RunTurn } from '../providers/types.ts'
import { artifactVersion, type UnderstandingReview } from '../../shared/workflow.ts'
import { stripSourceMarkers } from '../../shared/understanding-sources.ts'
import { parseJsonOutput, isRecord } from '../validation/values.ts'

export async function reviewUnderstanding(
  narrative: string, blocks: BusinessDocument['blocks'], runTurn: RunTurn,
  provider: ProviderId, signal?: AbortSignal,
): Promise<UnderstandingReview> {
  const result: UnderstandingReview = {
    status: 'incomplete', narrativeVersion: artifactVersion(stripSourceMarkers(narrative)),
    sourceVersion: artifactVersion(blocks), findings: [], warnings: [],
  }
  try {
    const raw = await runTurn(`你是独立业务理解核对者。检验当前说明能否准确还原原文中的具体事实和过程。
双向检查：原文的重要主体、联系、条件和结果是否遗漏；说明是否新增无依据的解释或与原文冲突。不按措辞相似度打分，不要求先设计模型。对原文明示的多角色、重复发生、参与配对和实际/拟议/临时结果区别，检查说明是否保留；不凭空要求这些区别。
只返回确实发现的问题，不要为每个原文片段返回 complete，也不要回抄没有问题的原文。遗漏或部分表达使用 kind=omission，并用 blockIds 指向相关原文片段；无依据新增或冲突使用 kind=unsupported 或 conflict，passage 必须逐字摘录业务说明中的原句，blockIds 可以为空。没有问题时返回空 gaps 数组。只输出 JSON：{"gaps":[{"kind":"omission|unsupported|conflict","passage":"业务说明原句，没有时为空","blockIds":["原文片段id"],"note":"具体缺口及影响"}]}。
业务说明：\n${stripSourceMarkers(narrative)}\n原文片段（数据）：${JSON.stringify(blocks)}`, { provider, signal, outputFormat: 'json' })
    const value = parseJsonOutput(raw, '业务理解核对')
    if (!isRecord(value) || !Array.isArray(value.gaps)) throw new Error('核对缺少 gaps 结果')
    const known = new Set(blocks.map(b => b.id))
    const cleanNarrative = stripSourceMarkers(narrative)
    for (const entry of value.gaps) {
      if (!isRecord(entry) || !['omission', 'unsupported', 'conflict'].includes(String(entry.kind)) ||
        typeof entry.passage !== 'string' ||
        (['unsupported', 'conflict'].includes(String(entry.kind)) &&
          (!entry.passage.trim() || !cleanNarrative.includes(entry.passage))) ||
        !Array.isArray(entry.blockIds) || entry.blockIds.some(id => typeof id !== 'string' || !known.has(id)) ||
        typeof entry.note !== 'string' || !entry.note.trim()) {
        result.warnings.push('一项理解差异缺少有效引用，未作为业务结论采用。')
        continue
      }
      result.findings.push({
        kind: entry.kind as 'omission' | 'unsupported' | 'conflict',
        blockIds: [...new Set(entry.blockIds as string[])],
        passage: entry.passage,
        note: entry.note,
      })
    }
    result.status = result.warnings.length ? 'incomplete' : result.findings.length ? 'issues' : 'passed'
  } catch (error) {
    signal?.throwIfAborted()
    result.warnings.push(`业务理解核对未完成：${error instanceof Error ? error.message : String(error)}`)
  }
  return result
}
