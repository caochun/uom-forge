import { Ajv } from 'ajv'
import type { ExpressionCheck, ModelChange } from '../../shared/expression.ts'
import type { CandidateModel } from '../../shared/model.ts'
import type { BusinessClarification } from '../../shared/analysis.ts'
import { MODEL_COLLECTIONS } from '../../shared/model.ts'
import { understandingPassages } from '../../shared/expression.ts'
import {
  CLARIFICATION_SCHEMA,
  validateClarifications,
} from './clarifications.ts'
import { isRecord, parseJsonOutput } from './values.ts'
import { validateCompiledModel } from './compiled-model.ts'

const text = { type: 'string', minLength: 1, pattern: '\\S' }
const ajv = new Ajv({ allErrors: true })
type CheckOutput = Omit<
  ExpressionCheck,
  'cases' | 'clarifications' | 'warnings'
> & {
  cases: Omit<ExpressionCheck['cases'][number], 'basis'>[]
  clarifications: unknown[]
}
const { basis: _basis, ...clarificationProperties } =
  CLARIFICATION_SCHEMA.properties
const validateQuestion = ajv.compile<
  Omit<BusinessClarification, 'basis'> & { basisIds: string[] }
>({
  ...CLARIFICATION_SCHEMA,
  required: CLARIFICATION_SCHEMA.required.map((key) =>
    key === 'basis' ? 'basisIds' : key,
  ),
  properties: {
    ...clarificationProperties,
    basisIds: { type: 'array', minItems: 1, uniqueItems: true, items: text },
  },
})
const validate = ajv.compile<CheckOutput>({
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'cases', 'clarifications'],
  properties: {
    summary: text,
    clarifications: { type: 'array' },
    cases: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'fact',
          'basisIds',
          'scenario',
          'status',
          'elements',
          'explanation',
          'gap',
          'suggestion',
        ],
        properties: {
          id: text,
          fact: text,
          basisIds: {
            type: 'array',
            minItems: 1,
            uniqueItems: true,
            items: text,
          },
          scenario: text,
          explanation: text,
          status: { enum: ['expressed', 'defect', 'uncertain'] },
          elements: { type: 'array', uniqueItems: true, items: text },
          gap: { type: 'string' },
          suggestion: { type: 'string' },
        },
      },
    },
  },
})

export function parseExpressionCheck(
  raw: string,
  narrative: string,
  model: CandidateModel,
  previous?: ExpressionCheck,
): ExpressionCheck {
  let value = parseJsonOutput(raw, '业务表达检查')
  // Empty optional metadata and set-like references do not require inference.
  // Resolve exact, unique display names only; never guess an unknown target.
  const elements = MODEL_COLLECTIONS.flatMap((key) =>
    model[key].map(({ id, name }) => ({ id, name })),
  )
  const ids = new Set(elements.map((item) => item.id))
  if (model.boundaries.length) ids.add('boundaries')
  if (model.summary.trim()) ids.add('summary')
  if (isRecord(value)) {
    if (value.clarifications === undefined) value.clarifications = []
    if (previous && value.additionalCases === undefined)
      value.additionalCases = []
    for (const key of ['cases', 'judgments', 'additionalCases']) {
      const items = value[key]
      if (!Array.isArray(items)) continue
      for (const item of items) {
        if (!isRecord(item)) continue
        if (Array.isArray(item.elements))
          item.elements = [
            ...new Set(
              item.elements.map((ref) => {
                if (ids.has(ref)) return ref
                const matches = elements.filter(
                  (element) => element.name === ref,
                )
                return matches.length === 1 ? matches[0].id : ref
              }),
            ),
          ]
        if (Array.isArray(item.basisIds))
          item.basisIds = [...new Set(item.basisIds)]
      }
    }
  }
  if (previous) {
    if (
      !isRecord(value) ||
      !Array.isArray(value.judgments) ||
      !Array.isArray(value.additionalCases) ||
      Object.keys(value).some(
        (key) =>
          ![
            'summary',
            'judgments',
            'additionalCases',
            'clarifications',
          ].includes(key),
      )
    )
      throw new Error('复查必须逐项返回 judgments，不能改变原有用例。')
    const judgments = value.judgments
    if (judgments.length !== previous.cases.length)
      throw new Error('复查遗漏或增加了原有用例判断。')
    const cases = previous.cases.map(({ basis: _basis, ...prior }) => {
      const matches = judgments.filter(
        (item) => isRecord(item) && item.id === prior.id,
      )
      if (matches.length !== 1 || !isRecord(matches[0]))
        throw new Error(`复查遗漏或重复了原有用例 ${prior.id}。`)
      const judgment = matches[0]
      if (
        ['id', 'status', 'elements', 'explanation', 'gap', 'suggestion'].some(
          (key) => !(key in judgment),
        )
      )
        throw new Error(`复查用例 ${prior.id} 的判断不完整。`)
      if (
        Object.keys(judgment).some(
          (key) =>
            ![
              'id',
              'status',
              'elements',
              'explanation',
              'gap',
              'suggestion',
            ].includes(key),
        )
      )
        throw new Error(`复查不能改变用例 ${prior.id} 的事实、依据或情形。`)
      if (prior.status === 'uncertain' && judgment.status === 'expressed') {
        return {
          ...prior,
          elements: judgment.elements,
          explanation: `${judgment.explanation} 模型可以表达未决边界，业务歧义仍需确认。`,
        }
      }
      return { ...prior, ...judgment }
    })
    value = {
      summary: value.summary,
      cases: [...cases, ...value.additionalCases],
      clarifications: value.clarifications,
    }
  }
  if (!validate(value))
    throw new Error(
      `业务表达检查结构无效：${ajv.errorsText(validate.errors).slice(0, 800)}`,
    )
  const seen = new Set<string>()
  const passages = new Map(
    understandingPassages(narrative).map((item) => [item.id, item.text]),
  )
  for (const item of value.cases) {
    if (seen.has(item.id)) throw new Error(`重复检查用例：${item.id}`)
    seen.add(item.id)
    if (item.basisIds.some((id) => !passages.has(id)))
      throw new Error(`检查用例 ${item.id} 的依据段落不在业务说明中。`)
    if (item.elements.some((id) => !ids.has(id)))
      throw new Error(`检查用例 ${item.id} 引用了不存在的模型元素。`)
    if (item.status === 'expressed' && !item.elements.length)
      throw new Error(`可表达用例 ${item.id} 必须指向实际模型元素。`)
    if (
      item.status !== 'expressed' &&
      (!item.gap.trim() || !item.suggestion.trim())
    )
      throw new Error(`未解决用例 ${item.id} 缺少具体差异或建议。`)
  }
  for (const prior of previous?.cases || []) {
    const item = value.cases.find((item) => item.id === prior.id)
    if (
      !item ||
      (['fact', 'scenario'] as const).some((key) => item[key] !== prior[key]) ||
      JSON.stringify(item.basisIds) !== JSON.stringify(prior.basisIds)
    )
      throw new Error(
        `复查遗漏或改变了原有用例 ${prior.id}，不能据此判为通过。`,
      )
  }
  // Optional questions must never invalidate usable fact checks. Invalid
  // metadata is visible, but cannot become a user question or repair premise.
  const clarifications: BusinessClarification[] = []
  const warnings: string[] = []
  for (const [index, question] of value.clarifications.entries()) {
    try {
      if (!validateQuestion(question)) throw new Error('结构不完整')
      if (question.basisIds.some((id) => !passages.has(id)))
        throw new Error('引用的业务说明段落不存在')
      const { basisIds, ...fields } = question
      const item = {
        ...fields,
        basis: basisIds.map((id) => passages.get(id)!).join('\n\n'),
      }
      validateClarifications([...clarifications, item], narrative)
      clarifications.push(item)
    } catch (error) {
      warnings.push(
        `检查中的第 ${index + 1} 项业务澄清未进入问题目录：${error instanceof Error ? error.message : String(error)}。`,
      )
    }
  }
  return {
    ...value,
    clarifications,
    warnings,
    cases: value.cases.map((item) => ({
      ...item,
      basis: item.basisIds.map((id) => passages.get(id)!).join('\n\n'),
    })),
  }
}

export function applyModelRepair(
  raw: string,
  model: CandidateModel,
  check: ExpressionCheck,
): { model: CandidateModel; changes: ModelChange[] } {
  const value = parseJsonOutput(raw, '定点修正')
  if (
    !isRecord(value) ||
    !Array.isArray(value.changes) ||
    Object.keys(value).some((key) => key !== 'changes')
  )
    throw new Error('定点修正必须返回 changes 数组。')
  const candidate = structuredClone(model)
  const defects = new Set(
    check.cases
      .filter((item) => item.status === 'defect')
      .map((item) => item.id),
  )
  const seen = new Set<string>()
  const changes: ModelChange[] = []
  for (const change of value.changes) {
    if (
      !isRecord(change) ||
      typeof change.collection !== 'string' ||
      typeof change.id !== 'string' ||
      !change.id.trim() ||
      !('value' in change) ||
      typeof change.reason !== 'string' ||
      !change.reason.trim() ||
      !Array.isArray(change.caseIds) ||
      !change.caseIds.length ||
      change.caseIds.some((id) => typeof id !== 'string' || !defects.has(id))
    )
      throw new Error('修正必须关联真实模型缺陷，不能替用户回答业务歧义。')
    const key = `${change.collection}:${change.id}`
    if (seen.has(key)) throw new Error(`重复修正：${key}`)
    seen.add(key)
    if (change.collection === 'model') {
      if (change.id === 'summary' && typeof change.value === 'string')
        candidate.summary = change.value
      else if (
        change.id === 'boundaries' &&
        Array.isArray(change.value) &&
        change.value.every((item) => typeof item === 'string')
      )
        candidate.boundaries = change.value
      else throw new Error('修正只能更新模型的 summary 或 boundaries。')
    } else {
      const collection = MODEL_COLLECTIONS.find(
        (key) => key === change.collection,
      )
      if (!collection) throw new Error(`未知修正集合：${change.collection}`)
      const items: unknown[] = candidate[collection]
      const index = candidate[collection].findIndex(
        (item) => item.id === change.id,
      )
      if (change.value === null) {
        if (index < 0) throw new Error(`不能删除不存在的元素：${key}`)
        items.splice(index, 1)
      } else {
        if (!isRecord(change.value) || change.value.id !== change.id)
          throw new Error(`修正元素 id 不一致：${key}`)
        const element: Record<string, unknown> = {
          evidence: [],
          ...(['objects', 'relations'].includes(collection)
            ? { properties: [] }
            : {}),
          ...(['actions', 'functions'].includes(collection)
            ? { inputs: [] }
            : {}),
          ...change.value,
        }
        if (collection === 'activities' && Array.isArray(element.requirements))
          element.requirements = element.requirements.map((item) =>
            isRecord(item)
              ? {
                  evidence: [],
                  status: 'partial',
                  reason: '待支撑评估',
                  ...item,
                }
              : item,
          )
        if (index < 0) items.push(element)
        else items[index] = element
      }
    }
    changes.push(change as unknown as ModelChange)
  }
  // Atomic validation: no partial patch can escape on any failure.
  return { model: validateCompiledModel(JSON.stringify(candidate)), changes }
}
