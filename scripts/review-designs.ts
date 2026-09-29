import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { loadEnv } from 'vite'
import { writeFileSync } from 'node:fs'
import { runProviderTurn, resolveProvider } from '../server/providers/index.ts'
import { prepareDesignAcceptance } from '../server/stages/design-acceptance.ts'
import { designReviewPrompt } from '../server/stages/design-review.ts'
import { parseDesignCheckReport, checkedDesignVerdict, designCheckMarkdown } from '../server/validation/design-acceptance.ts'
import { parseAnalysisRequest } from '../server/validation/requests.ts'
import { requireText } from '../server/validation/document.ts'
import { isRecord } from '../server/validation/values.ts'
import type { ReasoningEffort } from '../shared/reasoning.ts'

// External fixtures only. Each design receives the same source-derived checklist
// and an independent review; neither review is shown to the other.
const root = path.resolve(import.meta.dirname, '..')
for (const [key, value] of Object.entries(loadEnv('development', root, ''))) {
  if (process.env[key] === undefined) process.env[key] = value
}
const { values } = parseArgs({ options: {
  input: { type: 'string' }, output: { type: 'string' }, provider: { type: 'string' }, effort: { type: 'string', default: 'high' },
  acceptance: { type: 'string' },
} })
if (!values.input) throw new Error('Use --input external-fixture.json [--output new-directory] [--provider glm] [--effort high].')
const input: unknown = JSON.parse(await readFile(values.input, 'utf8'))
if (!isRecord(input)) throw new Error('Expected a fixture object.')
const provider = resolveProvider(values.provider)
const request = parseAnalysisRequest({ stage: 'model', narrative: input.narrative, sources: input.sources, reasoningEffort: values.effort }, provider)
if (request.stage !== 'model') throw new Error('Expected modeling context.')
requireText(input.businessBasis, '建模依据')
if (!Array.isArray(input.designs) || !input.designs.length) throw new Error('Expected at least one design.')
const designs = input.designs.map((d, i) => {
  if (!isRecord(d)) throw new Error(`Invalid design ${i + 1}.`)
  requireText(d.name, '设计名称'); requireText(d.text, '模型设计')
  return { name: d.name as string, text: d.text as string }
})
const output = values.output ? path.resolve(values.output) : await mkdtemp(path.join(tmpdir(), 'forge-design-review-'))
if (values.output) await mkdir(output, { recursive: false })
await writeFile(path.join(output, 'input.json'), JSON.stringify(input, null, 2))
const context = { narrative: request.narrative, sources: request.sources }
const businessBasis = input.businessBasis as string
const events: unknown[] = []
let call = 0
console.log(`Artifacts: ${output}`)
async function invoke(label: string, prompt: string) {
  const name = `${String(++call).padStart(2, '0')}-${label}`
  await writeFile(path.join(output, `${name}-prompt.md`), prompt)
  const started = Date.now()
  let text = ''
  let reasoningCharacters = 0
  let lastProgress = 0
  console.log(`Started: ${name}`)
  try {
    const raw = await runProviderTurn(prompt, { provider, reasoningEffort: values.effort as ReasoningEffort, outputFormat: 'json', onEvent: e => {
      if (e.type === 'timing' || e.type === 'reset') events.push({ call: name, ...e })
      if (e.type === 'reset') { text = ''; reasoningCharacters = 0 }
      if (e.type === 'delta') {
        if (e.reasoning) reasoningCharacters += e.text.length
        else text += e.text
      }
      if (Date.now() - lastProgress > 10000) {
        lastProgress = Date.now()
        writeFileSync(path.join(output, 'progress.json'), JSON.stringify({ call: name, elapsedMs: Date.now() - started, textCharacters: text.length, reasoningCharacters }))
      }
    } })
    await writeFile(path.join(output, `${name}-raw.json`), raw)
    console.log(`Completed: ${name} (${Math.round((Date.now() - started) / 1000)}s)`)
    return raw
  } finally {
    await writeFile(path.join(output, `${name}-stream.txt`), text)
    await writeFile(path.join(output, 'events.json'), JSON.stringify(events, null, 2))
  }
}
try {
  const savedRaw = values.acceptance ? await readFile(values.acceptance, 'utf8') : undefined
  if (savedRaw) await writeFile(path.join(output, 'saved-acceptance-raw.json'), savedRaw)
  const acceptance = await prepareDesignAcceptance(context, prompt => invoke('acceptance', prompt), {}, savedRaw)
  await writeFile(path.join(output, 'acceptance.json'), JSON.stringify(acceptance, null, 2))
  const results = []
  for (const [i, design] of designs.entries()) {
    const raw = await invoke(`review-${i + 1}`, designReviewPrompt(businessBasis, design.text, [], context, acceptance))
    try {
      const report = parseDesignCheckReport(raw, acceptance, design.text, businessBasis, context)
      await writeFile(path.join(output, `review-${i + 1}.md`), designCheckMarkdown(report, acceptance))
      results.push({ name: design.name, verdict: checkedDesignVerdict(report), report })
    } catch (error) {
      results.push({ name: design.name, verdict: 'unknown', error: error instanceof Error ? error.message : String(error) })
      process.exitCode = 1
    }
    await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
  }
} catch (error) {
  await writeFile(path.join(output, 'error.txt'), error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  await writeFile(path.join(output, 'events.json'), JSON.stringify(events, null, 2))
}
