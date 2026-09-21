import type { AiSettings, Bookmark } from '../../types';
import type { Classifier } from './types';
import { cacheKey, loadTopicCache, mergeTopics, saveTopicCache, sitesNeedingClassify, type TopicCache } from '../topicCache';
import { loadEdges } from '../../designs/Graph/edges';
import { computeTopicEdges } from '../../designs/Graph/topicEdges';
import { hostOf } from '../../designs/Graph/relationSuggest';
import { snapshotBookmark, startAiHistory, type HistoryAnalysis } from '../aiHistory';
import { withLocalLock } from '../localStore';

/** Persist the exact topic assignments and a reproducible global relationship snapshot. */
export async function analyzeTopics(bookmarks: Bookmark[], ai: AiSettings, classifier: Classifier): Promise<string> {
  const history = startAiHistory('analysis', ai, '全部书签', bookmarks.length);
  return withLocalLock('topic-analysis', async () => {
    const sites = bookmarks.map(bookmark => ({ id: bookmark.id, title: bookmark.name, url: bookmark.url }));
    let before: TopicCache = {};
    let detail: HistoryAnalysis | undefined;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      before = await loadTopicCache();
      const cache = structuredClone(before);
      const need = sitesNeedingClassify(sites, before);
      const requested = new Set(need.map(site => site.id));
      detail = {
        requested: need.length, reused: sites.length - need.length, edges: [],
        bookmarks: bookmarks.map((bookmark, index) => ({ ...snapshotBookmark(bookmark),
          before: [...(before[cacheKey(sites[index]!)]?.topics ?? [])],
          after: [...(before[cacheKey(sites[index]!)]?.topics ?? [])],
          outcome: requested.has(bookmark.id) ? 'failed' : 'cached',
        })),
      };
      history.record.analysis = detail;
      const manualEdges = await loadEdges();
      if (need.length) {
        const controller = new AbortController();
        timer = setTimeout(() => { timedOut = true; controller.abort(); }, 90_000);
        const result = await classifier.classify(need.map(site => ({ id: site.id, title: site.title, host: hostOf(site.url) ?? '' })), { signal: controller.signal, maxRetries: 0 });
        controller.signal.throwIfAborted();
        const now = new Date().toISOString();
        for (const site of need) {
          const raw = result.get(site.id)?.topics;
          const topics = Array.isArray(raw) ? [...new Set(raw.filter((topic): topic is string => typeof topic === 'string').map(topic => topic.trim()).filter(Boolean))].slice(0, 3) : [];
          if (topics.length) cache[cacheKey(site)] = { topics, at: now };
        }
        await saveTopicCache(cache);
      }
      const previousTopics = mergeTopics(sites, before);
      const nextTopics = mergeTopics(sites, cache);
      const oldEdges = computeTopicEdges(bookmarks, previousTopics, manualEdges);
      const newEdges = computeTopicEdges(bookmarks, nextTopics, manualEdges);
      const edgeKey = (edge: { id: string; from: string }, topics: Map<string, string[]>) => `${edge.id}\u0000${topics.get(edge.from)?.[0] ?? ''}`;
      const oldKeys = new Set(oldEdges.map(edge => edgeKey(edge, previousTopics)));
      const newKeys = new Set(newEdges.map(edge => edgeKey(edge, nextTopics)));
      detail.edges = [
        ...newEdges.map(edge => ({ from: edge.from, to: edge.to, topic: nextTopics.get(edge.from)?.[0] ?? '', change: oldKeys.has(edgeKey(edge, nextTopics)) ? 'kept' as const : 'added' as const })),
        ...oldEdges.filter(edge => !newKeys.has(edgeKey(edge, previousTopics))).map(edge => ({ from: edge.from, to: edge.to, topic: previousTopics.get(edge.from)?.[0] ?? '', change: 'removed' as const })),
      ];
      for (const item of detail.bookmarks) {
        item.after = [...(nextTopics.get(item.id) ?? [])];
        if (requested.has(item.id)) item.outcome = item.after.length ? 'classified' : 'missing';
      }
      const missing = detail.bookmarks.filter(item => item.outcome === 'missing').length;
      const added = detail.edges.filter(edge => edge.change === 'added').length;
      const summary = `新分析 ${need.length - missing} 个，复用 ${detail.reused} 个已有结果；主题连线新增 ${added} 条，移除 ${detail.edges.filter(edge => edge.change === 'removed').length} 条。${missing ? ` ${missing} 个书签未返回有效主题，可再次分析。` : ''}`;
      await history.finish(missing ? 'partial' : 'success', summary);
      return summary;
    } catch {
      const message = timedOut ? '主题分析超时，请稍后重试。' : '主题分析未完成，请检查网络、模型服务和本地存储后重试。';
      await history.finish('failed', `${message} 未写入新的主题结果。`);
      throw new Error(message);
    } finally { if (timer) clearTimeout(timer); }
  });
}
