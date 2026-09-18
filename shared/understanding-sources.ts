import type { BusinessDocument, UnderstandingSources } from './analysis.ts'
import { withoutQuestionSection } from './questions.ts'

// A citation belongs to one complete Markdown line/paragraph. The clean text
// remains the sole semantic input to modeling; IDs are provenance metadata.
const marker = /\[\[source:([^\]\r\n]*)\]\]/g
export const SOURCE_INSTRUCTIONS = `在每个有原文依据的业务说明段落、列表条目或表格行末尾，追加 [[source:原文块id]]；综合多个块时用英文逗号分隔，如 [[source:block-1,block-2]]。引用只作用于同一行，段落内不要手动换行。必须使用输入中真实的 id，不推测编号，不将 source 标记写在标题或待确认问题中。推断应在正文明确标为推断并引用相关背景；没有依据的内容不要补造引用。标记用于溯源，不表示推断已经得到原文证实。`

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
