import type { CandidateModel } from '../../shared/model.ts'
import { parseCandidateModel } from './model.ts'
import { parseJsonOutput } from './values.ts'

export function validateCompiledModel(raw: string): CandidateModel {
  const candidate = parseCandidateModel(parseJsonOutput(raw), { blocks: [] })
  // Reject invalid references instead of silently removing objects or edges.
  for (const item of [...candidate.objects, ...candidate.relations]) {
    if (item.properties.length) throw new Error('本轮只识别概念，不细化属性。')
  }
  for (const item of [...candidate.actions, ...candidate.functions]) {
    if (item.inputs.length) throw new Error('本轮不细化操作和能力的输入字段。')
  }
  for (const activity of candidate.activities)
    for (const requirement of activity.requirements) {
      if (
        requirement.status !== 'partial' ||
        requirement.reason !== '待支撑评估'
      )
        throw new Error('模型整理阶段不能代替支撑评估。')
    }
  return candidate
}
