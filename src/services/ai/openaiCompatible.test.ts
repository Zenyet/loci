import { describe, it, expect, vi } from 'vitest';
import { OpenAICompatibleClassifier } from './openaiCompatible';

describe('OpenAICompatibleClassifier', () => {
  it('posts to {baseUrl}/chat/completions and parses JSON content', async () => {
    const body = { choices: [{ message: { content: JSON.stringify({ items: [{ id: '1', topics: ['dev'] }] }) } }] };
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    const c = new OpenAICompatibleClassifier({
      apiKey: 'k', baseUrl: 'https://api.example.com/v1', model: 'm', fetchFn,
    });
    const out = await c.classify([{ id: '1', title: 'GitHub', host: 'github.com' }]);
    expect(out.get('1')).toEqual({ topics: ['dev'] });
    expect(fetchFn.mock.calls[0][0]).toBe('https://api.example.com/v1/chat/completions');
  });

  it('returns empty map without calling fetch when no sites', async () => {
    const fetchFn = vi.fn();
    const c = new OpenAICompatibleClassifier({ apiKey: 'k', baseUrl: 'u', model: 'm', fetchFn });
    expect((await c.classify([])).size).toBe(0);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
