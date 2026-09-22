import { expect, it } from 'vitest';
import type { Bookmark, Group } from '../types';
import { dailyBookmarkIndex, revisitBookmarks } from './revisit';

const groups: Group[] = [{ id: 'a', label: 'A', parentGroupId: null, depth: 0 }, { id: 'b', label: 'B', parentGroupId: 'a', depth: 1 }, { id: 'c', label: 'C', parentGroupId: null, depth: 0 }];
const bookmark = (id: string, parentId: string, url: string): Bookmark => ({ id, parentId, url, name: id, group: parentId, color: '', letter: id, visits: 0, last: '' });
it('includes descendants, excludes other folders and invalid links, and handles deleted folders', () => {
  const bookmarks = [bookmark('1', 'a', 'https://example.com'), bookmark('2', 'b', 'https://example.org'), bookmark('3', 'c', 'https://example.net'), bookmark('4', 'a', 'http://'), bookmark('5', 'a', 'javascript:alert(1)')];
  expect(revisitBookmarks(bookmarks, groups, 'a').map(b => b.id)).toEqual(['1', '2']);
  expect(revisitBookmarks(bookmarks, groups, 'removed')).toEqual([]);
  expect(revisitBookmarks(bookmarks, groups, '').map(b => b.id)).toEqual(['1', '2', '3']);
});
it('has a stable daily choice independent of time of day and keeps the candidate in bounds', () => {
  expect(dailyBookmarkIndex(new Date(2026, 8, 22, 1), 22)).toBe(dailyBookmarkIndex(new Date(2026, 8, 22, 23), 22));
  expect(dailyBookmarkIndex(new Date(), 0)).toBe(0);
  expect(dailyBookmarkIndex(new Date(), 22)).toBeLessThan(22);
});
