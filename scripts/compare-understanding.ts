import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { loadEnv } from 'vite'
import { runProviderTurn, resolveProvider } from '../server/providers/index.ts'
import { readBusiness } from '../server/stages/understanding.ts'
import type { StageEvent } from '../shared/analysis.ts'
import type { StageOptions } from '../server/stages/contracts.ts'
import { errorMessage, isRecord } from '../server/validation/values.ts'
import { validateDocument } from '../server/validation/document.ts'
import { understandingPrompt } from '../server/stages/prompts.ts'

// Evaluation input is supplied externally; no domain documents or expected
// concepts belong in Forge's prompts or application bundle.
const { values } = parseArgs({
  options: {
    input: { type: 'string' },
    output: { type: 'string' },
    provider: { type: 'string' },
  },
})
if (!values.input || !values.output)
  throw new Error(
    'Usage: npx tsx scripts/compare-understanding.ts --input input.json --output output-directory [--provider deepseek|gpt]',
  )
const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
for (const [key, value] of Object.entries(
  loadEnv('development', path.resolve(projectRoot, '..'), ''),
)) {
  if (process.env[key] === undefined) process.env[key] = value
}
const input: unknown = JSON.parse(await readFile(values.input, 'utf8'))
if (!isRecord(input)) throw new Error('Input must be an object.')
const { document, baselinePrompt } = input
const provider = resolveProvider(values.provider)
const outputDirectory = values.output
validateDocument(document)
if (typeof baselinePrompt !== 'string' || !baselinePrompt.trim())
  throw new Error(
    'input.json must contain document and the frozen baselinePrompt.',
  )
await mkdir(values.output, { recursive: true })
const documentHash = createHash('sha256')
  .update(JSON.stringify(document))
  .digest('hex')
const candidatePrompt = understandingPrompt(document)
const metadata = {
  provider,
  document: document.name,
  documentHash,
  createdAt: new Date().toISOString(),
  baselinePromptLength: baselinePrompt.length,
  candidatePromptLength: candidatePrompt.length,
}
await writeFile(
  path.join(outputDirectory, 'metadata.json'),
  JSON.stringify(metadata, null, 2),
)
await writeFile(
  path.join(outputDirectory, 'candidate-prompt.txt'),
  candidatePrompt,
)
const run = async (
  name: string,
  callback: (options: StageOptions) => Promise<unknown>,
) => {
  const events: StageEvent[] = []
  const started = Date.now()
  try {
    const result = await callback({
      provider,
      onEvent: (event) => events.push(event),
    })
    await writeFile(
      path.join(outputDirectory, `${name}.json`),
      JSON.stringify(
        { durationMs: Date.now() - started, result, events },
        null,
        2,
      ),
    )
    console.log(
      `${name}: completed (${Math.round((Date.now() - started) / 1000)}s)`,
    )
    return result
  } catch (error) {
    await writeFile(
      path.join(outputDirectory, `${name}.json`),
      JSON.stringify(
        {
          durationMs: Date.now() - started,
          error: errorMessage(error),
          events,
        },
        null,
        2,
      ),
    )
    console.error(`${name}: ${errorMessage(error)}`)
    throw error
  }
}
console.log(`Comparing ${values.provider} prompts; results in ${values.output}`)
const results = await Promise.allSettled([
  run('baseline', (options) => runProviderTurn(baselinePrompt, options)),
  run('candidate', (options) =>
    readBusiness(document, runProviderTurn, options),
  ),
])
if (results.some((result) => result.status === 'rejected')) process.exitCode = 1
