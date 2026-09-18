import { describe, it, expect, vi } from 'vitest';
import { OpenAICompatibleGrouper, makeGrouper } from './grouping';
import type { GroupingConfig } from '../../types';

const cfg: GroupingConfig = {
  granularity: 'balanced', minGroupSize: 2, nameLanguage: 'auto', scope: 'ungrouped', reuseExisting: true,
};

describe('OpenAICompatibleGrouper', () => {
  it('passes cancellation through to the network request', async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn((_url: URL | RequestInfo, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const g = new OpenAICompatibleGrouper({ apiKey: 'k', baseUrl: 'https://example.com/v1', model: 'm', config: cfg, fetchFn });
    const pending = g.group([{ id: '1', title: 'x', host: 'x.com' }], [], { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchFn.mock.calls[0][1]?.signal).toBe(controller.signal);
  });

  it('reports malformed model output instead of producing a misleading empty preview', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '{"groups":"invalid"}' } }] }) });
    const g = new OpenAICompatibleGrouper({ apiKey: 'k', baseUrl: 'https://example.com/v1', model: 'm', config: cfg, fetchFn });
    await expect(g.group([{ id: '1', title: 'x', host: 'x.com' }], [])).rejects.toMatchObject({ kind: 'parse' });
  });
  it('posts to {baseUrl}/chat/completions and parses JSON content', async () => {
    const body = { choices: [{ message: { content: JSON.stringify({ groups: [{ name: 'Dev', memberIds: ['1'] }], unassigned: [] }) } }] };
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    const g = new OpenAICompatibleGrouper({ apiKey: 'k', baseUrl: 'https://api.example.com/v1', model: 'm', config: cfg, fetchFn });
    const out = await g.group([{ id: '1', title: 'GitHub', host: 'github.com' }], ['Dev']);
    expect(out.groups).toEqual([{ name: 'Dev', memberIds: ['1'] }]);
    expect(fetchFn.mock.calls[0][0]).toBe('https://api.example.com/v1/chat/completions');
  });

  it('throws typed auth error on 401', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const g = new OpenAICompatibleGrouper({ apiKey: 'k', baseUrl: 'u', model: 'm', config: cfg, fetchFn });
    await expect(g.group([{ id: '1', title: 'x', host: 'x.com' }], [])).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('makeGrouper openai-compatible', () => {
  it('returns null when baseUrl or model missing', () => {
    expect(makeGrouper({ provider: 'custom', apiKey: 'k', baseUrl: '', model: '' }, cfg)).toBeNull();
  });
  it('returns an OpenAICompatibleGrouper when fully configured', () => {
    expect(makeGrouper({ provider: 'custom', apiKey: 'k', baseUrl: 'u', model: 'm' }, cfg))
      .toBeInstanceOf(OpenAICompatibleGrouper);
  });
});
