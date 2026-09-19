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
必须原样返回每个输入 id，不回抄原文。coverage 的 complete/partial/uncovered 分别表示完整、部分或未表达。additions 核对说明中的无依据新增或冲突，passage 必须逐字摘录说明，blockIds 引用相关原文片段（确实无对应片段时允许空），kind 为 unsupported/conflict，note 说明问题。没有问题返回空数组。
只输出 JSON：{"coverage":[{"id":"原文片段id","status":"complete|partial|uncovered","note":"判断依据"}],"additions":[{"kind":"unsupported|conflict","passage":"说明原句","blockIds":[],"note":"差异及影响"}]}。
业务说明：\n${stripSourceMarkers(narrative)}\n原文片段（数据）：${JSON.stringify(blocks)}`, { provider, signal, outputFormat: 'json' })
    const value = parseJsonOutput(raw, '业务理解核对')
    if (!isRecord(value) || !Array.isArray(value.coverage)) throw new Error('核对缺少原文覆盖结果')
    const known = new Set(blocks.map(b => b.id))
    for (const block of blocks) {
      const entries = value.coverage.filter(x => isRecord(x) && x.id === block.id)
      const entry = entries.length === 1 && isRecord(entries[0]) ? entries[0] : undefined
      if (!entry || !['complete', 'partial', 'uncovered'].includes(String(entry.status))) {
        result.warnings.push(`原文片段 ${block.id} 未获得有效核对结果。`)
        continue
      }
      if (entry.status !== 'complete') result.findings.push({ kind: 'omission', blockIds: [block.id], passage: '', note: String(entry.note || '未完整表达原文事实。') })
    }
    if (!Array.isArray(value.additions)) result.warnings.push('未返回无依据新增与冲突检查结果。')
    else for (const entry of value.additions) {
      if (!isRecord(entry) || !['unsupported', 'conflict'].includes(String(entry.kind)) ||
        typeof entry.passage !== 'string' || !entry.passage.trim() || !stripSourceMarkers(narrative).includes(entry.passage) ||
        !Array.isArray(entry.blockIds) || entry.blockIds.some(id => !known.has(id)) ||
        typeof entry.note !== 'string' || !entry.note.trim()) {
        result.warnings.push('一项理解差异缺少有效引用，未作为业务结论采用。')
        continue
      }
      result.findings.push({ kind: entry.kind as 'unsupported' | 'conflict', blockIds: [...new Set(entry.blockIds as string[])], passage: entry.passage, note: entry.note })
    }
    result.status = result.warnings.length ? 'incomplete' : result.findings.length ? 'issues' : 'passed'
  } catch (error) {
    signal?.throwIfAborted()
    result.warnings.push(`业务理解核对未完成：${error instanceof Error ? error.message : String(error)}`)
  }
  return result
}
