import { runPiText } from '../llm/pi/text-agent.ts'
import type { StageOptions } from './contracts.ts'
import { businessBasisPrompt, type BasisCorrection } from '../prompts/business-basis.ts'
import type { UnderstandingSources } from '../../shared/analysis.ts'

export async function prepareBusinessBasis(narrative: string, options: StageOptions = {}, sources?: UnderstandingSources, correction?: BasisCorrection): Promise<string> {
  options.signal?.throwIfAborted()
  options.onEvent?.({ type: 'phase', part: 'basis', text: correction ? '正在根据业务来源校正建模依据。' : '正在核对业务来源并提炼事实、已知计划、规则与业务案例。' })
  const prompt = businessBasisPrompt(narrative, sources, correction)
  const text = await (options.agents?.text || runPiText)(prompt, 'basis', options)
  options.signal?.throwIfAborted()
  if (!text.trim()) throw new Error('未返回建模依据，请重试。')
  if (correction && text.trim() === correction.previous.trim()) return correction.previous
  options.onEvent?.({ type: 'business-basis', part: 'basis', text, ...(correction ? { revised: true } : {}) })
  return text
}
