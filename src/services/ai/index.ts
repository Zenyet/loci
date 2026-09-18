import type { AiSettings } from '../../types';
import type { Classifier } from './types';
import { ClaudeClassifier } from './claude';
import { OpenAICompatibleClassifier } from './openaiCompatible';

/** null = AI off / not configured → caller falls back to heuristic edges. */
export function makeClassifier(ai: AiSettings): Classifier | null {
  if (ai.provider === 'off' || !ai.apiKey) return null;
  if (ai.provider === 'anthropic') return new ClaudeClassifier({ apiKey: ai.apiKey, model: ai.model });
  if (ai.provider === 'custom') {
    if (!ai.baseUrl || !ai.model) return null;
    return new OpenAICompatibleClassifier({ apiKey: ai.apiKey, baseUrl: ai.baseUrl, model: ai.model });
  }
  // For other providers (openai/google/openrouter/cloudflare/groq), use OpenAI-compatible client with their baseUrl
  if (ai.baseUrl && ai.model) {
    return new OpenAICompatibleClassifier({ apiKey: ai.apiKey, baseUrl: ai.baseUrl, model: ai.model });
  }
  return null;
}

export type { Classifier } from './types';
