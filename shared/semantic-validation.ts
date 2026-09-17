import type { SemanticPlanV2 } from './semantic.ts'
import type { CandidateModel } from './model.ts'
import { containsBasis, questionKey } from './clarifications.ts'

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(text)
const unique = (values: string[]) => new Set(values).size === values.length

// Used at HTTP, SSE and storage boundaries. Structural checks and literal
// citations establish traceability, not the truth of an LLM interpretation.
export function validateSemanticPlan(
  value: unknown,
  narrative?: string,
  model?: CandidateModel,
): SemanticPlanV2 {
  const raw = value
  if (
    !record(raw) ||
    (raw.schemaVersion !== undefined && raw.schemaVersion !== '2') ||
    !Array.isArray(raw.facts) || !Array.isArray(raw.stories) ||
    !Array.isArray(raw.mappings) || !strings(raw.boundaries) ||
    !Array.isArray(raw.clarifications)
  ) throw new Error('语义计划结构无效。')

  // Drafts written before progressive snapshots had no explicit version or
  // status. Infer the safe status for those drafts instead of discarding them.
  const status = raw.status === undefined
    ? (raw.mappings.length ? 'mapped' : raw.stories.length ? 'stories' : 'facts')
    : raw.status
  if (!['facts', 'stories', 'mapped'].includes(String(status)))
    throw new Error('语义计划状态无效。')

  const factIds = new Set<string>()
  for (const [index, fact] of raw.facts.entries()) {
    if (!record(fact)) throw new Error(`业务事实第 ${index + 1} 项不是对象。`)
    if (!text(fact.id)) throw new Error(`业务事实第 ${index + 1} 项缺少 id。`)
    if (factIds.has(fact.id)) throw new Error(`业务事实 ID ${fact.id} 重复。`)
    if (!text(fact.statement)) throw new Error(`业务事实 ${fact.id} 缺少 statement。`)
    if (!text(fact.source)) throw new Error(`业务事实 ${fact.id} 缺少 source。`)
    if (!strings(fact.actors)) throw new Error(`业务事实 ${fact.id} 的 actors 无效。`)
    if (!strings(fact.objects)) throw new Error(`业务事实 ${fact.id} 的 objects 无效。`)
    if (!strings(fact.conditions)) throw new Error(`业务事实 ${fact.id} 的 conditions 无效。`)
    if (!['static', 'event', 'state', 'constraint', 'role'].includes(String(fact.kind)))
      throw new Error(`业务事实 ${fact.id} 的 kind 无效。`)
    if (!['explicit', 'confirmed', 'uncertain'].includes(String(fact.certainty)))
      throw new Error(`业务事实 ${fact.id} 的 certainty 无效。`)
    if (fact.result !== undefined && !text(fact.result))
      throw new Error(`业务事实 ${fact.id} 的 result 无效。`)
    if (narrative !== undefined && !containsBasis(narrative, fact.source))
      throw new Error(`业务事实 ${fact.id} 的 source 不存在于业务说明中。`)
    factIds.add(fact.id)
  }

  const storyIds = new Set<string>()
  for (const story of raw.stories) {
    if (
      !record(story) || !text(story.id) || storyIds.has(story.id) ||
      !text(story.name) || !text(story.goal) ||
      !strings(story.factIds) || !story.factIds.length || !unique(story.factIds) ||
      !Array.isArray(story.steps) || !story.steps.length
    ) throw new Error('业务故事不完整或重复。')
    storyIds.add(story.id)
    for (const id of story.factIds)
      if (!factIds.has(id)) throw new Error(`业务故事引用未知事实 ${id}。`)
    for (const [index, step] of story.steps.entries()) {
      if (
        !record(step) || step.order !== index + 1 ||
        !text(step.actor) || !text(step.action) || !text(step.object) ||
        !strings(step.factIds) || !step.factIds.length || !unique(step.factIds) ||
        (step.condition !== undefined && !text(step.condition)) ||
        (step.result !== undefined && !text(step.result))
      ) throw new Error(`业务故事 ${story.id} 的步骤不完整。`)
      for (const id of step.factIds) {
        if (!factIds.has(id)) throw new Error(`业务步骤引用未知事实 ${id}。`)
        if (!story.factIds.includes(id)) throw new Error(`业务步骤事实 ${id} 未纳入所属故事。`)
      }
    }
  }

  const collections = {
    object: 'objects', relation: 'relations', action: 'actions',
    function: 'functions', rule: 'rules', activity: 'activities',
  } as const
  const elementTypes = new Map<string, string>()
  if (model)
    for (const [type, collection] of Object.entries(collections))
      for (const element of model[collection]) elementTypes.set(element.id, type)
  const mappedFacts = new Set<string>()
  const mappingKeys = new Set<string>()
  for (const mapping of raw.mappings) {
    if (
      !record(mapping) || !text(mapping.factId) || !factIds.has(mapping.factId) ||
      !strings(mapping.elementIds) || !unique(mapping.elementIds) ||
      !text(mapping.explanation) || !Object.hasOwn(collections, String(mapping.mappingType)) ||
      !['full', 'partial', 'missing'].includes(String(mapping.coverage))
    ) throw new Error(`事实映射无效或引用未知事实 ${record(mapping) ? mapping.factId : ''}。`)
    if ((mapping.coverage === 'missing') !== (mapping.elementIds.length === 0))
      throw new Error(`事实 ${mapping.factId} 的覆盖结论与元素引用不一致。`)
    const key = `${mapping.factId}:${mapping.mappingType}`
    if (mappingKeys.has(key)) throw new Error(`事实映射重复：${key}。`)
    mappingKeys.add(key)
    mappedFacts.add(mapping.factId)
    if (model) {
      for (const id of mapping.elementIds)
        if (!elementTypes.has(id)) throw new Error(`事实映射引用不存在的模型元素 ${id}。`)
      if (mapping.elementIds.some((id) => elementTypes.get(id) !== mapping.mappingType))
        throw new Error(`事实 ${mapping.factId} 的映射类型与模型元素不一致。`)
    }
  }
  if (status !== 'mapped' && raw.mappings.length)
    throw new Error('尚未完成映射的语义计划不能携带映射结论。')
  if (status === 'facts' && raw.stories.length)
    throw new Error('尚未组织故事的语义计划不能携带业务故事。')
  if (status === 'mapped')
    for (const id of factIds)
      if (!mappedFacts.has(id)) throw new Error(`事实 ${id} 缺少映射结论。`)

  const questions = new Set<string>()
  for (const item of raw.clarifications) {
    if (
      !record(item) || !text(item.text) || !text(item.basis) ||
      !text(item.ambiguity) || !text(item.impact) ||
      !strings(item.options) || !unique(item.options) || typeof item.multiple !== 'boolean'
    ) throw new Error('语义计划中的澄清问题不完整。')
    const key = questionKey(item.text)
    if (!key || questions.has(key)) throw new Error('语义计划中的澄清问题重复或无效。')
    questions.add(key)
    if (narrative !== undefined && !containsBasis(narrative, item.basis))
      throw new Error('语义计划中的澄清依据不在当前业务说明中。')
  }
  return {
    ...(raw as unknown as SemanticPlanV2),
    schemaVersion: '2',
    status: status as SemanticPlanV2['status'],
  }
}
