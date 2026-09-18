import type { RunTurn } from '../providers/types.ts'
import type { StageOptions } from './contracts.ts'
import { scopedTurn } from './contracts.ts'
import { parseJsonOutput } from '../validation/values.ts'
import { validateSemanticPlan } from '../validation/semantic.ts'
import { containsBasis } from '../../shared/clarifications.ts'
import type { BusinessClarification } from '../../shared/analysis.ts'
import type { CandidateModel } from '../../shared/model.ts'
import { modelContext } from './model-context.ts'
import type {
  BusinessFact,
  BusinessStory,
  ElementMapping,
  SemanticPlanV2,
} from '../../shared/semantic.ts'

function objectJson(raw: string, label: string): Record<string, unknown> {
  const value = parseJsonOutput(raw, label)
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label}必须是 JSON 对象。`)
  return value as Record<string, unknown>
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    throw new Error(`${label}必须是字符串数组。`)
  return value as string[]
}

function cleanStringArray(value: unknown, label: string): string[] {
  return [...new Set(stringArray(value, label).map((item) => item.trim()).filter(Boolean))]
}

type FactPreparation = {
  facts: BusinessFact[]
  clarifications: BusinessClarification[]
}

function sourceBlocks(narrative: string): { id: string; text: string }[] {
  return narrative
    .split(/\r?\n/)
    .map((line) =>
      line
        .trim()
        .replace(/^#{1,6}\s+/, '')
        .replace(/^[-*+]\s+/, '')
        .replace(/^\d+[.)、]\s+/, '')
        .replace(/[*_`]/g, ''),
    )
    .filter(Boolean)
    .map((text, index) => ({
      id: `S${String(index + 1).padStart(4, '0')}`,
      text,
    }))
}

function citedSource(
  value: Record<string, unknown>,
  blocks: Map<string, string>,
  narrative: string,
  label: string,
): string {
  if (Array.isArray(value.sourceIds)) {
    const ids = stringArray(value.sourceIds, `${label}.sourceIds`)
    const uniqueIds = [...new Set(ids)]
    if (!uniqueIds.length) throw new Error(`${label} 缺少 sourceIds。`)
    const unknown = uniqueIds.filter((id) => !blocks.has(id))
    if (unknown.length)
      throw new Error(`${label} 引用了未知业务说明片段 ${unknown.join('、')}。`)
    const excerpts = uniqueIds.map((id) => blocks.get(id)!)
    return excerpts.length === 1
      ? excerpts[0]
      : excerpts.map((text) => `“${text}”`).join('；')
  }
  // Accept the previous protocol during rolling upgrades, but never accept a
  // paraphrase as evidence.
  const legacy = String(value.source || '').trim()
  if (legacy && containsBasis(narrative, legacy)) return legacy
  if (legacy) throw new Error(`${label} 的 source 不存在于业务说明中。`)
  throw new Error(`${label} 缺少有效 sourceIds。`)
}

function parseFactPreparation(
  raw: string,
  narrative: string,
  sources: { id: string; text: string }[],
): FactPreparation {
  const root = objectJson(raw, '业务事实')
  if (!Array.isArray(root.facts)) throw new Error('业务事实缺少 facts 数组。')
  if (!root.facts.length) throw new Error('业务事实不能为空。')
  const byId = new Map(sources.map((source) => [source.id, source.text]))
  const usedIds = new Set<string>()
  const facts = root.facts.map((item, index): BusinessFact => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new Error(`业务事实 ${index + 1} 格式无效。`)
    const value = item as Record<string, unknown>
    const proposedId = typeof value.id === 'string' ? value.id.trim() : ''
    let id = proposedId
    if (!id || usedIds.has(id)) {
      let sequence = index + 1
      do id = `F${String(sequence++).padStart(4, '0')}`
      while (usedIds.has(id))
    }
    usedIds.add(id)
    const result = value.result == null ? '' : String(value.result).trim()
    const fact: BusinessFact = {
      id,
      statement: String(value.statement || '').trim(),
      kind: value.kind as BusinessFact['kind'],
      actors: cleanStringArray(value.actors, `${id}.actors`),
      objects: cleanStringArray(value.objects, `${id}.objects`),
      conditions: cleanStringArray(value.conditions, `${id}.conditions`),
      ...(result ? { result } : {}),
      source: citedSource(value, byId, narrative, `业务事实 ${id}`),
      certainty: value.certainty as BusinessFact['certainty'],
    }
    if (!fact.statement)
      throw new Error(`业务事实 ${fact.id} 缺少 statement。`)
    if (!['static', 'event', 'state', 'constraint', 'role'].includes(fact.kind))
      throw new Error(`业务事实 ${fact.id} 的 kind 无效。`)
    if (!['explicit', 'confirmed', 'uncertain'].includes(fact.certainty))
      throw new Error(`业务事实 ${fact.id} 的 certainty 无效。`)
    return fact
  })
  const seen = new Set<string>()
  const uniqueFacts = facts.filter((fact) => {
    const key = fact.statement.replace(/\s+/g, ' ').trim()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const clarifications = Array.isArray(root.clarifications)
    ? root.clarifications.map((item, index): BusinessClarification => {
        if (!item || typeof item !== 'object' || Array.isArray(item))
          throw new Error(`业务澄清 ${index + 1} 格式无效。`)
        const value = item as Record<string, unknown>
        const clarification: BusinessClarification = {
          text: String(value.text || '').trim(),
          basis: citedSource(value, byId, narrative, `业务澄清 ${index + 1}`),
          ambiguity: String(value.ambiguity || '').trim(),
          impact: String(value.impact || '').trim(),
          options: value.options === undefined
            ? []
            : cleanStringArray(value.options, 'clarification.options'),
          multiple: value.multiple === true,
        }
        if (!clarification.text || !clarification.ambiguity || !clarification.impact)
          throw new Error(`业务澄清 ${index + 1} 内容不完整。`)
        return clarification
      })
    : []
  return { facts: uniqueFacts, clarifications }
}

async function extractFactPreparation(
  narrative: string,
  runTurn: RunTurn,
  options: StageOptions = {},
): Promise<FactPreparation> {
  const sources = sourceBlocks(narrative)
  let formatError = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await runTurn(
      `你是业务事实提取器。只从业务说明片段提取最小、可判断的业务事实，不补充常识，不把模型设计当成业务事实。每项事实必须使用 sourceIds 引用一个或多个输入片段 id，不得复制、改写或自造 source；章节标题不能单独作为事实依据。kind 只能是 static、event、state、constraint、role；无法直接确定的事实标记 uncertain。只有不同答案会实质改变对象、关系、行为、规则或业务过程时，才放入 clarifications；澄清项同样必须使用 sourceIds，且本轮继续建模时把相关事实保留为 uncertain，不能假设答案。只输出一个 JSON 对象：{"facts":[{"id","statement","kind","actors":[],"objects":[],"conditions":[],"result","sourceIds":[],"certainty":"explicit|confirmed|uncertain"}],"clarifications":[{"text","sourceIds":[],"ambiguity","impact","options":[],"multiple":false}]}。
示例：片段 S0001 为“审核通过后，仓库才能发货。”，可提取 sourceIds:["S0001"]、kind:"constraint"、conditions:["审核通过"]。材料未说明“订单一定有唯一编号”，不得生成该事实。
${formatError ? `上次结果未通过程序校验：${formatError}\n请只修正 JSON 结构或片段引用后重新提交。\n` : ''}业务说明片段（JSON 数据）：${JSON.stringify(sources)}`,
      { ...scopedTurn(options, 'semantic'), outputFormat: 'json' },
    )
    try {
      const prepared = parseFactPreparation(raw, narrative, sources)
      validateSemanticPlan(
        {
          schemaVersion: '2',
          status: 'facts',
          facts: prepared.facts,
          stories: [],
          mappings: [],
          boundaries: [],
          clarifications: prepared.clarifications,
        },
        narrative,
      )
      return prepared
    } catch (error) {
      formatError = error instanceof Error ? error.message : String(error)
      if (attempt === 1) throw error
      options.onEvent?.({
        type: 'phase',
        part: 'semantic',
        text: '业务事实结构或引用未通过校验，正在修正后重试。',
      })
    }
    options.signal?.throwIfAborted()
  }
  throw new Error('业务事实未返回有效结果。')
}

export async function extractFacts(
  narrative: string,
  runTurn: RunTurn,
  options: StageOptions = {},
): Promise<BusinessFact[]> {
  return (await extractFactPreparation(narrative, runTurn, options)).facts
}

export async function organizeStories(
  facts: BusinessFact[],
  runTurn: RunTurn,
  options: StageOptions = {},
): Promise<BusinessStory[]> {
  const knownFactIds = new Set(facts.map((fact) => fact.id))
  const parseStories = (raw: string): BusinessStory[] => {
    const root = objectJson(raw, '业务故事')
    if (!Array.isArray(root.stories))
      throw new Error('业务故事缺少 stories 数组。')
    return root.stories.map((item, storyIndex): BusinessStory => {
      if (!item || typeof item !== 'object' || Array.isArray(item))
        throw new Error(`业务故事 ${storyIndex + 1} 格式无效。`)
      const value = item as Record<string, unknown>
      const storyId = String(value.id || `story-${storyIndex + 1}`)
      const rawSteps = Array.isArray(value.steps) ? value.steps : []
      const parsedSteps = rawSteps.map((step, stepIndex) => {
        if (!step || typeof step !== 'object' || Array.isArray(step))
          throw new Error(`业务故事 ${storyId} 第 ${stepIndex + 1} 步格式无效。`)
        const value = step as Record<string, unknown>
        const order = typeof value.order === 'number' ||
          (typeof value.order === 'string' && value.order.trim())
          ? Number(value.order) : NaN
        if (!Number.isInteger(order) || order < 1)
          throw new Error(`业务故事 ${storyId} 第 ${stepIndex + 1} 步的 order 必须是正整数。`)
        return {
          order,
          actor: String(value.actor || '').trim(),
          action: String(value.action || '').trim(),
          object: String(value.object || '').trim(),
          condition: value.condition == null ? undefined : String(value.condition).trim() || undefined,
          result: value.result == null ? undefined : String(value.result).trim() || undefined,
          factIds: cleanStringArray(value.factIds, `${storyId} 第 ${stepIndex + 1} 步的 factIds`),
        }
      })
      // Step order is a mechanical index. Models often number steps globally
      // across stories or skip values; sequence is the meaning, so renumber
      // after a stable sort and only reject genuinely ambiguous orderings.
      const orders = parsedSteps.map((step) => step.order)
      if (new Set(orders).size !== orders.length)
        throw new Error(`业务故事 ${storyId} 的步骤 order 有重复，无法确定先后顺序。`)
      const steps: BusinessStory['steps'] = [...parsedSteps]
        .sort((a, b) => a.order - b.order)
        .map((step, index) => ({ ...step, order: index + 1 }))
      const declaredFactIds = value.factIds === undefined
        ? []
        : cleanStringArray(value.factIds, 'story.factIds')
      // The story-level list is a redundant index. Derive its complete value
      // from the steps so a valid step citation cannot be lost due to an LLM
      // omitting the same id from the parent object.
      const story: BusinessStory = {
        id: storyId,
        name: String(value.name || '').trim(),
        goal: String(value.goal || '').trim(),
        factIds: [...new Set([
          ...declaredFactIds,
          ...steps.flatMap((step) => step.factIds),
        ])],
        steps,
      }
      if (!story.name || !story.goal || !story.steps.length)
        throw new Error(`业务故事 ${story.id} 缺少 name、goal 或步骤。`)
      for (const id of story.factIds)
        if (!knownFactIds.has(id))
          throw new Error(`业务故事 ${story.id} 引用未知事实 ${id}。`)
      for (const step of story.steps) {
        const missing = [
          !step.actor ? 'actor' : '',
          !step.action ? 'action' : '',
          !step.object ? 'object' : '',
          !step.factIds.length ? 'factIds' : '',
        ].filter(Boolean)
        if (missing.length)
          throw new Error(
            `业务故事 ${story.id} 第 ${step.order} 步（${step.action || step.actor || '未命名'}）缺少 ${missing.join('、')}。`,
          )
      }
      return story
    })
  }

  let formatError = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await runTurn(
      `把以下已经提取的业务事实组织成业务故事。不得创造事实；每一步必须引用 factIds；故事的 factIds 必须包含其全部步骤引用的事实。只输出一个 JSON 对象：{"stories":[{"id","name","goal","factIds":[],"steps":[{"order","actor","action","object","condition","result","factIds":[]}]}]}。
${formatError ? `上次结果未通过程序校验：${formatError}\n请只修正 JSON 结构、步骤顺序或事实引用后重新提交。\n` : ''}事实：${JSON.stringify(facts)}`,
      { ...scopedTurn(options, 'semantic'), outputFormat: 'json' },
    )
    try {
      const stories = parseStories(raw)
      // Keep aggregate checks inside the retry boundary too (e.g. duplicate
      // story ids). A successful parse must satisfy the published contract.
      validateSemanticPlan({ schemaVersion: '2', status: 'stories', facts, stories, mappings: [], boundaries: [], clarifications: [] })
      return stories
    } catch (error) {
      formatError = error instanceof Error ? error.message : String(error)
      if (attempt === 1) throw error
      options.onEvent?.({
        type: 'phase',
        part: 'semantic',
        text: '业务故事结构未通过校验，正在修正后重试。',
      })
    }
    options.signal?.throwIfAborted()
  }
  throw new Error('业务故事未返回有效结果。')
}

export async function mapFactsToElements(
  facts: BusinessFact[],
  stories: BusinessStory[],
  model: CandidateModel | undefined,
  runTurn: RunTurn,
  options: StageOptions = {},
): Promise<ElementMapping[]> {
  const factIds = new Set(facts.map((fact) => fact.id))
  const mappingTypes = [
    'object', 'relation', 'action', 'function', 'rule', 'activity',
  ] as const
  const elementTypes = new Map<string, ElementMapping['mappingType']>()
  if (model) {
    for (const item of model.objects) elementTypes.set(item.id, 'object')
    for (const item of model.relations) elementTypes.set(item.id, 'relation')
    for (const item of model.actions) elementTypes.set(item.id, 'action')
    for (const item of model.functions) elementTypes.set(item.id, 'function')
    for (const item of model.rules) elementTypes.set(item.id, 'rule')
    for (const item of model.activities) elementTypes.set(item.id, 'activity')
  }
  const parseMappings = (raw: string): ElementMapping[] => {
    const root = objectJson(raw, '事实映射')
    if (!Array.isArray(root.mappings))
      throw new Error('事实映射缺少 mappings 数组。')
    const normalized = root.mappings.flatMap((item): ElementMapping[] => {
      if (!item || typeof item !== 'object' || Array.isArray(item))
        throw new Error('事实映射项格式无效。')
      const value = item as Record<string, unknown>
      const factId = String(value.factId || '').trim()
      const elementIds = cleanStringArray(value.elementIds, 'elementIds')
      const declaredType = value.mappingType as ElementMapping['mappingType']
      const explanation = String(value.explanation || '').trim()
      const coverage = value.coverage as ElementMapping['coverage']
      if (!factIds.has(factId) || !explanation ||
          !mappingTypes.includes(declaredType) ||
          !['full', 'partial', 'missing'].includes(coverage))
        throw new Error(`事实映射无效或引用未知事实 ${factId}。`)
      if ((coverage === 'missing') !== (elementIds.length === 0))
        throw new Error(`事实 ${factId} 的覆盖结论与元素引用不一致。`)
      if (!model)
        return [{ factId, elementIds, mappingType: declaredType, explanation, coverage }]
      const unknown = elementIds.filter((id) => !elementTypes.has(id))
      if (unknown.length)
        throw new Error(`事实映射引用不存在的模型元素 ${unknown.join('、')}。`)
      if (!elementIds.length)
        return [{ factId, elementIds, mappingType: declaredType, explanation, coverage }]
      const grouped = new Map<ElementMapping['mappingType'], string[]>()
      for (const id of elementIds) {
        const type = elementTypes.get(id)!
        grouped.set(type, [...(grouped.get(type) || []), id])
      }
      return [...grouped].map(([mappingType, ids]) => ({
        factId,
        elementIds: ids,
        mappingType,
        explanation,
        coverage,
      }))
    })
    const merged = new Map<string, ElementMapping>()
    const coverageRank = { missing: 0, partial: 1, full: 2 } as const
    for (const mapping of normalized) {
      const key = `${mapping.factId}:${mapping.mappingType}`
      const previous = merged.get(key)
      if (!previous) {
        merged.set(key, mapping)
        continue
      }
      const explanations = [...new Set([previous.explanation, mapping.explanation])]
      merged.set(key, {
        ...previous,
        elementIds: [...new Set([...previous.elementIds, ...mapping.elementIds])],
        explanation: explanations.join('；'),
        coverage:
          coverageRank[mapping.coverage] > coverageRank[previous.coverage]
            ? mapping.coverage
            : previous.coverage,
      })
    }
    return [...merged.values()]
  }

  let formatError = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await runTurn(
      `将事实和业务故事映射到已经编译的候选领域模型元素。只能使用候选模型中真实存在的 id；每条映射的 elementIds 必须属于同一种 mappingType，不同类型必须拆成多条映射。每个事实至少给出一条映射，无法支撑时使用空 elementIds 和 coverage=missing。只输出一个 JSON 对象：{"mappings":[{"factId","elementIds":[],"mappingType":"object|relation|action|function|rule|activity","explanation","coverage":"full|partial|missing"}]}。
${formatError ? `上次结果未通过程序校验：${formatError}\n请只修正元素 id、映射类型或覆盖结论后重新提交。\n` : ''}事实：${JSON.stringify(facts)}
业务故事：${JSON.stringify(stories)}
候选模型：${JSON.stringify(modelContext(model))}`,
      { ...scopedTurn(options, 'semantic'), outputFormat: 'json' },
    )
    try {
      const mappings = parseMappings(raw)
      validateSemanticPlan({ schemaVersion: '2', status: 'mapped', facts, stories, mappings, boundaries: [], clarifications: [] }, undefined, model)
      return mappings
    } catch (error) {
      formatError = error instanceof Error ? error.message : String(error)
      if (attempt === 1) throw error
      options.onEvent?.({
        type: 'phase',
        part: 'semantic',
        text: '事实映射结构未通过校验，正在修正后重试。',
      })
    }
    options.signal?.throwIfAborted()
  }
  throw new Error('事实映射未返回有效结果。')
}

function semanticOptions(options: StageOptions): StageOptions {
  return {
    ...options,
    onEvent: (event) => {
      // JSON handoff is persisted as a typed event; raw extraction fragments
      // are intentionally kept out of the normal modeling transcript.
      if (event.type !== 'delta') options.onEvent?.(event)
    },
  }
}

/** Fixed semantic preparation shared by direct and Pi modeling runtimes. */
export async function buildSemanticPreparation(
  narrative: string,
  runTurn: RunTurn,
  options: StageOptions = {},
): Promise<SemanticPlanV2> {
  const internalOptions = semanticOptions(options)
  options.onEvent?.({ type: 'phase', part: 'semantic', text: '正在提取业务事实。' })
  const extracted = await extractFactPreparation(narrative, runTurn, internalOptions)
  const facts = extracted.facts
  const factSnapshot = validateSemanticPlan(
    { schemaVersion: '2', status: 'facts', facts, stories: [], mappings: [], boundaries: [], clarifications: extracted.clarifications },
    narrative,
  )
  options.onEvent?.({ type: 'semantic-plan', part: 'semantic', semantic: factSnapshot })
  options.onEvent?.({ type: 'phase', part: 'semantic', text: '正在组织业务故事与过程。' })
  const stories = await organizeStories(facts, runTurn, internalOptions)
  const storySnapshot = validateSemanticPlan(
    {
      ...factSnapshot,
      schemaVersion: '2',
      status: 'stories',
      stories,
      mappings: [],
    },
    narrative,
  )
  options.onEvent?.({ type: 'semantic-plan', part: 'semantic', semantic: storySnapshot })
  return storySnapshot
}

/** Complete the handoff after B has supplied the actual model element ids. */
export async function mapSemanticPlan(
  prepared: SemanticPlanV2,
  model: CandidateModel,
  runTurn: RunTurn,
  narrative: string,
  options: StageOptions = {},
): Promise<SemanticPlanV2> {
  options.onEvent?.({ type: 'phase', part: 'semantic', text: '正在建立事实到模型元素的映射。' })
  const mappings = await mapFactsToElements(
    prepared.facts,
    prepared.stories,
    model,
    runTurn,
    semanticOptions(options),
  )
  const mapped = validateSemanticPlan(
    { ...prepared, schemaVersion: '2', status: 'mapped', mappings },
    narrative,
    model,
  )
  options.onEvent?.({ type: 'semantic-plan', part: 'semantic', semantic: mapped })
  return mapped
}

export async function buildSemanticPlan(
  narrative: string,
  model: CandidateModel,
  runTurn: RunTurn,
  options: StageOptions = {},
): Promise<SemanticPlanV2> {
  // This convenience API returns one atomic plan. The modeling orchestrator
  // uses buildSemanticPreparation directly when it wants progressive SSE
  // snapshots.
  const prepared = await buildSemanticPreparation(narrative, runTurn, {
    ...options,
    onEvent: (event) => {
      if (event.type !== 'semantic-plan') options.onEvent?.(event)
    },
  })
  return mapSemanticPlan(prepared, model, runTurn, narrative, options)
}
