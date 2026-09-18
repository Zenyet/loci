import { describe, it, expect } from 'vitest';
import {
  selectScopedBookmarks, toProposal, applyMinGroupSize,
  moveMember, renameGroup, deleteGroup,
  buildApplyPlan, buildUndoPlan,
} from './plan';
import type { ChromeData, Group } from '../../types';

const bm = (id: string, parentId: string) =>
  ({ id, parentId, name: id, url: `https://${id}.com`, group: '', color: '', letter: id[0], visits: 0, last: '' });

const data: ChromeData = {
  bookmarks: [bm('a', 'bar'), bm('b', 'bar'), bm('c', 'folder1')],
  recents: [], groups: [{ id: 'folder1', label: 'Dev', parentGroupId: null, depth: 0 }],
  barId: 'bar', source: 'chrome',
};

describe('selectScopedBookmarks', () => {
  it('ungrouped → only bookmarks directly under barId', () => {
    expect(selectScopedBookmarks(data, 'ungrouped').map((b) => b.id)).toEqual(['a', 'b']);
  });
  it('all → every bookmark', () => {
    expect(selectScopedBookmarks(data, 'all').map((b) => b.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('toProposal', () => {
  const groups: Group[] = [{ id: 'folder1', label: 'Dev', parentGroupId: null, depth: 0 }];
  it('assigns stable keys, drops hallucinated ids, computes unassigned', () => {
    const p = toProposal(
      { groups: [{ name: 'Dev', memberIds: ['a', 'ghost'] }, { name: 'News', memberIds: ['b'] }], unassigned: [] },
      ['a', 'b', 'c'], groups, true,
    );
    expect(p.groups[0]).toMatchObject({ key: 'g0', name: 'Dev', existingFolderId: 'folder1', memberIds: ['a'] });
    expect(p.groups[1]).toMatchObject({ key: 'g1', name: 'News', memberIds: ['b'] });
    expect(p.groups[1].existingFolderId).toBeUndefined();
    expect(p.unassigned).toEqual(['c']); // c not covered by any group
  });
  it('does not resolve existing folder when reuseExisting=false', () => {
    const p = toProposal({ groups: [{ name: 'Dev', memberIds: ['a'] }], unassigned: [] }, ['a'], groups, false);
    expect(p.groups[0].existingFolderId).toBeUndefined();
  });
  it('id present in two raw groups is only kept in the first group and excluded from unassigned', () => {
    const p = toProposal(
      { groups: [{ name: 'Dev', memberIds: ['a'] }, { name: 'News', memberIds: ['a', 'b'] }], unassigned: [] },
      ['a', 'b'], groups, true,
    );
    expect(p.groups[0].memberIds).toEqual(['a']);
    expect(p.groups[1].memberIds).toEqual(['b']);
    expect(p.unassigned).toEqual([]);
  });
  it('drops a raw group whose only member id is not in inputIds', () => {
    const p = toProposal(
      { groups: [{ name: 'Dev', memberIds: ['a'] }, { name: 'Ghosts', memberIds: ['ghost'] }], unassigned: [] },
      ['a'], groups, true,
    );
    expect(p.groups.map((g) => g.name)).toEqual(['Dev']);
  });
  it('resolves existingFolderId when the group name differs only by case/whitespace', () => {
    const p = toProposal(
      { groups: [{ name: '  dev  ', memberIds: ['a'] }], unassigned: [] },
      ['a'], groups, true,
    );
    expect(p.groups[0].existingFolderId).toBe('folder1');
  });
});

describe('applyMinGroupSize', () => {
  it('folds groups smaller than minSize into a single "other" group', () => {
    const p = { groups: [
      { key: 'g0', name: 'Big', memberIds: ['a', 'b'] },
      { key: 'g1', name: 'Tiny', memberIds: ['c'] },
    ], unassigned: [] };
    const out = applyMinGroupSize(p, 2, '其他');
    expect(out.groups.map((g) => g.name)).toEqual(['Big', '其他']);
    expect(out.groups[1].memberIds).toEqual(['c']);
    expect(out.groups[1].key).toBe('other');
  });
  it('no-op when all groups meet minSize', () => {
    const p = { groups: [{ key: 'g0', name: 'Big', memberIds: ['a', 'b'] }], unassigned: [] };
    expect(applyMinGroupSize(p, 2, '其他')).toEqual(p);
  });
});

describe('reducers', () => {
  const p = {
    groups: [
      { key: 'g0', name: 'Work', memberIds: ['a', 'b'] },
      { key: 'g1', name: 'Play', memberIds: ['c'] },
    ],
    unassigned: ['d'],
  };
  it('moveMember → to existing group', () => {
    const out = moveMember(p, 'a', 'g1');
    expect(out.groups[0].memberIds).toEqual(['b']);
    expect(out.groups[1].memberIds).toEqual(['c', 'a']);
    expect(out.unassigned).toEqual(['d']);
  });
  it('moveMember → to null (unassigned)', () => {
    const out = moveMember(p, 'a', null);
    expect(out.groups[0].memberIds).toEqual(['b']);
    expect(out.unassigned).toEqual(['d', 'a']);
  });
  it('renameGroup', () => {
    const out = renameGroup(p, 'g0', 'Hobby');
    expect(out.groups[0].name).toBe('Hobby');
    expect(out.groups[1].name).toBe('Play');
  });
  it('renameGroup → clears existingFolderId so a new folder is created for the new name', () => {
    const withFolder = {
      groups: [
        { key: 'g0', name: 'Work', memberIds: ['a', 'b'], existingFolderId: 'folder1' },
        { key: 'g1', name: 'Play', memberIds: ['c'] },
      ],
      unassigned: ['d'],
    };
    const out = renameGroup(withFolder, 'g0', 'X');
    expect(out.groups[0]).toMatchObject({ key: 'g0', name: 'X', existingFolderId: undefined });
    expect(out.groups[1]).toEqual(withFolder.groups[1]);
  });
  it('deleteGroup → moves members to unassigned', () => {
    const out = deleteGroup(p, 'g0');
    expect(out.groups).toEqual([{ key: 'g1', name: 'Play', memberIds: ['c'] }]);
    expect(out.unassigned).toEqual(['d', 'a', 'b']);
  });
});

describe('buildApplyPlan', () => {
  const bms = [bm('a', 'bar'), bm('b', 'bar'), bm('c', 'folder1')];
  it('skips empty folders and bookmarks removed after generating the preview', () => {
    const plan = buildApplyPlan({ groups: [
      { key: 'empty', name: 'Empty', memberIds: [] },
      { key: 'gone', name: 'Gone', memberIds: ['deleted'] },
      { key: 'valid', name: 'Valid', memberIds: ['a', 'deleted'] },
    ], unassigned: [] }, bms);
    expect(plan.folders).toHaveLength(1);
    expect(plan.moves).toEqual([{ id: 'a', toKey: 'valid', fromParentId: 'bar' }]);
  });
  it('reuses existing folder, skips members already inside it, counts new folders', () => {
    const p = {
      groups: [
        { key: 'g0', name: 'Dev', existingFolderId: 'folder1', memberIds: ['a', 'c'] }, // c already in folder1 → skip
        { key: 'g1', name: 'News', memberIds: ['b'] },                                   // new folder
      ],
      unassigned: [],
    };
    const plan = buildApplyPlan(p, bms);
    expect(plan.summary).toEqual({ newFolders: 1, movedBookmarks: 2 });
    expect(plan.moves).toEqual([
      { id: 'a', toKey: 'g0', fromParentId: 'bar' },
      { id: 'b', toKey: 'g1', fromParentId: 'bar' },
    ]);
    expect(plan.folders).toEqual([
      { key: 'g0', name: 'Dev', existingFolderId: 'folder1' },
      { key: 'g1', name: 'News', existingFolderId: undefined },
    ]);
  });
});

describe('buildUndoPlan', () => {
  it('reverses moves and lists created folders for removal', () => {
    const plan = buildUndoPlan({
      at: 't',
      moved: [{ id: 'a', fromParentId: 'bar' }, { id: 'b', fromParentId: 'bar' }],
      createdFolderIds: ['newf'],
    });
    expect(plan.moves).toEqual([{ id: 'a', toParentId: 'bar' }, { id: 'b', toParentId: 'bar' }]);
    expect(plan.removeFolderIds).toEqual(['newf']);
  });
});
