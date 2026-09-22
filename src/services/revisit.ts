import type { Bookmark, Group } from '../types';
export function revisitBookmarks(bookmarks: Bookmark[], groups: Group[], folderId: string): Bookmark[] {
  const folders = new Set(folderId ? [folderId] : groups.map(group => group.id));
  if (folderId && !groups.some(group => group.id === folderId)) return [];
  for (let changed = true; changed;) {
    changed = false;
    for (const group of groups) if (group.parentGroupId && folders.has(group.parentGroupId) && !folders.has(group.id)) { folders.add(group.id); changed = true; }
  }
  return bookmarks.filter(bookmark => {
    if (folderId && !folders.has(bookmark.parentId)) return false;
    try { return ['https:', 'http:'].includes(new URL(bookmark.url).protocol); } catch { return false; }
  }).sort((a, b) => a.id.localeCompare(b.id));
}
export function dailyBookmarkIndex(date: Date, count: number) {
  if (!count) return 0;
  const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % count;
}
