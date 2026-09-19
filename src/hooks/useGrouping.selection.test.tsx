import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useGrouping, type GroupingWorkflow } from './useGrouping';
import { DEFAULT_SETTINGS, type Bookmark, type ChromeData } from '../types';
import { INBOX_KEY } from '../services/capture';
import { writeLocal } from '../services/localStore';

const mocks = vi.hoisted(() => ({ data: {} as ChromeData, fresh: {} as ChromeData, group: vi.fn(), apply: vi.fn(), undo: vi.fn(), refresh: vi.fn() }));
vi.mock('../services/ai/grouping', () => ({ makeGrouper: () => ({ group: mocks.group }) }));
vi.mock('../services/chromeApi', async importOriginal => ({ ...await importOriginal<typeof import('../services/chromeApi')>(), loadBookmarkData: async () => mocks.fresh }));
vi.mock('../services/grouping/apply', () => ({ applyGrouping: (...args: unknown[]) => mocks.apply(...args), undoLastGrouping: () => mocks.undo() }));
vi.mock('../services/grouping/store', () => ({ loadUndo: async () => null }));
let root: Root, container: HTMLDivElement, flow: GroupingWorkflow;
const bookmark = (id: string, parentId: string, readOnly = false): Bookmark => ({ id, parentId, readOnly, name: id, url: `https://${id}.example/`, group: '', visits: 0, color: '', last: '', letter: '' });
function Harness() {
  flow = useGrouping(mocks.data, DEFAULT_SETTINGS, mocks.refresh, 'inbox');
  return <div>{flow.stage} {flow.error}</div>;
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear();
  mocks.data = { barId: 'bar', recents: [], source: 'fallback', groups: [
    { id: 'inbox', label: '收件箱', parentGroupId: null, depth: 0 },
    { id: 'inside', label: '内部', parentGroupId: 'inbox', depth: 1 },
    { id: 'work', label: '工作', parentGroupId: null, depth: 0 },
  ], bookmarks: [bookmark('a', 'inbox'), bookmark('b', 'inbox'), bookmark('unselected', 'inbox'), bookmark('outside', 'bar'), bookmark('managed', 'inbox', true)] };
  mocks.fresh = structuredClone(mocks.data);
  await writeLocal(INBOX_KEY, { version: 1, folderId: 'inbox' });
  mocks.group.mockReset().mockResolvedValue({ groups: [{ name: '工作', memberIds: ['a', 'b', 'outside', 'unselected', 'invented'] }], unassigned: [] });
  mocks.apply.mockReset().mockResolvedValue({ movedBookmarks: 2, newFolders: 0 }); mocks.undo.mockReset().mockResolvedValue(true); mocks.refresh.mockReset();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<Harness />));
  await act(async () => { flow.select!({ ids: ['a', 'b', 'managed', 'outside'], inboxId: 'inbox' }); });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it('sends only selected writable inbox bookmarks and excludes inbox folders from reuse', async () => {
  await act(async () => flow.generate());
  expect(mocks.group.mock.calls[0]![0].map((input: { id: string }) => input.id)).toEqual(['a', 'b']);
  expect(mocks.group.mock.calls[0]![1]).toEqual(['工作']);
  expect(flow.proposal!.groups[0]!.memberIds).toEqual(['a', 'b']);
  expect(mocks.apply).not.toHaveBeenCalled();
  await act(async () => flow.apply());
  expect(mocks.apply.mock.calls[0]![0].moves.map((move: { id: string }) => move.id)).toEqual(['a', 'b']);
  expect(mocks.apply.mock.calls[0]![1]).toBe('bar');
  expect(flow.stage).toBe('complete');
  await act(async () => flow.undo()); expect(mocks.undo).toHaveBeenCalledOnce();
});

it('blocks applying a stale draft after a selected bookmark was moved in another tab', async () => {
  await act(async () => flow.generate());
  mocks.fresh.bookmarks[0]!.parentId = 'work';
  await act(async () => flow.apply());
  expect(mocks.apply).not.toHaveBeenCalled(); expect(flow.error).toContain('位置已变化'); expect(flow.stage).toBe('review');
});

it('blocks applying a draft after its destination was removed', async () => {
  await act(async () => flow.generate());
  mocks.fresh.groups = mocks.fresh.groups.filter(group => group.id !== 'work');
  await act(async () => flow.apply()); expect(mocks.apply).not.toHaveBeenCalled(); expect(flow.error).toContain('位置已变化');
});

it('keeps scope fixed while generation is in flight and cancels without writing bookmarks', async () => {
  let resolve!: (value: { groups: []; unassigned: [] }) => void;
  mocks.group.mockImplementation(() => new Promise(yes => { resolve = yes; }));
  let pending!: Promise<void>;
  await act(async () => { pending = flow.generate(); });
  expect(flow.select!(null)).toBe(false);
  await act(async () => flow.cancel());
  await act(async () => { resolve({ groups: [], unassigned: [] }); await pending; });
  expect(flow.proposal).toBeNull(); expect(mocks.apply).not.toHaveBeenCalled();
});
