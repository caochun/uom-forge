import { Ajv } from 'ajv'
import type { CandidateModel } from '../../shared/model.ts'
import { MODEL_COLLECTIONS } from '../../shared/model.ts'
import type { BusinessDocument } from '../../shared/analysis.ts'
import { MODEL_SCHEMA } from './model-schema.ts'
import { validateEvidence } from './evidence.ts'

const ajv = new Ajv({ allErrors: true })
const validateSchema = ajv.compile<CandidateModel>(MODEL_SCHEMA)

export function parseCandidateModel(
  value: unknown,
  document?: Pick<BusinessDocument, 'blocks'>,
): CandidateModel {
  if (!validateSchema(value))
    throw new Error(
      `模型结构不完整：${ajv.errorsText(validateSchema.errors).slice(0, 1800)}`,
    )
  const ids = new Set<string>()
  for (const key of MODEL_COLLECTIONS)
    for (const item of value[key]) {
      if (ids.has(item.id)) throw new Error(`模型元素 id 重复：${item.id}`)
      ids.add(item.id)
    }
  const objects = new Set(value.objects.map((item) => item.id))
  for (const relation of value.relations)
    if (!objects.has(relation.from) || !objects.has(relation.to))
      throw new Error(`关系 ${relation.id} 的端点不是已有对象。`)
  for (const item of [...value.actions, ...value.functions])
    if (item.targets.some((id) => !objects.has(id)))
      throw new Error(`操作/能力 ${item.id} 引用了不存在的目标对象。`)
  for (const item of value.rules) {
    if (item.elements.some((id) => !ids.has(id)))
      throw new Error(
        `规则/活动引用了不存在的模型元素：${item.elements.join(', ')}`,
      )
    if ('status' in item && item.status === 'covered' && !item.elements.length)
      throw new Error('已覆盖的活动要求必须指向模型元素。')
  }
  if (document) validateEvidence(value, document)
  return value
}
