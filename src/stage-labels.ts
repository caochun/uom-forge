import type { StagePart } from '../shared/analysis.ts'

export const STAGE_PART_LABELS: Record<StagePart, string> = {
  reading: '业务理解',
  basis: '业务依据',
  design: '模型设计',
  'design-check': '设计检查',
  compile: '模型编译',
  narrate: '模型自述',
  assess: '业务过程支撑',
}
