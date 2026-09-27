import { Ajv } from 'ajv'
import type { Assessment } from '../../shared/analysis.ts'
import type { CandidateModel } from '../../shared/model.ts'
import { ASSESSMENT_SCHEMA } from './assessment-schema.ts'
import { validateClarifications } from './clarifications.ts'
import { containsBasis } from '../../shared/clarifications.ts'

const ajv = new Ajv({ allErrors: true })
const validateSchema = ajv.compile<Assessment>(ASSESSMENT_SCHEMA)

function valueAt(root: unknown, segments: string[]): unknown {
  let current = root
  for (const segment of segments) {
    if (Array.isArray(current)) current = current[Number(segment)]
    else if (current && typeof current === 'object')
      current = (current as Record<string, unknown>)[segment]
    else return undefined
  }
  return current
}

// Ajv reports machine paths like data/caseAssessments/1; reviewers and the
// structured retry both need the location and the offending field in words.
function describeLocation(path: string, root: unknown): string {
  const segments = path.split('/').filter(Boolean)
  if (!segments.length) return '评估结果'
  const parts: string[] = []
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]
    if (segment === 'caseAssessments' && /^\d+$/.test(segments[index + 1] || '')) {
      const caseIndex = Number(segments[++index])
      const id = valueAt(root, ['caseAssessments', String(caseIndex), 'caseId'])
      parts.push(`第 ${caseIndex + 1} 个业务案例${typeof id === 'string' && id ? `（${id}）` : ''}`)
    } else if (segment === 'clarifications' && /^\d+$/.test(segments[index + 1] || '')) {
      parts.push(`第 ${Number(segments[++index]) + 1} 条澄清`)
    } else if (segment === 'recommendations' && /^\d+$/.test(segments[index + 1] || '')) {
      parts.push(`第 ${Number(segments[++index]) + 1} 条共性建议`)
    } else {
      parts.push(`字段 ${segment}`)
    }
  }
  return parts.join('的')
}

function readableSchemaErrors(
  errors: typeof validateSchema.errors,
  root: unknown,
): string {
  const lines = (errors || []).map((error) => {
    const where = describeLocation(error.instancePath, root)
    const params = error.params as Record<string, unknown>
    switch (error.keyword) {
      case 'additionalProperties':
        return `${where}包含未定义的字段 ${String(params.additionalProperty)}，请删除该字段。`
      case 'required':
        return `${where}缺少必需字段 ${String(params.missingProperty)}。`
      case 'enum':
        return `${where}的取值不在允许范围内。`
      case 'type':
        return `${where}的类型不正确。`
      case 'minLength':
      case 'pattern':
        return `${where}不能为空。`
      case 'minItems':
        return `${where}至少需要一项。`
      case 'maxItems':
        return `${where}必须为空数组。`
      default:
        return `${where}${error.message || '无效'}。`
    }
  })
  return [...new Set(lines)].slice(0, 5).join(' ')
}
export function parseAssessment(
  value: unknown,
  model: CandidateModel,
  businessBasis: string,
): Assessment {
  if (!validateSchema(value))
    throw new Error(
      `评估结构不完整：${readableSchemaErrors(validateSchema.errors, value).slice(0, 1800)}`,
    )
  const elements = new Set(
    [
      ...model.objects,
      ...model.relations,
      ...model.actions,
      ...model.functions,
      ...model.rules,
    ].map((item) => item.id),
  )
  validateClarifications(value.clarifications, businessBasis)
  const ids = new Set<string>()
  const scenarios = new Set<string>()
  for (const item of value.caseAssessments) {
    const id = item.caseId.trim()
    const scenario = item.scenario.trim().replace(/\s+/g, ' ')
    if (ids.has(id) || !scenario || scenarios.has(scenario))
      throw new Error('业务案例编号或内容重复、无效。')
    ids.add(id)
    scenarios.add(scenario)
    if (!containsBasis(businessBasis, item.basis))
      throw new Error(`业务案例 ${id} 的依据不在本次建模依据中。`)
    if (item.elements.some((element) => !elements.has(element)))
      throw new Error(`业务案例 ${id} 引用了不存在的模型元素。`)
    if ((item.status === 'supported' || item.status === 'partial') && !item.elements.length)
      throw new Error(`业务案例 ${id} 声称有支撑，但没有引用模型元素。`)
    if (item.status === 'supported') {
      if (item.gap.trim() || item.suggestion.trim())
        throw new Error(`业务案例 ${id} 标记为可表达，却仍有缺口或补齐建议。`)
    } else if (!item.gap.trim() || !item.suggestion.trim()) {
      throw new Error(`业务案例 ${id} 缺少具体缺口或未决边界及处理建议。`)
    }
  }
  return {
    ...value,
    clarifications: value.clarifications.map((item) => ({ ...item, basisSource: 'business-basis' })),
  }
}
