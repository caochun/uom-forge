import { Ajv } from 'ajv'
import type { Assessment, BusinessDocument } from '../../shared/analysis.ts'
import type { CandidateModel } from '../../shared/model.ts'
import { MODEL_COLLECTIONS } from '../../shared/model.ts'
import { ASSESSMENT_SCHEMA } from './assessment-schema.ts'
import { groundCitations } from './evidence.ts'

const ajv = new Ajv({ allErrors: true })
const validateSchema = ajv.compile<Assessment>(ASSESSMENT_SCHEMA)
export function parseAssessment(
  value: unknown,
  model: CandidateModel,
  document: BusinessDocument,
): Assessment {
  if (!validateSchema(value))
    throw new Error(
      `评估结构不完整：${ajv.errorsText(validateSchema.errors).slice(0, 1800)}`,
    )
  const elements = new Set(
    MODEL_COLLECTIONS.flatMap((key) => model[key].map((item) => item.id)),
  )
  const processes = new Set<string>()
  for (const process of value.processAssessments) {
    if (!process.processId || processes.has(process.processId))
      throw new Error('评估中的业务过程 id 无效或重复。')
    processes.add(process.processId)
    if (process.coveredElements.some((id) => !elements.has(id)))
      throw new Error(`过程 ${process.processName} 引用了不存在的模型元素。`)
    if (process.status === 'supported' && !process.coveredElements.length)
      throw new Error(
        `过程 ${process.processName} 声称可支撑，但没有引用模型元素。`,
      )
  }
  return {
    ...value,
    processAssessments: value.processAssessments.map((process) => ({
      ...process,
      evidence: groundCitations(process.evidence, document),
    })),
  }
}
