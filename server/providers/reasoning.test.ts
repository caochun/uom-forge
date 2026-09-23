import test from 'node:test'
import assert from 'node:assert/strict'
import { Agent } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'
import type { ProviderId } from '../../shared/analysis.ts'
import type { ReasoningEffort } from '../../shared/reasoning.ts'
import { publicModelOptions, parseReasoningEffort } from './reasoning.ts'
import { createPiModel, createPiStream } from './pi.ts'
import { createGlmProvider } from './glm.ts'
import { createGptProvider } from './gpt.ts'
import { createDeepSeekProvider } from './deepseek.ts'
import { createQwenProvider } from './qwen.ts'

const env = {
  GLM_API_KEY: 'secret-glm', GLM_MODEL: 'glm-5.3-flash', GLM_REASONING_EFFORT: 'max',
  GPT_API_KEY: 'secret-gpt', GPT_API_URL: 'https://gpt.invalid/v1', GPT_MODEL: 'gpt-6-astra', GPT_REASONING_EFFORT: 'high',
  LLM_API_KEY: 'secret-ds', LLM_API_URL: 'https://deepseek.invalid/v1', LLM_MODEL: 'deepseek-flash',
  QWEN_API_KEY: 'secret-qwen', QWEN_API_URL: 'http://qwen.invalid/v1', QWEN_MODEL: 'Qwen3.6',
}
const frame = (delta: unknown, finish_reason: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`
const response = () => new Response(frame({ content: 'ok' }, 'stop') + 'data: [DONE]\n\n', {
  headers: { 'content-type': 'text/event-stream' },
})

test('public model options reflect configured models without disclosing credentials, with conservative unknown-model fallback', () => {
  const options = publicModelOptions(env)
  assert.deepEqual(options.glm.efforts, ['low', 'high', 'max'])
  assert.deepEqual(options.gpt.efforts, ['low', 'medium', 'high', 'xhigh', 'max'])
  assert.deepEqual(options.deepseek.efforts, ['none', 'low', 'high', 'max'])
  assert.deepEqual(options.qwen.efforts, ['none', 'enabled'])
  for (const profile of Object.values(options)) assert.equal(profile.defaultEffort, profile.efforts[0])
  assert.doesNotMatch(JSON.stringify(options), /secret-|https?:/)
  const changed = { ...env, GPT_MODEL: 'another-model' }
  assert.deepEqual(publicModelOptions(changed).gpt.efforts, ['default'])
  assert.throws(() => parseReasoningEffort('gpt', 'low', changed), /不支持/)
  assert.equal(parseReasoningEffort('gpt', 'default', changed), 'default')
  for (const [provider, invalid] of [['glm', 'none'], ['glm', 'medium'], ['gpt', 'none'], ['qwen', 'low'], ['deepseek', 'xhigh']] as const)
    assert.throws(() => parseReasoningEffort(provider, invalid, env), /不支持/)
})

function checkParameters(body: Record<string, any>, provider: ProviderId, effort: ReasoningEffort) {
  if (provider === 'glm' || provider === 'gpt') assert.equal(body.reasoning_effort, effort)
  if (provider === 'glm') assert.deepEqual(body.thinking, { type: 'enabled', clear_thinking: false })
  if (provider === 'deepseek') {
    assert.deepEqual(body.thinking, { type: effort === 'none' ? 'disabled' : 'enabled' })
    assert.equal(body.reasoning_effort, effort === 'none' ? undefined : effort)
  }
  if (provider === 'qwen') {
    assert.equal(body.reasoning_effort, undefined, 'Qwen does not accept invented named effort levels')
    assert.deepEqual(body.chat_template_kwargs, { enable_thinking: effort === 'enabled' })
    assert.equal(body.enable_thinking, undefined)
  }
}

test('every selectable effort reaches Pi and the provider interface unchanged, independently of environment and SDK defaults', async () => {
  const factories = { glm: createGlmProvider, gpt: createGptProvider, deepseek: createDeepSeekProvider, qwen: createQwenProvider }
  const before = { ...env }
  for (const provider of Object.keys(factories) as ProviderId[]) {
    // Run different selections concurrently through the same provider factory.
    const providerTurn = factories[provider](async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      checkParameters(body, provider, body.messages[0].content)
      return response()
    }, env)
    await Promise.all(publicModelOptions(env)[provider].efforts.map(async effort => {
      await providerTurn(effort, { reasoningEffort: effort })
      let sent = false
      const stream = createPiStream(provider, () => false, env, effort)
      const result = await stream(createPiModel(provider, env, effort), {
        messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }],
      }, {
        reasoning: 'minimal',
        fetch: async (_url, init) => {
          sent = true
          checkParameters(JSON.parse(String(init?.body)), provider, effort)
          return response()
        },
      })
      assert.equal((await result.result()).stopReason, 'stop')
      assert.equal(sent, true)
    }))
  }
  assert.deepEqual(env, before, 'one request must not alter another user’s or stage’s settings')
})

test('DeepSeek thinking and reasoning history survive a Pi tool loop without being forced off', async () => {
  const requests: any[] = []
  const stream = createPiStream('deepseek', () => false, env, 'high')
  const agent = new Agent({
    initialState: {
      model: createPiModel('deepseek', env, 'high'), thinkingLevel: 'minimal',
      tools: [{ name: 'check', label: 'check', description: 'check', parameters: Type.Object({}),
        execute: async () => ({ content: [{ type: 'text', text: 'checked' }], details: {} }),
      }],
    },
    streamFn: (model, context, options) => stream(model, context, {
      ...options,
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body))
        requests.push(body)
        checkParameters(body, 'deepseek', 'high')
        if (requests.length === 2) return response()
        return new Response(frame({ reasoning_content: '检查事实。' }) + frame({ content: '设计。' }) + frame({ tool_calls: [
          { index: 0, id: 'check-1', type: 'function', function: { name: 'check', arguments: '{}' } },
        ] }, 'tool_calls') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
      },
    }),
  })
  agent.shouldStopAfterTurn = () => requests.length >= 2
  await agent.prompt('check')
  assert.equal(agent.state.errorMessage, undefined)
  assert.equal(requests.length, 2)
  const assistant = requests[1].messages.find((message: any) => message.role === 'assistant')
  assert.equal(assistant.reasoning_content, '检查事实。')
  assert.equal(assistant.content, '设计。')
  assert.equal(requests[1].messages.find((message: any) => message.role === 'tool').content, 'checked')
})

test('Qwen uses DashScope’s top-level switch when configured for its official API', async () => {
  const cloud = { ...env, QWEN_API_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }
  for (const effort of ['none', 'enabled'] as const) {
    const verify: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      assert.equal(body.enable_thinking, effort === 'enabled')
      assert.equal(body.chat_template_kwargs, undefined)
      assert.equal(body.reasoning_effort, undefined)
      return response()
    }
    await createQwenProvider(verify, cloud)('hi', { reasoningEffort: effort })
    const output = await createPiStream('qwen', () => false, cloud, effort)(createPiModel('qwen', cloud, effort), {
      messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }],
    }, { fetch: verify })
    assert.equal((await output.result()).stopReason, 'stop')
  }
})
