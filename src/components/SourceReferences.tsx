import type { UnderstandingSources } from '../../shared/analysis.ts'
import { traceUnderstandingSource } from '../../shared/understanding-sources.ts'

export default function SourceReferences({
  excerpt,
  sources,
}: {
  excerpt: string
  sources?: UnderstandingSources
}) {
  const trace = traceUnderstandingSource(excerpt, sources)
  return (
    <div className="source-references">
      {trace.user && (
        <p className="source-note">
          含用户补充或修订的说明，其内容不作为原文引文。
        </p>
      )}
      {trace.unlinked && (
        <p className="source-note">
          {trace.blocks.length || trace.user ? '部分业务说明' : '这段业务说明'}
          尚未关联原文。
        </p>
      )}
      {trace.blocks.length > 0 && (
        <>
          <p className="source-note">
            相关原文 · {sources?.documentName}（理解时的文档快照）
          </p>
          {trace.blocks.map((block) => (
            <blockquote key={block.id}>
              <small>{block.id}</small>
              <p>{block.text}</p>
            </blockquote>
          ))}
        </>
      )}
    </div>
  )
}

export function SourceCatalogue({
  sources,
}: {
  sources?: UnderstandingSources
}) {
  const citations = sources?.citations || []
  if (!citations.length)
    return (
      <p className="reading-note">
        本次业务说明尚未关联原文；重新理解业务时将尝试保留段落引用。
      </p>
    )
  return (
    <details className="source-catalogue">
      <summary>查看说明来源 · {citations.length} 段</summary>
      <p className="source-note">
        引用用于追溯说明的来源，请结合原文审阅解释是否准确；标为推断的内容仍是推断。
      </p>
      {citations.map((citation, index) => (
        <article key={`${index}-${citation.passage}`}>
          <strong>业务说明</strong>
          <p>{citation.passage}</p>
          <SourceReferences excerpt={citation.passage} sources={sources} />
        </article>
      ))}
    </details>
  )
}
