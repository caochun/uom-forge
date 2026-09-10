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
    evidence?: []
    requirements: (Omit<RequirementAssessment, 'evidence'> & {
      evidence?: []
    })[]
  })[]
}
const validateSchema = ajv.compile<AssessmentOutput>(ASSESSMENT_SCHEMA)
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
      `评估结构不完整：${ajv.errorsText(validateSchema.errors).slice(0, 1800)}`,
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
