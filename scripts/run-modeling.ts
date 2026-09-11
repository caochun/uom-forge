import { readFile, writeFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { buildModel, compileModel } from '../server/stages/modeling.ts'
import { runProviderTurn, resolveProvider } from '../server/providers/index.ts'
import type { ModelingInput, ProviderEvent } from '../shared/analysis.ts'
import type { RunTurn } from '../server/providers/types.ts'
import type { StageOptions } from '../server/stages/contracts.ts'
import { isRecord } from '../server/validation/values.ts'
import { requireText } from '../server/validation/document.ts'

// External fixtures only. Keep business examples out of product prompts/code.
const { values } = parseArgs({
  options: {
    input: { type: 'string' },
    'semantic-plan': { type: 'string' },
    narrative: { type: 'string' },
    provider: { type: 'string' },
  },
})
if (Boolean(values.input) === Boolean(values['semantic-plan']))
  throw new Error(
    'Specify --input input.json OR --semantic-plan plan.md [--provider deepseek|gpt]',
  )
const provider = resolveProvider(values.provider)
const savedPlan = values['semantic-plan']
  ? await readFile(values['semantic-plan'], 'utf8')
  : null
const retryNarrative = values.narrative
  ? await readFile(values.narrative, 'utf8')
  : ''
if (savedPlan !== null)
  requireText(retryNarrative, '重试检查所需的业务说明（--narrative）')
let input: ModelingInput | null = null
if (values.input) {
  const value: unknown = JSON.parse(await readFile(values.input, 'utf8'))
  if (!isRecord(value)) throw new Error('Input must be an object.')
  requireText(value.narrative, '业务说明')
  if (value.feedback !== undefined && typeof value.feedback !== 'string')
    throw new Error('Feedback must be text.')
  input = {
    narrative: value.narrative,
    feedback: value.feedback,
    currentModel: value.currentModel,
  }
}
const output = await mkdtemp(path.join(tmpdir(), 'forge-modeling-'))
await writeFile(
  path.join(output, 'input.json'),
  JSON.stringify(
    input || { semanticPlan: savedPlan, narrative: retryNarrative },
    null,
    2,
  ),
)
const events: unknown[] = []
const timings: unknown[] = []
const started = Date.now()
let turn = 0
let part = 'semantic'
console.log(`Artifacts: ${output}`)
try {
  const invoke: RunTurn = async (prompt, options) => {
    const name = `${++turn}-${part}`
    await writeFile(path.join(output, `${name}-prompt.txt`), prompt)
    const turnStarted = Date.now()
    let streamed = ''
    let firstOutputMs: number | null = null
    try {
      const raw = await runProviderTurn(prompt, {
        ...options,
        onEvent: (event: ProviderEvent) => {
          if (event.type === 'delta' && !event.reasoning) {
            firstOutputMs ??= Date.now() - turnStarted
            streamed += event.text || ''
          }
          options.onEvent?.(event)
        },
      })
      await writeFile(path.join(output, `${name}-raw.txt`), raw)
      return raw
    } finally {
      await writeFile(path.join(output, `${name}-stream.txt`), streamed)
      timings.push({
        step: name,
        ms: Date.now() - turnStarted,
        firstOutputMs,
        promptCharacters: prompt.length,
        outputCharacters: streamed.length,
      })
    }
  }
  const options: StageOptions = {
    provider,
    onEvent: (event) => {
      events.push({ ms: Date.now() - started, ...event })
      if (event.type === 'phase' && event.part) part = event.part
      if (event.type === 'phase') console.log(`[${event.part}] ${event.text}`)
    },
  }
  const result =
    savedPlan === null
      ? await buildModel(input!, invoke, options)
      : await compileModel(savedPlan, retryNarrative, invoke, options)
  await writeFile(
    path.join(output, 'result.json'),
    JSON.stringify(result, null, 2),
  )
  console.log(
    `Completed: ${result.validation.elements} elements, ${Date.now() - started} ms`,
  )
} catch (error) {
  await writeFile(
    path.join(output, 'error.txt'),
    error instanceof Error ? error.stack || error.message : String(error),
  )
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await writeFile(
    path.join(output, 'events.json'),
    JSON.stringify(events, null, 2),
  )
  await writeFile(
    path.join(output, 'timings.json'),
    JSON.stringify(timings, null, 2),
  )
}
