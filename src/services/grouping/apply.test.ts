import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyGrouping, undoLastGrouping } from './apply';
import { loadUndo } from './store';
import type { ApplyPlan } from './plan';

beforeEach(() => localStorage.clear());

function fakeDeps() {
  const calls: string[] = [];
  let n = 0;
  return {
    calls,
    deps: {
      createFolder: vi.fn(async (_p: string, name: string) => { calls.push(`create:${name}`); return `newf${++n}`; }),
      moveBookmark: vi.fn(async (id: string, dest: { parentId?: string }) => { calls.push(`move:${id}->${dest.parentId}`); }),
      removeFolder: vi.fn(async (id: string) => { calls.push(`remove:${id}`); }),
      now: () => 't',
    },
  };
}

const plan: ApplyPlan = {
  folders: [
    { key: 'g0', name: 'Dev', existingFolderId: 'folder1' },
    { key: 'g1', name: 'News' }, // new
  ],
  moves: [
    { id: 'a', toKey: 'g0', fromParentId: 'bar' },
    { id: 'b', toKey: 'g1', fromParentId: 'bar' },
  ],
  summary: { newFolders: 1, movedBookmarks: 2 },
};

describe('applyGrouping', () => {
  it('creates new folders, moves bookmarks, writes an undo journal', async () => {
    const { deps, calls } = fakeDeps();
    const summary = await applyGrouping(plan, 'bar', deps);
    expect(summary).toEqual({ newFolders: 1, movedBookmarks: 2 });
    expect(calls).toEqual(['create:News', 'move:a->folder1', 'move:b->newf1']);
    expect(await loadUndo()).toEqual({
      at: 't', createdFolderIds: ['newf1'],
      moved: [{ id: 'a', fromParentId: 'bar' }, { id: 'b', fromParentId: 'bar' }],
    });
  });

  it('rolls back moves + created folders when a move fails, then throws', async () => {
    const { deps } = fakeDeps();
    deps.moveBookmark = vi.fn()
      .mockImplementationOnce(async () => {}) // a ok
      .mockRejectedValueOnce(new Error('boom')); // b fails
    await expect(applyGrouping(plan, 'bar', deps)).rejects.toMatchObject({ kind: 'apply' });
    // a moved back to bar; created folder removed
    expect(deps.moveBookmark).toHaveBeenCalledWith('a', { parentId: 'bar' });
    expect(deps.removeFolder).toHaveBeenCalledWith('newf1');
    expect(await loadUndo()).toBeNull();
  });
});

describe('undoLastGrouping', () => {
  it('retains incomplete undo work so the user can retry instead of reporting false success', async () => {
    const { deps } = fakeDeps();
    await applyGrouping(plan, 'bar', deps);
    deps.moveBookmark.mockRejectedValueOnce(new Error('bookmark unavailable'));
    await expect(undoLastGrouping(deps)).rejects.toMatchObject({ kind: 'apply' });
    expect((await loadUndo())?.moved).toEqual([{ id: 'a', fromParentId: 'bar' }]);
    await expect(undoLastGrouping(deps)).resolves.toBe(true);
    expect(await loadUndo()).toBeNull();
  });
  it('reverses moves + removes created folders, then clears journal', async () => {
    const { deps, calls } = fakeDeps();
    await applyGrouping(plan, 'bar', deps);
    calls.length = 0;
    const ok = await undoLastGrouping(deps);
    expect(ok).toBe(true);
    expect(calls).toEqual(['move:a->bar', 'move:b->bar', 'remove:newf1']);
    expect(await loadUndo()).toBeNull();
  });
  it('returns false when no journal', async () => {
    const { deps } = fakeDeps();
    expect(await undoLastGrouping(deps)).toBe(false);
  });
});
