import { useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import type { UnderstandingSources } from '../../shared/analysis.ts'
import type { CandidateModel } from '../../shared/model.ts'
import type {
  BusinessFact,
  BusinessStory,
  SemanticPlanV2,
} from '../../shared/semantic.ts'
import { coverageForFact } from '../modeling-progress.ts'
import SourceReferences from './SourceReferences.tsx'

export type EvidenceMode = 'facts' | 'stories'
const FACT_KINDS: Record<BusinessFact['kind'], string> = {
  static: '静态事实',
  event: '业务事件',
  state: '状态变化',
  constraint: '约束规则',
  role: '参与角色',
}
const CERTAINTY: Record<BusinessFact['certainty'], string> = {
  explicit: '业务说明明确',
  confirmed: '业务说明标为已确认',
  uncertain: '待确认',
}
const COVERAGE = {
  full: '完整表达',
  partial: '部分表达',
  missing: '尚未表达',
} as const

export default function SemanticEvidence({
  semantic,
  sources,
  model,
  modelEdited,
  mappingDetail,
  mappingRunning,
  onRebuild,
  disabled,
  mode,
  onMode,
  onSelectElement,
}: {
  semantic?: SemanticPlanV2
  sources?: UnderstandingSources
  model?: CandidateModel
  modelEdited?: boolean
  mappingDetail: string
  mappingRunning: boolean
  onRebuild: () => void
  disabled: boolean
  mode: EvidenceMode
  onMode: (mode: EvidenceMode) => void
  onSelectElement: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [selectedStoryId, setSelectedStoryId] = useState('')
  const facts = semantic?.facts || []
  const stories = semantic?.stories || []
  const mappings = semantic?.mappings || []
  const mapped = semantic?.status === 'mapped'
  const elements = model
    ? [
        ...model.objects,
        ...model.relations,
        ...model.actions,
        ...model.functions,
        ...model.rules,
      ]
    : []
  const names = new Map(
    [...elements, ...(model?.activities || [])].map((element) => [
      element.id,
      element.name,
    ]),
  )
  const selectable = new Set(elements.map((element) => element.id))
  const needsAttention = (fact: BusinessFact) =>
    fact.certainty === 'uncertain' ||
    (mapped && (modelEdited || coverageForFact(fact.id, mappings) !== 'full'))
  const attentionCount = facts.filter(needsAttention).length
  const search = query.trim().toLocaleLowerCase()
  const visibleFacts = facts.filter(
    (fact) =>
      (!attentionOnly || needsAttention(fact)) &&
      (!search ||
        [fact.id, fact.statement, fact.source, ...fact.actors, ...fact.objects]
          .join(' ')
          .toLocaleLowerCase()
          .includes(search)),
  )
  const selectedStory =
    stories.find((story) => story.id === selectedStoryId) || stories[0]
  if (!semantic)
    return (
      <div className="empty-state panel-surface">
        运行建模后，提取出的业务事实和业务故事会先出现在这里。
      </div>
    )
  return (
    <div className="semantic-evidence">
      <div className="evidence-navigation">
        <div className="switcher" role="group" aria-label="业务依据内容">
          {(
            [
              ['facts', '业务事实', facts.length],
              ['stories', '业务故事', stories.length],
            ] as const
          ).map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              aria-pressed={mode === id}
              className={mode === id ? 'active' : ''}
              onClick={() => onMode(id)}
            >
              {label} {count}
            </button>
          ))}
        </div>
        <span className="muted">
          {mode === 'facts'
            ? '展开事实，查看来源与模型表达。'
            : '按业务目标阅读事实发生的过程。'}
        </span>
      </div>
      {((modelEdited && mapped) || (!mapped && model && !mappingRunning)) && (
        <div className="notice" role="status">
          {modelEdited
            ? '以下覆盖对应先前模型或业务依据，需要更新。'
            : '事实与候选模型已保留，覆盖映射尚未完成。'}
          <button
            className="text-button"
            disabled={disabled}
            onClick={onRebuild}
          >
            重新建模并更新覆盖
          </button>
        </div>
      )}
      {mode === 'facts' ? (
        <div className="fact-browser panel-surface">
          <div className="artifact-tools">
            <label className="search-field">
              <Search size={14} />
              <input
                aria-label="搜索业务事实"
                placeholder="搜索事实或业务说明"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label className="attention-filter">
              <input
                type="checkbox"
                checked={attentionOnly}
                onChange={(event) => setAttentionOnly(event.target.checked)}
              />
              只看待审阅（{attentionCount}）
            </label>
            <span className="muted">
              {visibleFacts.length} / {facts.length} 项
            </span>
          </div>
          <div className="fact-list">
            {visibleFacts.map((fact) => {
              const status = mapped ? coverageForFact(fact.id, mappings) : null
              const factMappings = mappings.filter(
                (mapping) => mapping.factId === fact.id,
              )
              const storyNames = stories
                .filter((story) => story.factIds.includes(fact.id))
                .map((story) => story.name)
              return (
                <details className="fact-row" key={fact.id}>
                  <summary>
                    <span className="fact-id">{fact.id}</span>
                    <span className="fact-statement">{fact.statement}</span>
                    {fact.certainty === 'uncertain' && (
                      <span className="badge partial">待确认</span>
                    )}
                    <span
                      className={`badge ${modelEdited && mapped ? 'pending' : status || 'pending'}`}
                    >
                      {modelEdited && mapped
                        ? '覆盖需更新'
                        : status
                          ? COVERAGE[status]
                          : '待映射'}
                    </span>
                    <ChevronDown size={14} className="fact-chevron" />
                  </summary>
                  <div className="fact-detail">
                    <div className="fact-basis">
                      <div className="fact-meta">
                        <span>{FACT_KINDS[fact.kind]}</span>
                        <span>{CERTAINTY[fact.certainty]}</span>
                      </div>
                      <h3>业务说明依据</h3>
                      <blockquote>{fact.source}</blockquote>
                      <SourceReferences
                        excerpt={fact.source}
                        sources={sources}
                      />
                      {!!storyNames.length && (
                        <p className="source-note">
                          所属故事：{storyNames.join('、')}
                        </p>
                      )}
                    </div>
                    <div className="fact-expression">
                      <h3>{modelEdited ? '先前模型中的表达' : '模型表达'}</h3>
                      {status ? (
                        factMappings.map((mapping, index) => (
                          <div key={index} className="fact-mapping">
                            <div className="mapped-elements">
                              {mapping.elementIds.length ? (
                                mapping.elementIds.map((id) =>
                                  selectable.has(id) && !modelEdited ? (
                                    <button
                                      type="button"
                                      key={id}
                                      onClick={() => onSelectElement(id)}
                                    >
                                      {names.get(id) || id}
                                    </button>
                                  ) : (
                                    <span key={id}>{names.get(id) || id}</span>
                                  ),
                                )
                              ) : (
                                <span>没有对应模型元素</span>
                              )}
                            </div>
                            <p>{mapping.explanation}</p>
                          </div>
                        ))
                      ) : (
                        <p className="muted">{mappingDetail}</p>
                      )}
                    </div>
                  </div>
                </details>
              )
            })}
            {!visibleFacts.length && (
              <div className="empty-state">没有符合当前条件的业务事实。</div>
            )}
          </div>
        </div>
      ) : !selectedStory ? (
        <div className="empty-state panel-surface">
          业务事实已经保留，业务故事尚未形成。
        </div>
      ) : (
        <div className="story-browser">
          <nav className="story-index panel-surface" aria-label="业务故事">
            {stories.map((story, index) => (
              <button
                type="button"
                key={story.id}
                className={selectedStory.id === story.id ? 'active' : ''}
                onClick={() => setSelectedStoryId(story.id)}
              >
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{story.name}</strong>
                <small>{story.steps.length} 个步骤</small>
              </button>
            ))}
          </nav>
          <StoryDetail story={selectedStory} facts={facts} />
        </div>
      )}
    </div>
  )
}

function StoryDetail({
  story,
  facts,
}: {
  story: BusinessStory
  facts: BusinessFact[]
}) {
  return (
    <article className="story-detail panel-surface">
      <header>
        <span className="muted">业务目标</span>
        <h2>{story.name}</h2>
        <p>{story.goal}</p>
      </header>
      <ol className="story-steps">
        {story.steps.map((step) => (
          <li key={step.order}>
            <span>{step.order}</span>
            <div>
              <strong>{step.actor}</strong>
              <p>
                {step.action} · {step.object}
              </p>
              {step.condition && <small>条件：{step.condition}</small>}
              {step.result && <small>结果：{step.result}</small>}
              <div className="story-fact-links">
                {step.factIds.map((id) => (
                  <code key={id}>{id}</code>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ol>
      <details className="story-facts">
        <summary>查看支撑这个故事的 {story.factIds.length} 项事实</summary>
        <ul>
          {story.factIds.map((id) => {
            const fact = facts.find((item) => item.id === id)
            return fact ? <li key={id}>{fact.statement}</li> : null
          })}
        </ul>
      </details>
    </article>
  )
}
