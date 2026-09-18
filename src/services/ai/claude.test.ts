import { describe, it, expect, vi } from 'vitest';
import { ClaudeClassifier } from './claude';

describe('ClaudeClassifier', () => {
  it('sends only title+host and maps parsed_output back to id→topics', async () => {
    const parse = vi.fn().mockResolvedValue({
      parsed_output: { items: [{ id: '1', topics: ['dev'] }, { id: '2', topics: ['news'] }] },
    });
    const fakeClient = { messages: { parse } } as never;
    const c = new ClaudeClassifier({ apiKey: 'k', model: 'claude-opus-4-8', createClient: () => fakeClient });

    const out = await c.classify([
      { id: '1', title: 'GitHub', host: 'github.com' },
      { id: '2', title: 'Hacker News', host: 'news.ycombinator.com' },
    ]);

    expect(out.get('1')).toEqual({ topics: ['dev'] });
    expect(out.get('2')).toEqual({ topics: ['news'] });
    const call = parse.mock.calls[0][0] as { messages: Array<{ content: string }> };
    const userMsg = call.messages[0]!.content;
    expect(userMsg).toContain('github.com');
    expect(userMsg).not.toContain('https://');
    expect(userMsg).not.toContain('"url"');
  });

  it('returns an empty map for no sites without calling the API', async () => {
    const parse = vi.fn();
    const c = new ClaudeClassifier({ apiKey: 'k', createClient: () => ({ messages: { parse } } as never) });
    expect((await c.classify([])).size).toBe(0);
    expect(parse).not.toHaveBeenCalled();
  });
});
