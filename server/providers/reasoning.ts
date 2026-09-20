import { PROVIDERS, type ProviderId } from '../../shared/analysis.ts'
import type { ModelOptions, ModelReasoningOptions, ReasoningEffort } from '../../shared/reasoning.ts'
import { modelProviderConfig } from './model-config.ts'

// Sources and the configured GPT gateway's model-specific validation response:
// docs/model-reasoning.md. Do not assume every model of a vendor has these levels.
export function modelReasoningOptions(provider: ProviderId, env: NodeJS.ProcessEnv = process.env): ModelReasoningOptions {
  const { model } = modelProviderConfig(provider, env)
  const id = model.toLowerCase()
  let efforts: ReasoningEffort[] = ['default']
  let description = '尚未确认此模型的可调档位，沿用服务配置。'
  if (provider === 'glm' && /^glm-5\.3(?:$|-)/.test(id)) {
    efforts = ['low', 'high', 'max']
    description = 'GLM 5.3 系列始终开启思考，可选择低、高、最高。'
  } else if (provider === 'gpt' && id === 'gpt-6-astra') {
    efforts = ['low', 'medium', 'high', 'xhigh', 'max']
    description = '当前 GPT 网关确认支持这五档，此模型不支持关闭思考。'
  } else if (provider === 'deepseek' && /^deepseek-(flash|pro)(?:$|-)/.test(id)) {
    efforts = ['none', 'low', 'high', 'max']
    description = '可关闭思考；开启后支持低、高、最高三档。'
  } else if (provider === 'qwen' && /^qwen3\.6(?:$|-)/.test(id)) {
    efforts = ['none', 'enabled']
    description = '支持关闭或开启思考，没有 low/high 等固定强度档位。'
  }
  return { model, efforts, defaultEffort: efforts[0], description }
}

export function publicModelOptions(env: NodeJS.ProcessEnv = process.env): ModelOptions {
  return Object.fromEntries(Object.keys(PROVIDERS).map(provider =>
    [provider, modelReasoningOptions(provider as ProviderId, env)],
  )) as ModelOptions
}

export function parseReasoningEffort(provider: ProviderId, value: unknown, env: NodeJS.ProcessEnv = process.env): ReasoningEffort | undefined {
  if (value === undefined) return undefined
  const settings = modelReasoningOptions(provider, env)
  if (typeof value !== 'string' || !settings.efforts.includes(value as ReasoningEffort))
    throw new Error(`${settings.model} 不支持所选思考强度，可选值：${settings.efforts.join('、')}。`)
  return value as ReasoningEffort
}

/** Request-scoped overrides; never mutate process.env or another user's settings. */
export function selectedReasoning(provider: ProviderId, requested: ReasoningEffort | undefined, env: NodeJS.ProcessEnv = process.env): {
  effort?: ReasoningEffort
  parameters: Record<string, unknown>
} {
  const effort = parseReasoningEffort(provider, requested, env)
  if (!effort || effort === 'default') return { parameters: {} }
  if (provider === 'glm' || provider === 'gpt')
    return { effort, parameters: { reasoning_effort: effort } }
  if (provider === 'deepseek') return {
    effort,
    parameters: {
      thinking: { type: effort === 'none' ? 'disabled' : 'enabled' },
      ...(effort === 'none' ? {} : { reasoning_effort: effort }),
    },
  }
  // The configured local Qwen service uses llama.cpp's chat template switch.
  // DashScope's OpenAI-compatible endpoint takes enable_thinking at top level.
  const hostname = new URL(modelProviderConfig(provider, env).url || 'http://localhost').hostname
  const enabled = effort === 'enabled'
  return {
    effort,
    parameters: hostname.endsWith('.aliyuncs.com')
      ? { enable_thinking: enabled }
      : { chat_template_kwargs: { enable_thinking: enabled } },
  }
}
