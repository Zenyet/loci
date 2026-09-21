// removeEmptyFolder (non-recursive) is used for undo/rollback so that a folder
// left non-empty by a failed best-effort move-back throws and is preserved,
// instead of removeFolder's removeTree silently deleting a stranded bookmark.
import { createFolder as realCreateFolder, moveBookmark as realMoveBookmark, removeEmptyFolder as realRemoveFolder } from '../chromeApi';
import { buildUndoPlan, type ApplyPlan } from './plan';
import { loadUndo, saveUndo, clearUndo } from './store';
import { GroupingError } from './errors';
import type { GroupingUndo } from '../../types';
import type { GroupingOperation } from '../aiHistory';

export interface ApplyDeps {
  historyId?: string;
  report?: (operation: GroupingOperation) => void;
  createFolder: (parentId: string, title: string) => Promise<string>;
  moveBookmark: (id: string, dest: { parentId?: string; index?: number }) => Promise<void>;
  removeFolder: (id: string) => Promise<void>;
  now: () => string;
}

function resolve(deps?: Partial<ApplyDeps>): ApplyDeps {
  return {
    historyId: deps?.historyId,
    report: deps?.report,
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
        let id: string;
        try { id = await deps.createFolder(barId, f.name); }
        catch (error) { deps.report?.({ action: 'create-folder', status: 'failed', id: f.key, name: f.name }); throw error; }
        createdFolderIds.push(id);
        keyToId.set(f.key, id);
        deps.report?.({ action: 'create-folder', status: 'success', id: f.key, parentId: id, name: f.name });
      }
    }
    for (const m of plan.moves) {
      const toId = keyToId.get(m.toKey);
      if (!toId) continue;
      try { await deps.moveBookmark(m.id, { parentId: toId }); }
      catch (error) { deps.report?.({ action: 'move', status: 'failed', id: m.id, parentId: toId }); throw error; }
      moved.push({ id: m.id, fromParentId: m.fromParentId });
      deps.report?.({ action: 'move', status: 'success', id: m.id, parentId: toId });
    }
    await saveUndo({ at: deps.now(), moved, createdFolderIds, ...(deps.historyId ? { historyId: deps.historyId } : {}) });
  } catch (e) {
    // Roll back: move done bookmarks back, remove freshly created folders.
    for (const m of moved.reverse()) {
      try {
        await deps.moveBookmark(m.id, { parentId: m.fromParentId });
        deps.report?.({ action: 'rollback-move', status: 'success', id: m.id, parentId: m.fromParentId });
      } catch { deps.report?.({ action: 'rollback-move', status: 'failed', id: m.id, parentId: m.fromParentId }); }
    }
    for (const id of createdFolderIds.reverse()) {
      try { await deps.removeFolder(id); deps.report?.({ action: 'remove-folder', status: 'success', id }); }
      catch { deps.report?.({ action: 'remove-folder', status: 'failed', id }); }
    }
    await clearUndo();
    throw new GroupingError('apply', (e as Error).message || 'apply failed');
  }
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
    try {
      await deps.moveBookmark(m.id, { parentId: m.toParentId });
      deps.report?.({ action: 'undo-move', status: 'success', id: m.id, parentId: m.toParentId });
    } catch {
      failedMoves.push({ id: m.id, fromParentId: m.toParentId });
      deps.report?.({ action: 'undo-move', status: 'failed', id: m.id, parentId: m.toParentId });
    }
  }
  for (const id of plan.removeFolderIds) {
    try { await deps.removeFolder(id); deps.report?.({ action: 'remove-folder', status: 'success', id }); }
    catch { failedFolders.push(id); deps.report?.({ action: 'remove-folder', status: 'failed', id }); }
  }
  if (failedMoves.length || failedFolders.length) {
    await saveUndo({ ...undo, moved: failedMoves, createdFolderIds: failedFolders });
    throw new GroupingError('apply', 'undo incomplete');
  }
  await clearUndo();
  return true;
}
