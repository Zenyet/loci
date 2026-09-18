import type { Bookmark, ChromeData, Group, GroupProposal, GroupScope, GroupingUndo, ProposedGroup } from '../../types';

/**
 * Select bookmarks within the given scope.
 * - 'ungrouped': only bookmarks directly under the bookmarks bar root (barId)
 * - 'all': all bookmarks
 */
export function selectScopedBookmarks(data: ChromeData, scope: GroupScope): typeof data.bookmarks {
  if (scope === 'all') {
    return data.bookmarks;
  }
  // scope === 'ungrouped'
  return data.bookmarks.filter((b) => b.parentId === data.barId);
}

/**
 * Convert raw AI output (groups + unassigned ids) into a GroupProposal.
 * - Assigns stable keys (g0, g1, ...)
 * - Filters out hallucinated member ids not in inputIds
 * - Resolves existing folders by name if reuseExisting is true
 * - Computes final unassigned list
 */
export function toProposal(
  raw: { groups: { name: string; memberIds: string[] }[]; unassigned: string[] },
  inputIds: string[],
  groups: Group[],
  reuseExisting: boolean,
): GroupProposal {
  const valid = new Set(inputIds);
  const byName = new Map(groups.map((g) => [g.label.trim().toLowerCase(), g.id] as const));
  const covered = new Set<string>();

  const proposedGroups: ProposedGroup[] = raw.groups
    .map((g, index) => {
      const memberIds = [...new Set(g.memberIds)].filter((id) => valid.has(id) && !covered.has(id));
      memberIds.forEach((id) => covered.add(id));
      const existingFolderId = reuseExisting ? byName.get(g.name.trim().toLowerCase()) : undefined;
      return { key: `g${index}`, name: g.name.trim(), existingFolderId, memberIds };
    })
    .filter((g) => g.memberIds.length > 0);

  // Compute unassigned: all inputIds not assigned to any group
  const unassigned = inputIds.filter((id) => !covered.has(id));

  return {
    groups: proposedGroups,
    unassigned,
  };
}

/**
 * Apply minimum group size constraint.
 * Groups smaller than minSize are merged into a single "other" group with key 'other'.
 */
export function applyMinGroupSize(
  p: GroupProposal,
  minSize: number,
  otherName: string,
): GroupProposal {
  const keepers = p.groups.filter((g) => g.memberIds.length >= minSize);
  const small = p.groups.filter((g) => g.memberIds.length < minSize);

  if (small.length === 0) {
    return p; // no-op
  }

  const otherMembers = small.flatMap((g) => g.memberIds);
  const otherGroup: ProposedGroup = {
    key: 'other',
    name: otherName,
    memberIds: otherMembers,
  };

  return {
    groups: [...keepers, otherGroup],
    unassigned: p.unassigned,
  };
}

/**
 * Helper: remove a member from all groups and unassigned.
 */
function withoutMember(p: GroupProposal, memberId: string): GroupProposal {
  return {
    groups: p.groups.map((g) => ({
      ...g,
      memberIds: g.memberIds.filter((id) => id !== memberId),
    })),
    unassigned: p.unassigned.filter((id) => id !== memberId),
  };
}

/**
 * Move a member to a different group or unassigned (toKey = null).
 */
export function moveMember(
  p: GroupProposal,
  memberId: string,
  toKey: string | null,
): GroupProposal {
  const cleared = withoutMember(p, memberId);
  if (toKey === null) {
    return { ...cleared, unassigned: [...cleared.unassigned, memberId] };
  }
  return {
    ...cleared,
    groups: cleared.groups.map((g) => (g.key === toKey ? { ...g, memberIds: [...g.memberIds, memberId] } : g)),
  };
}

/**
 * Rename a group by key.
 */
export function renameGroup(p: GroupProposal, key: string, name: string): GroupProposal {
  return {
    ...p,
    groups: p.groups.map((g) =>
      g.key === key ? { ...g, name, existingFolderId: undefined } : g
    ),
  };
}

/**
 * Delete a group by key, moving its members to unassigned.
 */
export function deleteGroup(p: GroupProposal, key: string): GroupProposal {
  const target = p.groups.find((g) => g.key === key);
  if (!target) {
    return p;
  }
  return {
    groups: p.groups.filter((g) => g.key !== key),
    unassigned: [...p.unassigned, ...target.memberIds],
  };
}

export interface ApplyPlan {
  folders: { key: string; name: string; existingFolderId?: string }[];
  moves: { id: string; toKey: string; fromParentId: string }[];
  summary: { newFolders: number; movedBookmarks: number };
}

export function buildApplyPlan(p: GroupProposal, bookmarks: Bookmark[]): ApplyPlan {
  const parentById = new Map(bookmarks.map((b) => [b.id, b.parentId] as const));
  const activeGroups = p.groups.filter(g => g.memberIds.some(id => parentById.has(id)));
  const folders = activeGroups.map((g) => ({ key: g.key, name: g.name, existingFolderId: g.existingFolderId }));
  const moves: ApplyPlan['moves'] = [];
  for (const g of activeGroups) {
    for (const id of g.memberIds) {
      const fromParentId = parentById.get(id);
      if (fromParentId === undefined) continue;
      if (g.existingFolderId && fromParentId === g.existingFolderId) continue; // already inside
      moves.push({ id, toKey: g.key, fromParentId });
    }
  }
  return {
    folders,
    moves,
    summary: { newFolders: folders.filter((f) => !f.existingFolderId).length, movedBookmarks: moves.length },
  };
}

export function buildUndoPlan(u: GroupingUndo): { moves: { id: string; toParentId: string }[]; removeFolderIds: string[] } {
  return {
    moves: u.moved.map((m) => ({ id: m.id, toParentId: m.fromParentId })),
    removeFolderIds: u.createdFolderIds,
  };
}
