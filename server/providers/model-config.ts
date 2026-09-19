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
  if (provider === 'glm')
    return {
      label: 'GLM',
      apiKey: env.GLM_API_KEY,
      // GLM coding-plan keys are provisioned against this endpoint. Keep it
      // as the fallback so a key without an explicit URL does not get sent to
      // the standard balance endpoint, which returns 1113 for coding-plan
      // resources. GLM_API_URL still overrides this for standard API keys.
      url: env.GLM_API_URL || 'https://open.bigmodel.cn/api/coding/paas/v4',
      model: env.GLM_MODEL || 'glm-5.3-flash',
      piProvider: 'zai',
    }
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
      `${config.label} 未配置 ${provider === 'glm' ? 'GLM_API_KEY' : provider === 'gpt' ? 'GPT_API_KEY 或 GPT_API_URL' : provider === 'qwen' ? 'QWEN_API_KEY 或 QWEN_API_URL' : 'LLM_API_KEY 或 LLM_API_URL'}。`,
    )
  return config
}
