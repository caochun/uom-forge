import type { BusinessDocument, UnderstandingSources } from './analysis.ts'
import { withoutQuestionSection } from './questions.ts'

// A citation belongs to one complete Markdown line/paragraph. The clean text
// remains the sole downstream input to modeling; IDs are provenance metadata.
const marker = /\[\[source:([^\]\r\n]*)\]\]/g
export const SOURCE_INSTRUCTIONS = `原文溯源：
- 整理稿中每个有原文依据的段落、列表项或表格行，行末追加 [[source:原文块id]]。
- 一段内容综合多个原文块时，用英文逗号连接，例如 [[source:block-1,block-2]]。
- 问题说明也要引用导致该问题的原文块。
- 引用只对应同一行；段落内部不要手动换行。
- 只能使用输入中真实存在的块 id，不能猜编号。
- 标题和“待确认问题”标题不加 source 标记；问题的依据仍写在正文对应的说明行中。
- 推断必须在正文标明“推断”，并引用支持它的背景；没有依据的内容不要添加引用。
- source 标记只表示可以追溯到原文位置，不表示推断已经被原文证实。`

export function normalizedPassage(value: string): string {
  return value
    .trim()
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+[.)、]\s+/, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, '')
}

export function stripSourceMarkers(value: string): string {
  return value.replace(marker, '')
}

export function extractUnderstandingSources(
  raw: string,
  document: BusinessDocument,
) {
  const byId = new Map(document.blocks.map((block) => [block.id, block]))
  const citations: UnderstandingSources['citations'] = []
  const warnings: string[] = []
  const narrative = raw
    .split('\n')
    .map((line) => {
      const matches = [...line.matchAll(marker)]
      if (!matches.length) return line
      const passage = stripSourceMarkers(line).trimEnd()
      const ids = [
        ...new Set(
          matches.flatMap((match) =>
            match[1].split(',').map((id) => id.trim()),
          ),
        ),
      ]
      if (
        !passage.trim() ||
        /^\s*#/.test(passage) ||
        ids.some((id) => !byId.has(id))
      ) {
        warnings.push('部分原文引用无效，相关说明已保留，但未建立原文关联。')
      } else {
        citations.push({
          passage: passage.trim(),
          origin: 'document',
          blockIds: ids,
        })
      }
      return passage
    })
    .join('\n')
  const used = new Set(citations.flatMap((citation) => citation.blockIds))
  return {
    narrative,
    sources: readUnderstandingSources(
      {
        documentName: document.name,
        blocks: document.blocks
          .filter((block) => used.has(block.id))
          .map((block) => ({ ...block })),
        citations,
      } satisfies UnderstandingSources,
      narrative,
    )!,
    warnings: [...new Set(warnings)],
  }
}

// Decode both SSE and local drafts. Malformed metadata must not discard the
// business explanation or silently turn unknown references into quotations.
export function readUnderstandingSources(
  value: unknown,
  narrative: string,
): UnderstandingSources | undefined {
  if (!value || typeof value !== 'object') return undefined
  const data = value as Record<string, unknown>
  if (
    typeof data.documentName !== 'string' ||
    !Array.isArray(data.blocks) ||
    !Array.isArray(data.citations)
  )
    return undefined
  const blocks = new Map<string, { id: string; text: string }>()
  for (const block of data.blocks) {
    if (
      !block ||
      typeof block.id !== 'string' ||
      !block.id ||
      typeof block.text !== 'string' ||
      !block.text.trim() ||
      blocks.has(block.id)
    )
      return undefined
    blocks.set(block.id, { id: block.id, text: block.text })
  }
  const lines = new Set(narrative.split(/\r?\n/).map((line) => line.trim()))
  const occurrences = new Map<string, number>()
  for (const line of narrative.split(/\r?\n/)) {
    const key = normalizedPassage(line)
    occurrences.set(key, (occurrences.get(key) || 0) + 1)
  }
  const citations: UnderstandingSources['citations'] = []
  for (const citation of data.citations) {
    if (
      !citation ||
      typeof citation.passage !== 'string' ||
      !citation.passage.trim() ||
      !lines.has(citation.passage.trim()) ||
      occurrences.get(normalizedPassage(citation.passage)) !== 1 ||
      !Array.isArray(citation.blockIds)
    )
      continue
    if (citation.origin === 'user' && !citation.blockIds.length) {
      citations.push({
        passage: citation.passage.trim(),
        origin: 'user',
        blockIds: [],
      })
    } else if (
      citation.origin === 'document' &&
      citation.blockIds.length &&
      citation.blockIds.every(
        (id: unknown) => typeof id === 'string' && blocks.has(id),
      )
    ) {
      citations.push({
        passage: citation.passage.trim(),
        origin: 'document',
        blockIds: [...new Set<string>(citation.blockIds)],
      })
    }
  }
  return {
    documentName: data.documentName,
    blocks: [...blocks.values()],
    citations,
  }
}

// Keep exact unchanged passages, and identify human additions without copying
// citations from the text they replaced. This also handles saved answers.
export function reviseUnderstandingSources(
  sources: UnderstandingSources | undefined,
  prior: string,
  narrative: string,
): UnderstandingSources {
  const retained = readUnderstandingSources(sources, narrative)
  const previousLines = new Set(prior.split(/\r?\n/).map((line) => line.trim()))
  const added = [
    ...new Set(
      withoutQuestionSection(narrative)
        .split(/\r?\n/)
        .map((line) => line.trim()),
    ),
  ].filter(
    (line) =>
      line && !/^#|^以下是用户保存/.test(line) && !previousLines.has(line),
  )
  return {
    documentName: retained?.documentName || '',
    blocks: retained?.blocks || [],
    citations: [
      ...(retained?.citations || []),
      ...added.map((passage) => ({
        passage,
        origin: 'user' as const,
        blockIds: [],
      })),
    ],
  }
}

export function traceUnderstandingSource(
  excerpt: string,
  sources?: UnderstandingSources,
) {
  const citations = sources?.citations || []
  // Fact extraction joins multiple cited lines using this exact delimiter.
  const parts = /^“.*”；“.*”$/s.test(excerpt)
    ? excerpt.slice(1, -1).split('”；“')
    : [excerpt]
  const results = parts.map((part) => {
    const key = normalizedPassage(part)
    const matched = citations.filter(
      (citation) => normalizedPassage(citation.passage) === key,
    )
    // Repeated identical prose with different sources is ambiguous; do not guess.
    const signatures = new Set(
      matched.map(
        (citation) =>
          `${citation.origin}:${[...citation.blockIds].sort().join(',')}`,
      ),
    )
    return signatures.size === 1 ? matched[0] : undefined
  })
  const ids = new Set(results.flatMap((citation) => citation?.blockIds || []))
  return {
    blocks: sources?.blocks.filter((block) => ids.has(block.id)) || [],
    user: results.some((citation) => citation?.origin === 'user'),
    unlinked: results.some((citation) => !citation),
  }
}
