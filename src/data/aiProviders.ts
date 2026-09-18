/**
 * AI Provider 和 Model 配置数据
 */

export interface ModelOption {
  id: string;
  name: string;
  /** 可选说明,如 "Fast, affordable" */
  description?: string;
}

export interface ProviderConfig {
  id: string;
  name: string;
  /** 该 provider 的官方 API 端点(自定义时留空) */
  baseUrl?: string;
  models: ModelOption[];
  /** 是否需要显示 Base URL 输入框(仅 custom 为 true) */
  customEndpoint?: boolean;
}

export const AI_PROVIDERS: ProviderConfig[] = [
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com/v1',
    models: [
      { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', description: 'Most capable' },
      { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', description: 'Balanced' },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', description: 'Fast, affordable' },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', description: 'Legacy' },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', description: 'Latest, multimodal' },
      { id: 'gpt-4o-mini', name: 'GPT-4o mini', description: 'Fast, affordable' },
      { id: 'o1', name: 'o1', description: 'Reasoning model' },
      { id: 'o1-mini', name: 'o1-mini', description: 'Reasoning, faster' },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
    ],
  },
  {
    id: 'google',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: [
      { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash', description: 'Latest, experimental' },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', description: '1M context' },
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', description: 'Fast' },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat', description: 'Latest' },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner (R1)', description: 'Reasoning model' },
    ],
  },
  {
    id: 'alibaba',
    name: '阿里云 Qwen (通义千问)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [
      { id: 'qwen-max', name: 'Qwen Max', description: '最强性能' },
      { id: 'qwen-plus', name: 'Qwen Plus', description: '均衡' },
      { id: 'qwen-turbo', name: 'Qwen Turbo', description: '快速响应' },
      { id: 'qwen-long', name: 'Qwen Long', description: '长文本' },
    ],
  },
  {
    id: 'moonshot',
    name: '月之暗面 Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: [
      { id: 'moonshot-v1-8k', name: 'Kimi 8K' },
      { id: 'moonshot-v1-32k', name: 'Kimi 32K' },
      { id: 'moonshot-v1-128k', name: 'Kimi 128K', description: '长文本' },
    ],
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: [
      { id: 'glm-4-plus', name: 'GLM-4 Plus', description: '最强性能' },
      { id: 'glm-4-0520', name: 'GLM-4', description: '高性能' },
      { id: 'glm-4-air', name: 'GLM-4 Air', description: '推理速度快' },
      { id: 'glm-4-flash', name: 'GLM-4 Flash', description: '极速' },
    ],
  },
  {
    id: 'baichuan',
    name: '百川智能',
    baseUrl: 'https://api.baichuan-ai.com/v1',
    models: [
      { id: 'Baichuan4', name: 'Baichuan 4', description: '最新旗舰' },
      { id: 'Baichuan3-Turbo', name: 'Baichuan 3 Turbo' },
    ],
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    baseUrl: 'https://api.minimax.chat/v1',
    models: [
      { id: 'abab6.5s-chat', name: 'abab6.5s', description: '快速' },
      { id: 'abab6.5-chat', name: 'abab6.5', description: '高性能' },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [
      { id: 'anthropic/claude-opus-4-8', name: 'Claude Opus 4.8 (via OpenRouter)' },
      { id: 'openai/gpt-4o', name: 'GPT-4o (via OpenRouter)' },
      { id: 'google/gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash (via OpenRouter)' },
      { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' },
      { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat (via OpenRouter)' },
    ],
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare Workers AI',
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1',
    models: [
      { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', name: 'Llama 3.3 70B' },
      { id: '@cf/qwen/qwen2.5-72b-instruct', name: 'Qwen 2.5 72B' },
      { id: '@cf/deepseek-ai/deepseek-v3', name: 'DeepSeek V3' },
    ],
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B' },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', description: 'Fast' },
      { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B' },
    ],
  },
  {
    id: 'custom',
    name: '自定义端点',
    customEndpoint: true,
    models: [
      { id: '', name: '手动输入模型名称' },
    ],
  },
];

/** 根据 provider ID 查找配置 */
export function getProviderConfig(providerId: string): ProviderConfig | undefined {
  return AI_PROVIDERS.find((p) => p.id === providerId);
}

/** 根据 provider + model 判断是否是有效组合 */
export function isValidProviderModel(providerId: string, modelId: string): boolean {
  const provider = getProviderConfig(providerId);
  if (!provider) return false;
  if (provider.customEndpoint) return true; // 自定义端点允许任意 model
  return provider.models.some((m) => m.id === modelId);
}
