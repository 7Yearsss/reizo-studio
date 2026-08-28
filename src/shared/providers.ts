export interface ProviderPreset {
  id: string;
  name: string;
  tag: string;
  baseUrl: string;
  defaultModel: string;
  models: { id: string; name: string }[];
  websiteUrl?: string;
  allowCustomBaseUrl?: boolean;
  /** Extra settings copy shown on the provider card. */
  description?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'reizo',
    name: 'Reizo (Winlume)',
    tag: 'Reizo',
    baseUrl: 'https://v2api.top/v1',
    defaultModel: 'gpt-5.4',
    description: '与网页 Studio 同一后端（new-api / v2api.top）。粘贴一个 new-api 令牌或网页 Studio 的虚拟密钥。',
    models: [
      { id: 'gpt-5.4', name: 'GPT-5.4' },
      { id: 'gpt-5.5', name: 'GPT-5.5' },
      { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
      { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna' },
      { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
      { id: 'gpt-5.3-codex-spark', name: 'GPT-5.3 Codex Spark' },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    tag: '模型官方',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    websiteUrl: 'https://platform.openai.com/api-keys',
    models: [
      { id: 'gpt-4o-mini', name: 'GPT-4o mini' },
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-4.1', name: 'GPT-4.1' },
      { id: 'o4-mini', name: 'o4-mini' },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    tag: '模型官方',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    websiteUrl: 'https://platform.deepseek.com',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat' },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
    ],
  },
  {
    id: 'moonshot',
    name: 'Moonshot AI',
    tag: '模型官方',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k2.5',
    websiteUrl: 'https://platform.moonshot.cn/console',
    models: [
      { id: 'kimi-k2.5', name: 'Kimi K2.5' },
      { id: 'moonshot-v1-auto', name: 'Moonshot Auto' },
      { id: 'kimi-latest', name: 'Kimi Latest' },
    ],
  },
  {
    id: 'zhipu',
    name: '智谱 AI',
    tag: '模型官方',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4.5',
    websiteUrl: 'https://bigmodel.cn/console/overview',
    models: [
      { id: 'glm-4.5', name: 'GLM-4.5' },
      { id: 'glm-4-flash', name: 'GLM-4 Flash' },
      { id: 'glm-4.5-flash', name: 'GLM-4.5 Flash' },
    ],
  },
  {
    id: 'siliconflow',
    name: '硅基流动',
    tag: '云服务商',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
    websiteUrl: 'https://cloud.siliconflow.cn',
    models: [
      { id: 'Qwen/Qwen2.5-7B-Instruct', name: 'Qwen2.5 7B Instruct' },
      { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3' },
      { id: 'Qwen/Qwen3-8B', name: 'Qwen3 8B' },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    tag: '聚合',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
    websiteUrl: 'https://openrouter.ai/keys',
    models: [
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini' },
      { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' },
      { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    ],
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    tag: '模型官方',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.0-flash',
    websiteUrl: 'https://aistudio.google.com/apikey',
    models: [
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
    ],
  },
  {
    id: 'custom',
    name: '自定义',
    tag: 'OpenAI 兼容',
    baseUrl: '',
    defaultModel: '',
    allowCustomBaseUrl: true,
    models: [],
  },
];

export function getProviderPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}
