import { hasChromeApi } from './chromeApi';

export interface CacheSite { id: string; title: string; url: string }
export interface TopicEntry { topics: string[]; at: string }
export type TopicCache = Record<string, TopicEntry>;

const TOPIC_CACHE_KEY = 'newtab-topic-cache';

/** Stable content hash of id+title+url (FNV-1a, base36). */
export function cacheKey(s: CacheSite): string {
  const str = `${s.id} ${s.title} ${s.url}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function sitesNeedingClassify(sites: CacheSite[], cache: TopicCache): CacheSite[] {
  return sites.filter((s) => !cache[cacheKey(s)]);
}

/** id → topics, for sites present in cache. */
export function mergeTopics(sites: CacheSite[], cache: TopicCache): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const s of sites) {
    const entry = cache[cacheKey(s)];
    if (entry) out.set(s.id, entry.topics);
  }
  return out;
}

export async function loadTopicCache(): Promise<TopicCache> {
  if (hasChromeApi && chrome.storage?.local) {
    const obj = await chrome.storage.local.get(TOPIC_CACHE_KEY);
    return (obj[TOPIC_CACHE_KEY] as TopicCache) ?? {};
  }
  try {
    const raw = localStorage.getItem(TOPIC_CACHE_KEY);
    return raw ? (JSON.parse(raw) as TopicCache) : {};
  } catch {
    return {};
  }
}

export async function saveTopicCache(cache: TopicCache): Promise<void> {
  if (hasChromeApi && chrome.storage?.local) {
    await chrome.storage.local.set({ [TOPIC_CACHE_KEY]: cache });
    return;
  }
  try {
    localStorage.setItem(TOPIC_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* noop */
  }
}
