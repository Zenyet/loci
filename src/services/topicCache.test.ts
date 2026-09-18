import { describe, it, expect } from 'vitest';
import { cacheKey, sitesNeedingClassify, mergeTopics, type TopicCache } from './topicCache';

const site = (id: string, title: string, url: string) => ({ id, title, url });

describe('cacheKey', () => {
  it('is stable for same id+title+url and changes when any differs', () => {
    const a = cacheKey(site('1', 'GitHub', 'https://github.com'));
    expect(cacheKey(site('1', 'GitHub', 'https://github.com'))).toBe(a);
    expect(cacheKey(site('1', 'GitHub renamed', 'https://github.com'))).not.toBe(a);
    expect(cacheKey(site('1', 'GitHub', 'https://gitlab.com'))).not.toBe(a);
  });
});

describe('sitesNeedingClassify', () => {
  it('returns only sites whose cacheKey is absent from cache', () => {
    const cache: TopicCache = { [cacheKey(site('1', 'GitHub', 'https://github.com'))]: { topics: ['dev'], at: 't' } };
    const sites = [site('1', 'GitHub', 'https://github.com'), site('2', 'News', 'https://news.com')];
    const need = sitesNeedingClassify(sites, cache);
    expect(need.map((s) => s.id)).toEqual(['2']);
  });
});

describe('mergeTopics', () => {
  it('maps each site id to topics from cache (after results merged in)', () => {
    const s1 = site('1', 'GitHub', 'https://github.com');
    const cache: TopicCache = { [cacheKey(s1)]: { topics: ['dev'], at: 't' } };
    const map = mergeTopics([s1], cache);
    expect(map.get('1')).toEqual(['dev']);
    expect(map.has('2')).toBe(false);
  });
});
