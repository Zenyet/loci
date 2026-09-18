import { describe, expect, it } from 'vitest';
import type { Bookmark, Group } from '../../types';
import { countGroupBookmarks } from './groupMetrics';

const groups: Group[] = [
  { id: 'work', label: '工作', parentGroupId: null, depth: 0 },
  { id: 'design', label: '设计', parentGroupId: 'work', depth: 1 },
  { id: 'tools', label: '工具', parentGroupId: 'design', depth: 2 },
  { id: 'empty', label: '空分组', parentGroupId: 'work', depth: 1 },
];
const bookmark = (id: string, parentId: string): Bookmark => ({
  id, parentId, name: id, url: `https://${id}.example`, group: '', color: '', letter: '', visits: 0, last: '',
});

describe('group site counts', () => {
  it('counts sites across nested folders without counting folders or loose bookmarks', () => {
    const counts = countGroupBookmarks([
      bookmark('a', 'work'), bookmark('b', 'design'), bookmark('c', 'tools'), bookmark('d', 'bar'),
    ], groups);
    expect(Object.fromEntries(counts)).toEqual({ work: 3, design: 2, tools: 1, empty: 0 });
  });

  it('reflects moved and deleted bookmarks without stale totals', () => {
    const bookmarks = [bookmark('a', 'tools'), bookmark('b', 'tools')];
    expect(countGroupBookmarks(bookmarks, groups).get('work')).toBe(2);
    bookmarks[0].parentId = 'bar';
    bookmarks.pop();
    expect(Object.fromEntries(countGroupBookmarks(bookmarks, groups))).toEqual({ work: 0, design: 0, tools: 0, empty: 0 });
  });

  it('terminates on a malformed folder cycle without counting a site twice', () => {
    const cyclic = groups.map(group => group.id === 'work' ? { ...group, parentGroupId: 'tools' } : group);
    const counts = countGroupBookmarks([bookmark('a', 'tools')], cyclic);
    expect(counts.get('work')).toBe(1);
    expect(counts.get('tools')).toBe(1);
  });
});
