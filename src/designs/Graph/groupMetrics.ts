import type { Bookmark, Group } from '../../types';

/** Count saved sites throughout each folder's subtree, excluding folders. */
export function countGroupBookmarks(bookmarks: Bookmark[], groups: Group[]): Map<string, number> {
  const parents = new Map(groups.map(group => [group.id, group.parentGroupId]));
  const counts = new Map(groups.map(group => [group.id, 0]));
  const direct = new Map<string, number>();
  for (const bookmark of bookmarks) {
    direct.set(bookmark.parentId, (direct.get(bookmark.parentId) ?? 0) + 1);
  }
  for (const [parentId, count] of direct) {
    let id: string | null = parentId;
    const visited = new Set<string>();
    while (id !== null && parents.has(id) && !visited.has(id)) {
      visited.add(id);
      counts.set(id, counts.get(id)! + count);
      id = parents.get(id) ?? null;
    }
  }
  return counts;
}
