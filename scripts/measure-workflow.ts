import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { loadEnv } from 'vite'
import type { StageEvent } from '../shared/analysis.ts'

// Run against a frozen source copy or this checkout. All fixtures and outputs
// are external, and observation is installed BEFORE either provider is imported.
const { values } = parseArgs({ options: {
  input: { type: 'string' }, output: { type: 'string' },
  'source-root': { type: 'string' }, effort: { type: 'string' },
  'timeout-ms': { type: 'string', default: '600000' },
} })
if (!values.input || !values.output) throw new Error('Usage: npx tsx scripts/measure-workflow.ts --input document.json --output new-directory [--source-root frozen-checkout] [--effort low|high|max]')
const projectRoot = path.resolve(import.meta.dirname, '..')
for (const [key, value] of Object.entries(loadEnv('development', projectRoot, '')))
  if (process.env[key] === undefined) process.env[key] = value
if (values.effort) process.env.GLM_REASONING_EFFORT = values.effort
const timeout = Number(values['timeout-ms'])
if (!Number.isSafeInteger(timeout) || timeout <= 0) throw new Error('timeout-ms must be positive.')
process.env.UOM_PI_TIMEOUT_MS = String(timeout)
process.env.GLM_API_TIMEOUT_MS = String(timeout)
const sourceRoot = path.resolve(values['source-root'] || projectRoot)
const output = path.resolve(values.output)
await mkdir(output) // Never overwrite an earlier run.
const input = JSON.parse(await readFile(values.input, 'utf8'))
const document = input.document || input
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
let phase = 'reading'
let call = 0
const started = performance.now()
const observations: Promise<void>[] = []
const requests: Record<string, unknown>[] = []
const fetcher = globalThis.fetch
const controller = new AbortController()
const stop = () => controller.abort(new Error('Experiment stopped'))
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(String(init?.body || '{}'))
  const id = `${String(++call).padStart(3, '0')}-${phase}`
  const start = performance.now()
  const metric: Record<string, unknown> = {
    id, phase, model: body.model, reasoningEffort: body.reasoning_effort,
    inputCharacters: JSON.stringify(body.messages || []).length,
    toolCharacters: JSON.stringify(body.tools || []).length,
    outputCharacters: 0, reasoningCharacters: 0,
  }
  requests.push(metric)
  await writeFile(path.join(output, `${id}-request.json`), JSON.stringify(body, null, 2))
  try {
    const response = await fetcher(url, init)
    metric.connectedMs = Math.round(performance.now() - start)
    metric.httpStatus = response.status
    if (!response.body) return response
    const [consumer, observer] = response.body.tee()
    observations.push((async () => {
      const reader = observer.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let text = ''
      const accept = (line: string) => {
        if (!line.startsWith('data:')) return
        const data = line.slice(5).trim()
        if (!data || data === '[DONE]') return
        let chunk: any
        try { chunk = JSON.parse(data) } catch { return }
        if (chunk.usage) metric.usage = chunk.usage
        for (const choice of chunk.choices || []) {
          if (choice.finish_reason) metric.finishReason = choice.finish_reason
          const delta = choice.delta || {}
          if (delta.reasoning_content) {
            metric.firstReasoningMs ??= Math.round(performance.now() - start)
            metric.reasoningCharacters = Number(metric.reasoningCharacters) + delta.reasoning_content.length
          }
          const content = (delta.content || '') + (delta.tool_calls || []).map((tool: any) => tool.function?.arguments || '').join('')
          if (content) {
            metric.firstTextMs ??= Math.round(performance.now() - start)
            text += content
          }
        }
      }
      try {
        while (true) {
          const { value, done } = await reader.read()
          buffer += decoder.decode(value, { stream: !done })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          lines.forEach(accept)
          if (done) { accept(buffer); break }
        }
      } catch (error) {
        metric.streamError = error instanceof Error ? error.message : String(error)
      } finally {
        metric.elapsedMs = Math.round(performance.now() - start)
        metric.outputCharacters = text.length
        await writeFile(path.join(output, `${id}-response.txt`), text)
        await writeFile(path.join(output, `${id}-metrics.json`), JSON.stringify(metric, null, 2))
        console.log(JSON.stringify(metric))
      }
    })())
    return new Response(consumer, { status: response.status, statusText: response.statusText, headers: response.headers })
  } catch (error) {
    metric.elapsedMs = Math.round(performance.now() - start)
    metric.error = error instanceof Error ? error.message : String(error)
    throw error
  }
}
const events: unknown[] = []
const saves: Promise<void>[] = []
try {
  const fromSource = (file: string) => import(pathToFileURL(path.join(sourceRoot, file)).href)
  const { createGlmProvider, glmGenerationOptions } = await fromSource('server/providers/glm.ts')
  const { requireModelProviderConfig } = await fromSource('server/providers/model-config.ts')
  const { readBusiness } = await fromSource('server/stages/understanding.ts')
  const { buildModel } = await fromSource('server/stages/modeling.ts')
  const config = requireModelProviderConfig('glm')
  await writeFile(path.join(output, 'metadata.json'), JSON.stringify({
    createdAt: new Date().toISOString(), sourceRoot, documentHash: hash(document),
    model: config.model, parameters: glmGenerationOptions().parameters, timeout,
  }, null, 2))
  await writeFile(path.join(output, 'document.json'), JSON.stringify(document, null, 2))
  const options = {
    provider: 'glm' as const, signal: controller.signal,
    onEvent(event: StageEvent) {
      if (event.type === 'delta') return
      events.push({ ms: Math.round(performance.now() - started), ...event })
      if (event.type === 'phase') {
        phase = event.part || phase
        console.log(`[${phase}] ${event.text}`)
      }
      if (['business-basis', 'design-review', 'model-design', 'understanding-narrative'].includes(event.type))
        saves.push(writeFile(path.join(output, `${events.length}-${event.type}.json`), JSON.stringify(event, null, 2)))
    },
  }
  const runTurn = createGlmProvider()
  const result = await readBusiness(document, options)
  await writeFile(path.join(output, 'understanding.json'), JSON.stringify(result.understanding, null, 2))
  const modeled = await buildModel({ narrative: result.understanding.narrative }, runTurn, options)
  await writeFile(path.join(output, 'model.json'), JSON.stringify(modeled, null, 2))
  if (typeof modeled.businessBasis === 'string') await writeFile(path.join(output, 'business-basis.md'), modeled.businessBasis)
  console.log(`Completed: ${modeled.validation.elements} elements; ${call} requests.`)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  await writeFile(path.join(output, 'error.txt'), message)
  console.error(message)
  process.exitCode = 1
} finally {
  const saved = await Promise.allSettled([...observations, ...saves])
  const failures = saved.filter(result => result.status === 'rejected').map(result => String(result.reason))
  await writeFile(path.join(output, 'summary.json'), JSON.stringify({ elapsedMs: Math.round(performance.now() - started), requests, artifactErrors: failures }, null, 2))
  await writeFile(path.join(output, 'events.json'), JSON.stringify(events, null, 2))
  globalThis.fetch = fetcher
  process.off('SIGINT', stop)
  process.off('SIGTERM', stop)
}
