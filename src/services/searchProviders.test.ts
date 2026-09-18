import { describe, expect, it } from 'vitest';
import { getSearchProvider, searchUrlForSettings, urlFromTemplate } from './searchProviders';
import { DEFAULT_SETTINGS } from '../types';

it('routes Baidu searches through wd and safely encodes Chinese and special characters', () => {
  const settings = { ...DEFAULT_SETTINGS, searchProvider: 'baidu' as const };
  expect(getSearchProvider(settings)).toMatchObject({ id: 'baidu', label: '百度', kind: 'search' });
  const url = new URL(searchUrlForSettings('书签整理 & AI + 工具/#', settings));
  expect(url.origin + url.pathname).toBe('https://www.baidu.com/s');
  expect([...url.searchParams]).toEqual([['wd', '书签整理 & AI + 工具/#']]);
  expect(url.hash).toBe('');
});

describe('urlFromTemplate', () => {
  it('replaces the {query} placeholder with an encoded query', () => {
    expect(
      urlFromTemplate('https://example.com/ask?q={query}', 'hello world')
    ).toBe('https://example.com/ask?q=hello%20world');
  });

  it('supports %s search templates', () => {
    expect(urlFromTemplate('https://example.com/search/%s', 'a/b')).toBe(
      'https://example.com/search/a%2Fb'
    );
  });

  it('adds q when the template has no placeholder', () => {
    expect(urlFromTemplate('https://example.com/search', 'new tab')).toBe(
      'https://example.com/search?q=new+tab'
    );
  });
});
