import { describe, it, expect, vi } from 'vitest';
import { ClaudeGrouper, groupingSystemPrompt, makeGrouper } from './grouping';
import type { GroupingConfig } from '../../types';

const cfg: GroupingConfig = {
  granularity: 'coarse', minGroupSize: 2, nameLanguage: 'zh', scope: 'ungrouped', reuseExisting: true,
};

describe('groupingSystemPrompt', () => {
  it('encodes granularity + language into the prompt', () => {
    const p = groupingSystemPrompt(cfg);
    expect(p).toContain('中文');       // nameLanguage zh
    expect(p.toLowerCase()).toContain('fewer'); // coarse hint
  });
});

describe('ClaudeGrouper', () => {
  it('sends title+host+existing groups and maps parsed_output', async () => {
    const parse = vi.fn().mockResolvedValue({
      parsed_output: { groups: [{ name: '开发', memberIds: ['1'] }], unassigned: ['2'] },
    });
    const g = new ClaudeGrouper({ apiKey: 'k', config: cfg, createClient: () => ({ messages: { parse } } as never) });
    const out = await g.group(
      [{ id: '1', title: 'GitHub', host: 'github.com' }, { id: '2', title: 'News', host: 'news.com' }],
      ['Dev'],
    );
    expect(out.groups).toEqual([{ name: '开发', memberIds: ['1'] }]);
    expect(out.unassigned).toEqual(['2']);
    const userMsg = (parse.mock.calls[0][0] as { messages: { content: string }[] }).messages[0].content;
    expect(userMsg).toContain('github.com');
    expect(userMsg).toContain('Dev');       // existing groups passed as context
    expect(userMsg).not.toContain('https://');
  });

  it('returns empty proposal without calling API when no inputs', async () => {
    const parse = vi.fn();
    const g = new ClaudeGrouper({ apiKey: 'k', config: cfg, createClient: () => ({ messages: { parse } } as never) });
    expect(await g.group([], [])).toEqual({ groups: [], unassigned: [] });
    expect(parse).not.toHaveBeenCalled();
  });

  const oneInput = [{ id: '1', title: 'x', host: 'x.com' }];

  it('rejects with kind "parse" when parsed_output is null', async () => {
    const parse = vi.fn().mockResolvedValue({ parsed_output: null });
    const g = new ClaudeGrouper({ apiKey: 'k', config: cfg, createClient: () => ({ messages: { parse } } as never) });
    await expect(g.group(oneInput, [])).rejects.toMatchObject({ kind: 'parse' });
  });

  it('rejects with kind "auth" on a 401 status error', async () => {
    const parse = vi.fn().mockRejectedValue({ status: 401 });
    const g = new ClaudeGrouper({ apiKey: 'k', config: cfg, createClient: () => ({ messages: { parse } } as never) });
    await expect(g.group(oneInput, [])).rejects.toMatchObject({ kind: 'auth' });
  });

  it('rejects with kind "rate_limit" on a 429 status error', async () => {
    const parse = vi.fn().mockRejectedValue({ status: 429 });
    const g = new ClaudeGrouper({ apiKey: 'k', config: cfg, createClient: () => ({ messages: { parse } } as never) });
    await expect(g.group(oneInput, [])).rejects.toMatchObject({ kind: 'rate_limit' });
  });

  it('rejects with kind "network" on a plain error with no status', async () => {
    const parse = vi.fn().mockRejectedValue(new Error('boom'));
    const g = new ClaudeGrouper({ apiKey: 'k', config: cfg, createClient: () => ({ messages: { parse } } as never) });
    await expect(g.group(oneInput, [])).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('makeGrouper', () => {
  it('returns null when provider off or key missing', () => {
    expect(makeGrouper({ provider: 'off', apiKey: '', baseUrl: '', model: '' }, cfg)).toBeNull();
    expect(makeGrouper({ provider: 'anthropic', apiKey: '', baseUrl: '', model: '' }, cfg)).toBeNull();
  });
  it('returns a ClaudeGrouper for claude+key', () => {
    expect(makeGrouper({ provider: 'anthropic', apiKey: 'k', baseUrl: '', model: '' }, cfg)).toBeInstanceOf(ClaudeGrouper);
  });
});
