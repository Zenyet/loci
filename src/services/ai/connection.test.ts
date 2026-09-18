import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiSettings } from '../../types';
import { testAiConnection } from './connection';

const ai: AiSettings = { provider: 'custom', apiKey: 'test-key', model: 'test-model', baseUrl: 'https://api.example.com/v1/' };
const content = JSON.stringify({ items: [{ id: 'connection-test', topics: ['test'] }] });
const response = () => new Response(JSON.stringify({ choices: [{ message: { content } }] }));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('model connection check', () => {
  it('tests the configured model with a fixed sample and returns latency', async () => {
    const fetchFn = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchFn);
    expect(await testAiConnection(ai)).toEqual({ ok: true, message: expect.stringContaining('连接成功'), latencyMs: expect.any(Number) });
    const [url, request] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect(request.headers.authorization).toBe('Bearer test-key');
    expect(JSON.parse(request.body)).toMatchObject({ model: 'test-model', response_format: { type: 'json_object' } });
    expect(JSON.parse(request.body).messages[1].content).toBe('Classify:\n[{"id":"connection-test","title":"Connection test","host":"example.com"}]');
    expect(request.signal).toBeInstanceOf(AbortSignal);
  });

  it('uses the native Anthropic API and verifies its structured output', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-test',
      content: [{ type: 'text', text: content }], stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    }), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchFn);
    expect((await testAiConnection({ ...ai, provider: 'anthropic', model: 'claude-test' })).ok).toBe(true);
    expect(String(fetchFn.mock.calls[0][0])).toBe('https://api.anthropic.com/v1/messages');
  });

  it('uses the Gemini OpenAI compatibility route', async () => {
    const fetchFn = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchFn);
    expect((await testAiConnection({ ...ai, provider: 'google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' })).ok).toBe(true);
    expect(fetchFn.mock.calls[0][0]).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  });

  it.each([
    [{ provider: 'off' }, '提供商'], [{ apiKey: ' ' }, '密钥'], [{ model: '' }, '模型'],
    [{ baseUrl: '' }, '地址'], [{ baseUrl: 'not a url' }, '格式'],
    [{ baseUrl: 'file:///etc/test' }, 'HTTP'],
    [{ baseUrl: 'https://api.example.com/{account_id}/v1' }, '占位符'],
  ] as [Partial<AiSettings>, string][])('validates configuration before requesting: %j', async (patch, message) => {
    const fetchFn = vi.fn(); vi.stubGlobal('fetch', fetchFn);
    expect(await testAiConnection({ ...ai, ...patch })).toEqual({ ok: false, message: expect.stringContaining(message) });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([[400, '请求被拒绝'], [401, '鉴权失败'], [403, '访问被拒绝'], [404, '未找到'], [429, '额度'], [503, '暂时不可用']])('explains HTTP %i without exposing response bodies', async (status, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('sensitive-proxy-output', { status })));
    expect(await testAiConnection(ai)).toEqual({ ok: false, message: expect.stringContaining(message) });
  });

  it('rejects empty or malformed successful responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [] }))));
    expect(await testAiConnection(ai)).toMatchObject({ ok: false, message: expect.stringContaining('有效的测试结果') });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>not an API</html>')));
    expect(await testAiConnection(ai)).toMatchObject({ ok: false, message: expect.stringContaining('返回格式') });
  });

  it('explains network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await testAiConnection(ai)).toMatchObject({ ok: false, message: expect.stringContaining('网络') });
  });

  it('aborts a slow request after 20 seconds and reports the timeout', async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    vi.stubGlobal('fetch', fetchFn);
    const pending = testAiConnection(ai);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await pending).toMatchObject({ ok: false, message: expect.stringContaining('20 秒') });
    expect(fetchFn.mock.calls[0][1].signal!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honors cancellation before sending any request', async () => {
    const fetchFn = vi.fn(); vi.stubGlobal('fetch', fetchFn);
    const controller = new AbortController(); controller.abort();
    await expect(testAiConnection(ai, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
