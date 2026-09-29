import type { AnalysisEvent } from '../../shared/analysis.ts'
import { parseAnalysisEvent } from '../responses.ts'

/** Decode one analysis stream at the browser transport boundary. */
export async function readSse<T = AnalysisEvent>(
  response: Response,
  onEvent: (event: T) => void,
  parse: (value: unknown) => T = ((value: unknown) => parseAnalysisEvent(value) as T),
): Promise<void> {
  if (!response.body) throw new Error('分析服务没有返回流')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
    const events = buffer.split(/\n\n/)
    buffer = events.pop() || ''
    for (const event of events) {
      const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('')
      if (data) onEvent(parse(JSON.parse(data) as unknown))
    }
    if (done) break
  }
  if (buffer.trim()) {
    const data = buffer.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('')
    if (data) onEvent(parse(JSON.parse(data) as unknown))
  }
}

