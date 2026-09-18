import type { AiSettings } from '../../types';
import { makeClassifier } from './index';

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
}

const TIMEOUT_MS = 20_000;

function configurationError(ai: AiSettings): string | null {
  if (ai.provider === 'off') return '请先选择模型服务提供商。';
  if (!ai.apiKey.trim()) return '请先填写 API 密钥。';
  if (ai.provider === 'anthropic') return null;
  if (!ai.model.trim()) return '请先填写模型名称。';
  if (!ai.baseUrl.trim()) return '请先填写 API 地址。';
  try {
    const url = new URL(ai.baseUrl.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      return '请填写有效的 HTTP 或 HTTPS API 基础地址。';
    }
    if (/[{}]/.test(ai.baseUrl)) return 'API 地址中仍有占位符，请使用自定义端点填写完整地址。';
  } catch {
    return 'API 地址格式不正确，请填写完整地址。';
  }
  return null;
}

function requestError(error: unknown): string {
  // Never echo provider bodies: proxies can include credentials or request data.
  const status = (error as { status?: number } | null)?.status;
  if (status === 401) return '鉴权失败（401），请检查 API 密钥是否正确或已过期。';
  if (status === 403) return '访问被拒绝（403），请检查密钥的模型权限或服务地区限制。';
  if (status === 404) return '未找到接口或模型（404），请检查 API 地址与模型名称。';
  if (status === 429) return '请求受限（429），请检查账户额度，或稍后重试。';
  if (status === 408 || status === 504) return '服务响应超时，请稍后重试。';
  if (status && status >= 500) return `模型服务暂时不可用（${status}），请稍后重试。`;
  if (status && status >= 400) return `请求被拒绝（${status}），请检查模型名称及服务是否支持结构化输出。`;
  if (error instanceof SyntaxError) return '服务已响应，但返回格式不正确，请检查 API 地址与接口兼容性。';
  return '无法连接模型服务，请检查网络、API 地址及服务的跨域访问设置。';
}

/** Exercise the same model and structured response used by topic analysis,
 * using only a fixed example, never the user's bookmarks or cached topics. */
export async function testAiConnection(
  ai: AiSettings,
  options: { signal?: AbortSignal } = {},
): Promise<ConnectionTestResult> {
  const invalid = configurationError(ai);
  if (invalid) return { ok: false, message: invalid };
  const classifier = makeClassifier(ai);
  if (!classifier) return { ok: false, message: '模型服务配置不完整，请检查后重试。' };

  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, TIMEOUT_MS);
  const started = performance.now();
  try {
    controller.signal.throwIfAborted();
    const result = await classifier.classify(
      [{ id: 'connection-test', title: 'Connection test', host: 'example.com' }],
      { signal: controller.signal, maxRetries: 0 },
    );
    const topics = result.get('connection-test')?.topics;
    if (!Array.isArray(topics) || !topics.some(topic => typeof topic === 'string' && topic.trim())) {
      return { ok: false, message: '服务已响应，但未返回有效的测试结果，请检查模型的结构化输出支持。' };
    }
    return { ok: true, message: '连接成功，密钥与模型可用。', latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return {
      ok: false,
      message: timedOut ? '连接超时（20 秒），请检查网络与服务地址后重试。' : requestError(error),
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }
}
