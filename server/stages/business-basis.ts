import type { RunTurn } from '../providers/types.ts'
import { runPiText } from '../agents/pi-text.ts'
import { scopedTurn, type StageOptions } from './contracts.ts'
import { businessBasisPrompt } from './prompts.ts'

export async function prepareBusinessBasis(narrative: string, runTurn: RunTurn, options: StageOptions = {}): Promise<string> {
  options.signal?.throwIfAborted()
  options.onEvent?.({ type: 'phase', part: 'basis', text: '正在从整理稿提炼业务事实、故事、规则与检验情形。' })
  const prompt = businessBasisPrompt(narrative)
  const usePi = options.runtime === 'pi' || (options.runtime === undefined && process.env.UOM_AGENT_RUNTIME === 'pi')
  const text = usePi ? await runPiText(prompt, 'basis', options) : await runTurn(prompt, scopedTurn(options, 'basis'))
  options.signal?.throwIfAborted()
  if (!text.trim()) throw new Error('未返回业务依据，请重试。')
  options.onEvent?.({ type: 'business-basis', part: 'basis', text })
  return text
}
