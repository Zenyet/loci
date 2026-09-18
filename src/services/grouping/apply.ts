// removeEmptyFolder (non-recursive) is used for undo/rollback so that a folder
// left non-empty by a failed best-effort move-back throws and is preserved,
// instead of removeFolder's removeTree silently deleting a stranded bookmark.
import { createFolder as realCreateFolder, moveBookmark as realMoveBookmark, removeEmptyFolder as realRemoveFolder } from '../chromeApi';
import { buildUndoPlan, type ApplyPlan } from './plan';
import { loadUndo, saveUndo, clearUndo } from './store';
import { GroupingError } from './errors';
import type { GroupingUndo } from '../../types';

export interface ApplyDeps {
  createFolder: (parentId: string, title: string) => Promise<string>;
  moveBookmark: (id: string, dest: { parentId?: string; index?: number }) => Promise<void>;
  removeFolder: (id: string) => Promise<void>;
  now: () => string;
}

function resolve(deps?: Partial<ApplyDeps>): ApplyDeps {
  return {
    createFolder: deps?.createFolder ?? realCreateFolder,
    moveBookmark: deps?.moveBookmark ?? realMoveBookmark,
    removeFolder: deps?.removeFolder ?? realRemoveFolder,
    now: deps?.now ?? (() => new Date().toISOString()),
  };
}

export async function applyGrouping(
  plan: ApplyPlan,
  barId: string,
  depsIn?: Partial<ApplyDeps>,
): Promise<{ newFolders: number; movedBookmarks: number }> {
  const deps = resolve(depsIn);
  const keyToId = new Map<string, string>();
  const createdFolderIds: string[] = [];
  const moved: GroupingUndo['moved'] = [];
  try {
    for (const f of plan.folders) {
      if (f.existingFolderId) {
        keyToId.set(f.key, f.existingFolderId);
      } else {
        const id = await deps.createFolder(barId, f.name);
        createdFolderIds.push(id);
        keyToId.set(f.key, id);
      }
    }
    for (const m of plan.moves) {
      const toId = keyToId.get(m.toKey);
      if (!toId) continue;
      await deps.moveBookmark(m.id, { parentId: toId });
      moved.push({ id: m.id, fromParentId: m.fromParentId });
    }
  } catch (e) {
    // Roll back: move done bookmarks back, remove freshly created folders.
    for (const m of moved.reverse()) {
      try { await deps.moveBookmark(m.id, { parentId: m.fromParentId }); } catch { /* best-effort */ }
    }
    for (const id of createdFolderIds.reverse()) {
      try { await deps.removeFolder(id); } catch { /* best-effort */ }
    }
    await clearUndo();
    throw new GroupingError('apply', (e as Error).message || 'apply failed');
  }
  await saveUndo({ at: deps.now(), moved, createdFolderIds });
  return plan.summary;
}

export async function undoLastGrouping(depsIn?: Partial<ApplyDeps>): Promise<boolean> {
  const deps = resolve(depsIn);
  const undo = await loadUndo();
  if (!undo) return false;
  const plan = buildUndoPlan(undo);
  const failedMoves: GroupingUndo['moved'] = [];
  const failedFolders: string[] = [];
  for (const m of plan.moves) {
    try { await deps.moveBookmark(m.id, { parentId: m.toParentId }); }
    catch { failedMoves.push({ id: m.id, fromParentId: m.toParentId }); }
  }
  for (const id of plan.removeFolderIds) {
    try { await deps.removeFolder(id); } catch { failedFolders.push(id); }
  }
  if (failedMoves.length || failedFolders.length) {
    await saveUndo({ at: undo.at, moved: failedMoves, createdFolderIds: failedFolders });
    throw new GroupingError('apply', 'undo incomplete');
  }
  await clearUndo();
  return true;
}
