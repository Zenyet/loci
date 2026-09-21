import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Bookmark } from '../../types';
import { analyzeTopics } from './analyze';
import { loadAiHistory } from '../aiHistory';
import { cacheKey, loadTopicCache, saveTopicCache } from '../topicCache';
import { edgeId, saveEdges } from '../../designs/Graph/edges';

const bookmark = (id: string, visits = 0): Bookmark => ({ id, parentId: 'bar', name: id, url: `https://${id}.example/`, group: '', color: '', letter: '', visits, last: '' });
const key = (bookmark: Bookmark) => cacheKey({ id: bookmark.id, title: bookmark.name, url: bookmark.url });
const ai = { ...DEFAULT_SETTINGS.ai, provider: 'custom' as const, apiKey: 'test', model: 'test' };
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('topic analysis history', () => {
  it('logs cached and missing results plus real hub changes, excluding manual links', async () => {
    const nodes = [bookmark('a', 2), bookmark('b', 1), bookmark('c', 10), bookmark('d')];
    await saveTopicCache({ [key(nodes[0]!)]: { topics: ['dev'], at: 'old' }, [key(nodes[1]!)]: { topics: ['dev'], at: 'old' } });
    await saveEdges([{ id: edgeId('a', 'c'), from: 'a', to: 'c', kind: 'manual' }]);
    const classify = vi.fn().mockResolvedValue(new Map([['c', { topics: [' dev ', 'tools', 'dev'] }], ['invented', { topics: ['dev'] }]]));
    await analyzeTopics(nodes, ai, { classify });
    expect(classify.mock.calls[0]![0].map((site: { id: string }) => site.id)).toEqual(['c', 'd']);
    const history = (await loadAiHistory())[0]!;
    expect(history.status).toBe('partial');
    expect(history.analysis!.bookmarks.map(item => item.outcome)).toEqual(['cached', 'cached', 'classified', 'missing']);
    expect(history.analysis!.bookmarks[2]!.after).toEqual(['dev', 'tools']);
    expect(history.analysis!.edges).toEqual([
      { from: 'c', to: 'b', topic: 'dev', change: 'added' },
      { from: 'a', to: 'b', topic: 'dev', change: 'removed' },
    ]);
    expect(await loadTopicCache()).not.toHaveProperty(key(nodes[3]!));
  });

  it('records a cached no-op without a model request or claiming new assignments', async () => {
    const nodes = [bookmark('a'), bookmark('b')];
    await saveTopicCache(Object.fromEntries(nodes.map(item => [key(item), { topics: ['dev'], at: 'old' }])));
    const classify = vi.fn();
    const summary = await analyzeTopics(nodes, ai, { classify });
    expect(classify).not.toHaveBeenCalled();
    expect(summary).toContain('新分析 0 个，复用 2 个');
    expect((await loadAiHistory())[0]!.analysis!.edges[0]!.change).toBe('kept');
  });

  it('records a failed request without persisting upstream errors or changing topics', async () => {
    const classify = vi.fn().mockRejectedValue(new Error('API secret upstream response'));
    await expect(analyzeTopics([bookmark('a')], ai, { classify })).rejects.toThrow('主题分析未完成');
    const record = (await loadAiHistory())[0]!;
    expect(record.status).toBe('failed');
    expect(record.analysis!.bookmarks[0]).toMatchObject({ before: [], after: [], outcome: 'failed' });
    expect(JSON.stringify(record)).not.toContain('API secret');
    expect(await loadTopicCache()).toEqual({});
  });

  it('reports a topic cache write failure without claiming the new results were applied', async () => {
    const set = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, name: string, value: string) {
      if (name === 'newtab-topic-cache') throw new DOMException('quota');
      return set.call(this, name, value);
    });
    await expect(analyzeTopics([bookmark('a')], ai, { classify: vi.fn().mockResolvedValue(new Map([['a', { topics: ['dev'] }]])) })).rejects.toThrow();
    const record = (await loadAiHistory())[0]!;
    expect(record.status).toBe('failed');
    expect(record.analysis!.bookmarks[0]!.after).toEqual([]);
    expect(await loadTopicCache()).toEqual({});
  });
});
