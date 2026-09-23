import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { loadEnv } from 'vite'
import {
  codexConfigFromEnv,
  createCodexProvider,
} from '../server/providers/codex.ts'
import { readBusiness } from '../server/stages/understanding.ts'
import { understandingPrompt } from '../server/stages/prompts.ts'
import { validateDocument } from '../server/validation/document.ts'
import { errorMessage, isRecord } from '../server/validation/values.ts'
import type { StageEvent, TurnTiming } from '../shared/analysis.ts'
import { scopedTurn } from '../server/stages/contracts.ts'

// The input document and experiment artifacts stay outside the application.
// This runs the actual first stage with identical input and isolated sessions.
const { values } = parseArgs({
  options: {
    input: { type: 'string' },
    output: { type: 'string' },
    rounds: { type: 'string', default: '1' },
    efforts: { type: 'string', default: 'xhigh,high' },
    'timeout-ms': { type: 'string', default: '600000' },
  },
})
if (!values.input || !values.output)
  throw new Error(
    'Usage: npx tsx scripts/compare-reasoning.ts --input document.json --output new-results-directory [--efforts xhigh,high,medium] [--rounds 2] [--timeout-ms 600000]',
  )
const rounds = Number(values.rounds)
const timeout = Number(values['timeout-ms'])
const efforts = values.efforts.split(',').map((effort) => effort.trim())
if (
  efforts.some(
    (effort) => !['low', 'medium', 'high', 'xhigh'].includes(effort),
  ) ||
  new Set(efforts).size !== efforts.length
)
  throw new Error(
    'efforts must be a comma-separated list of distinct low, medium, high or xhigh values.',
  )
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 5)
  throw new Error('rounds must be an integer between 1 and 5.')
if (!Number.isInteger(timeout) || timeout <= 0)
  throw new Error('timeout-ms must be a positive integer.')
const env = {
  ...loadEnv('development', path.resolve(import.meta.dirname, '..'), ''),
  ...process.env,
}
const input: unknown = JSON.parse(await readFile(values.input, 'utf8'))
const rawDocument =
  isRecord(input) && 'document' in input ? input.document : input
validateDocument(rawDocument)
const document = {
  name: rawDocument.name,
  blocks: rawDocument.blocks.map(({ id, text }) => ({ id, text })),
}
const prompt = understandingPrompt(document)
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const output = path.resolve(values.output)
// Refuse to overwrite an earlier experiment.
await mkdir(output)
const metadata = {
  createdAt: new Date().toISOString(),
  model: String(codexConfigFromEnv(env).model),
  document: document.name,
  documentHash: hash(JSON.stringify(document)),
  promptHash: hash(prompt),
  promptCharacters: Array.from(prompt).length,
  rounds,
  timeoutMs: timeout,
  order: Array.from({ length: rounds }, (_, index) =>
    index % 2 === 0 ? efforts : [...efforts].reverse(),
  ),
}
await writeFile(
  path.join(output, 'metadata.json'),
  JSON.stringify(metadata, null, 2),
)
await writeFile(
  path.join(output, 'document.json'),
  JSON.stringify(document, null, 2),
)
await writeFile(path.join(output, 'prompt.txt'), prompt)
const summaries: { name: string; timing?: TurnTiming; error?: string }[] = []
const controller = new AbortController()
const stop = () =>
  controller.abort(new DOMException('Experiment stopped', 'AbortError'))
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
try {
  for (const [index, efforts] of metadata.order.entries()) {
    for (const effort of efforts) {
      if (controller.signal.aborted) break
      const name = `${index + 1}-${effort}`
      const events: (StageEvent & { observedMs: number })[] = []
      const started = performance.now()
      let raw = ''
      let timing: TurnTiming | undefined
      const provider = createCodexProvider(undefined, {
        ...env,
        CODEX_REASONING_EFFORT: effort,
        CODEX_ACP_TIMEOUT_MS: String(timeout),
      })
      console.log(
        `${name}: starting ${metadata.model}, ${metadata.promptCharacters} prompt characters`,
      )
      try {
        const result = await readBusiness(document, {
          signal: controller.signal,
          agents: {
            text: (value, _part, options) => provider(value, scopedTurn(options, 'reading')),
          },
          onEvent(event) {
            const observedMs = Math.round(performance.now() - started)
            events.push({ ...event, observedMs })
            if (event.type === 'delta' && !event.reasoning) raw += event.text
            if (event.type === 'timing') {
              timing = event.timing
              console.log(`${name}: ${JSON.stringify(timing)}`)
            }
            if (event.type === 'phase' && observedMs > 1000)
              console.log(
                `${name}: ${Math.round(observedMs / 1000)}s, ${Array.from(raw).length} body characters, ${event.text}`,
              )
          },
        })
        await writeFile(
          path.join(output, `${name}.json`),
          JSON.stringify({ result, events, timing }, null, 2),
        )
        summaries.push({ name, timing })
      } catch (error) {
        const message = errorMessage(error)
        await writeFile(
          path.join(output, `${name}.json`),
          JSON.stringify({ error: message, events, timing }, null, 2),
        )
        summaries.push({ name, timing, error: message })
        console.error(`${name}: ${message}`)
        process.exitCode = 1
      } finally {
        await writeFile(path.join(output, `${name}.md`), raw)
        await writeFile(
          path.join(output, 'summary.json'),
          JSON.stringify(summaries, null, 2),
        )
      }
    }
  }
} finally {
  process.off('SIGINT', stop)
  process.off('SIGTERM', stop)
}
console.log(`Results: ${output}`)
