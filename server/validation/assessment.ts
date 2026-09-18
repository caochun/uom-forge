import { Ajv } from 'ajv'
import type {
  Assessment,
  ProcessAssessment,
  SupportStatus,
  RequirementAssessment,
} from '../../shared/analysis.ts'
import type { CandidateModel } from '../../shared/model.ts'
import { ASSESSMENT_SCHEMA } from './assessment-schema.ts'
import { validateClarifications } from './clarifications.ts'
import { modelContext } from '../stages/model-context.ts'

const ajv = new Ajv({ allErrors: true })
type AssessmentOutput = Omit<Assessment, 'processAssessments'> & {
  processAssessments: (Omit<
    ProcessAssessment,
    'status' | 'evidence' | 'requirements'
  > & {
    status?: SupportStatus
    evidence?: []
    requirements: (Omit<RequirementAssessment, 'evidence'> & {
      evidence?: []
    })[]
  })[]
}
const validateSchema = ajv.compile<AssessmentOutput>(ASSESSMENT_SCHEMA)

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

// Ajv reports machine paths like data/processAssessments/1; reviewers and the
// structured retry both need the location and the offending field in words.
function describeLocation(path: string, root: unknown): string {
  const segments = path.split('/').filter(Boolean)
  if (!segments.length) return '评估结果'
  const parts: string[] = []
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]
    if (segment === 'processAssessments' && /^\d+$/.test(segments[index + 1] || '')) {
      const process = Number(segments[++index])
      const name = valueAt(root, ['processAssessments', String(process), 'processName'])
      parts.push(
        `第 ${process + 1} 个业务过程${typeof name === 'string' && name ? `（${name}）` : ''}`,
      )
    } else if (segment === 'requirements' && /^\d+$/.test(segments[index + 1] || '')) {
      parts.push(`第 ${Number(segments[++index]) + 1} 项要求`)
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
function processStatus(
  requirements: Pick<RequirementAssessment, 'status'>[],
): SupportStatus {
  if (requirements.every((item) => item.status === 'supported'))
    return 'supported'
  if (requirements.every((item) => item.status === 'missing')) return 'missing'
  return 'partial'
}
export function parseAssessment(
  value: unknown,
  model: CandidateModel,
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
  validateClarifications(value.clarifications, modelContext(model))
  if (model.activities.length && !value.processAssessments.length)
    throw new Error('业务过程支撑评估没有包含模型中的业务过程。')
  const processes = new Set<string>()
  for (const process of value.processAssessments) {
    if (!process.processId || processes.has(process.processId))
      throw new Error('评估中的业务过程 id 无效或重复。')
    processes.add(process.processId)
    const activity = model.activities.find(
      (item) => item.id === process.processId,
    )
    if (!activity)
      throw new Error(
        `评估引用了模型中不存在的业务过程：${process.processId}。`,
      )
    if (activity.requirements.length) {
      const declared = activity.requirements
        .map((item) => item.description)
        .sort()
      const assessed = process.requirements
        .map((item) => item.requirement)
        .sort()
      if (
        declared.length !== assessed.length ||
        declared.some((description, index) => assessed[index] !== description)
      )
        throw new Error(
          `过程 ${activity.name} 的评估要求与模型声明不一致，不能遗漏或新增业务要求。`,
        )
    }
    for (const requirement of process.requirements) {
      if (requirement.elements.some((id) => !elements.has(id)))
        throw new Error(
          `过程 ${process.processName} 的业务要求引用了不存在或不能作为支撑依据的模型元素。`,
        )
      if (requirement.status !== 'missing' && !requirement.elements.length)
        throw new Error(
          `过程 ${process.processName} 的业务要求声称有支撑，但没有引用模型元素。`,
        )
      if (requirement.status === 'supported') {
        if (requirement.gap.trim() || requirement.suggestion.trim())
          throw new Error(
            `过程 ${process.processName} 的业务要求标记为可支撑，却仍有缺口或补齐建议。`,
          )
      } else if (!requirement.gap.trim() || !requirement.suggestion.trim()) {
        throw new Error(
          `过程 ${process.processName} 的业务要求缺少具体缺口或改进建议。`,
        )
      }
    }
  }
  for (const activity of model.activities)
    if (!processes.has(activity.id))
      throw new Error(`业务过程支撑评估遗漏了 ${activity.name}。`)
  return {
    ...value,
    processAssessments: value.processAssessments.map((process) => ({
      ...process,
      evidence: [],
      requirements: process.requirements.map((requirement) => ({
        ...requirement,
        evidence: [],
      })),
      status: processStatus(process.requirements),
    })),
  }
}
