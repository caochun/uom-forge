import type { ProviderId } from '../../shared/analysis.ts'

export interface ModelProviderConfig {
  label: string
  apiKey?: string
  url?: string
  model: string
  piProvider: string
}

/** Resolve the environment-backed configuration used by Pi's OpenAI adapter. */
export function modelProviderConfig(
  provider: ProviderId,
  env: NodeJS.ProcessEnv = process.env,
): ModelProviderConfig {
  if (provider === 'gpt')
    return {
      label: 'GPT',
      apiKey: env.GPT_API_KEY,
      url: env.GPT_API_URL,
      model: env.GPT_MODEL || 'gpt-6-astra',
      piProvider: 'openai',
    }
  if (provider === 'qwen')
    return {
      label: 'Qwen',
      apiKey: env.QWEN_API_KEY,
      url: env.QWEN_API_URL,
      model: env.QWEN_MODEL || 'Qwen3.6',
      piProvider: 'qwen',
    }
  return {
    label: 'DeepSeek',
    apiKey: env.LLM_API_KEY,
    url: env.LLM_API_URL,
    model: env.LLM_MODEL || 'deepseek-chat',
    piProvider: 'deepseek',
  }
}

export function requireModelProviderConfig(
  provider: ProviderId,
  env: NodeJS.ProcessEnv = process.env,
): ModelProviderConfig {
  const config = modelProviderConfig(provider, env)
  if (!config.apiKey || !config.url)
    throw new Error(
      `${config.label} 未配置 ${provider === 'gpt' ? 'GPT_API_KEY 或 GPT_API_URL' : provider === 'qwen' ? 'QWEN_API_KEY 或 QWEN_API_URL' : 'LLM_API_KEY 或 LLM_API_URL'}。`,
    )
  return config
}
