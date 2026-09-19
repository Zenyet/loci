import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { Bookmark } from '../types';
import { archiveInboxBookmark, captureUrl, currentCapturePage, folderPath, INBOX_DESTINATION, INBOX_KEY, matchingBookmarks, readInbox, saveCapture, type BookmarkData } from './capture';
import { readLocal, writeLocal } from './localStore';

const mocks = vi.hoisted(() => ({ data: {} as BookmarkData, create: vi.fn(), folder: vi.fn(), move: vi.fn(), remove: vi.fn(), tab: vi.fn() }));
vi.mock('./chromeApi', () => ({
  hasChromeApi: true,
  loadBookmarkData: async () => structuredClone(mocks.data),
  createBookmark: (...args: unknown[]) => mocks.create(...args),
  createFolder: (...args: unknown[]) => mocks.folder(...args),
  moveBookmark: (...args: unknown[]) => mocks.move(...args),
  removeEmptyFolder: (...args: unknown[]) => mocks.remove(...args),
}));
const bookmark = (id: string, url: string, parentId = 'bar'): Bookmark => ({ id, url, parentId, name: id, group: '', color: '', letter: '', visits: 0, last: '' });
const input = (requestId: string, url = 'https://example.com/article?q=1#section') => ({ requestId, title: '阅读这篇文章', url, destinationId: INBOX_DESTINATION });
beforeEach(() => {
  localStorage.clear();
  mocks.data = { barId: 'bar', groups: [{ id: 'work', label: '工作', parentGroupId: null, depth: 0 }], bookmarks: [] };
  let folderSeq = 0;
  mocks.folder.mockReset().mockImplementation(async (parentId, title) => {
    const id = `folder-${++folderSeq}`;
    mocks.data.groups.push({ id, label: title, parentGroupId: parentId === 'bar' ? null : parentId, depth: 0 });
    return id;
  });
  mocks.create.mockReset().mockImplementation(async (parentId, title, url) => {
    const id = `bookmark-${mocks.data.bookmarks.length}`;
    mocks.data.bookmarks.push({ ...bookmark(id, url, parentId), name: title }); return id;
  });
  mocks.move.mockReset().mockImplementation(async (id, { parentId }) => { mocks.data.bookmarks.find(bookmark => bookmark.id === id)!.parentId = parentId; });
  mocks.remove.mockReset(); mocks.tab.mockReset();
  vi.stubGlobal('chrome', { tabs: { query: mocks.tab } });
});
afterEach(() => vi.unstubAllGlobals());

describe('quick capture and inbox', () => {
  it('preserves query parameters, query order, fragments and path case', () => {
    expect(captureUrl(' https://EXAMPLE.com/Article?b=2&a=1#Read ')).toBe('https://example.com/Article?b=2&a=1#Read');
    mocks.data.bookmarks = [bookmark('same', 'https://example.com/Article?b=2&a=1#Read'), bookmark('query', 'https://example.com/Article?a=1&b=2#Read'), bookmark('anchor', 'https://example.com/Article?b=2&a=1#Other')];
    expect(matchingBookmarks(mocks.data, 'https://example.com/Article?b=2&a=1#Read').map(item => item.id)).toEqual(['same']);
    for (const value of ['chrome://settings', 'javascript:alert(1)', 'file:///a', 'data:text/plain,x', 'https://name:password@example.com', 'invalid']) expect(() => captureUrl(value)).toThrow();
  });
  it('creates a distinct inbox lazily without adopting a same-name folder or moving loose bookmarks', async () => {
    mocks.data.groups.push({ id: 'user-folder', label: 'Loci 收件箱', parentGroupId: null, depth: 0 });
    mocks.data.bookmarks.push(bookmark('old', 'https://old.example/'));
    expect(await readInbox(mocks.data)).toBeNull();
    expect(mocks.folder).not.toHaveBeenCalled();
    expect((await saveCapture(input('first'))).status).toBe('saved');
    const inbox = await readInbox(mocks.data);
    expect(inbox?.id).not.toBe('user-folder'); expect(inbox?.label).toBe('Loci 收件箱');
    expect(mocks.data.bookmarks[0]?.parentId).toBe('bar'); expect(mocks.move).not.toHaveBeenCalled();
  });
  it('serializes simultaneous captures and reports duplicates before creating an extra bookmark', async () => {
    const [first, second] = await Promise.all([saveCapture(input('a')), saveCapture(input('b'))]);
    expect(first.status).toBe('saved'); expect(second.status).toBe('duplicate');
    expect(mocks.create).toHaveBeenCalledOnce(); expect(mocks.folder).toHaveBeenCalledOnce();
  });
  it('requires an explicit copy choice and makes repeated submissions with the same receipt idempotent', async () => {
    await saveCapture(input('first'));
    expect((await saveCapture(input('second'))).status).toBe('duplicate');
    await saveCapture({ ...input('copy'), destinationId: 'work', allowDuplicate: true });
    await saveCapture({ ...input('copy'), destinationId: 'work', allowDuplicate: true });
    expect(mocks.create).toHaveBeenCalledTimes(2); expect(mocks.data.bookmarks[1]?.parentId).toBe('work');
  });
  it('keeps the same inbox after rename/move, recreating only after deletion', async () => {
    await saveCapture(input('a'));
    const folder = await readInbox(mocks.data);
    const stored = mocks.data.groups.find(group => group.id === folder!.id)!;
    stored.label = '稍后阅读'; stored.parentGroupId = 'work';
    await saveCapture(input('b', 'https://second.example/'));
    expect(mocks.folder).toHaveBeenCalledOnce();
    expect(folderPath(mocks.data, stored.id)).toBe('书签栏 / 工作 / 稍后阅读');
    mocks.data.groups = mocks.data.groups.filter(group => group.id !== stored.id);
    expect(await readInbox(mocks.data)).toBeNull();
    await saveCapture(input('c', 'https://third.example/'));
    expect(mocks.folder).toHaveBeenCalledTimes(2);
  });
  it('checks destinations at save time, rejecting managed and removed folders', async () => {
    mocks.data.groups.push({ id: 'managed', label: '组织', parentGroupId: null, depth: 0, readOnly: true });
    for (const destinationId of ['managed', 'removed']) await expect(saveCapture({ ...input(destinationId), destinationId })).rejects.toThrow('目标文件夹');
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.folder).not.toHaveBeenCalled();
  });
  it('allows a failed save to retry without creating another inbox', async () => {
    mocks.create.mockRejectedValueOnce(new Error('bookmark store unavailable'));
    await expect(saveCapture(input('retry'))).rejects.toThrow('unavailable');
    expect((await saveCapture(input('retry'))).status).toBe('saved'); expect(mocks.folder).toHaveBeenCalledOnce();
    expect((await readLocal<{ folderId: string }>(INBOX_KEY))?.folderId).toBe(mocks.data.bookmarks[0]?.parentId);
  });
  it('archives only a still-pending bookmark, preserving others and excluding inbox descendants', async () => {
    await saveCapture(input('a')); await saveCapture(input('b', 'https://second.example/'));
    const inbox = (await readInbox(mocks.data))!;
    mocks.data.groups.push({ id: 'nested', parentGroupId: inbox.id, label: '内部', depth: 1 });
    await expect(archiveInboxBookmark('bookmark-0', inbox.id, 'nested')).rejects.toThrow('之外');
    await archiveInboxBookmark('bookmark-0', inbox.id, 'work');
    expect(mocks.data.bookmarks[1]?.parentId).toBe(inbox.id);
    await expect(archiveInboxBookmark('bookmark-0', inbox.id, 'bar')).rejects.toThrow('位置已变化');
    expect(mocks.move).toHaveBeenCalledOnce();
  });
  it('rejects an inbox record pointing to a system root', async () => {
    await writeLocal(INBOX_KEY, { version: 1, folderId: 'work' });
    mocks.data.groups[0]!.isRoot = true; expect(await readInbox(mocks.data)).toBeNull();
  });
  it('reads only the active tab and explains unsupported pages', async () => {
    mocks.tab.mockResolvedValueOnce([{ title: 'Example', url: 'https://example.com/page' }]);
    expect(await currentCapturePage()).toEqual({ title: 'Example', url: 'https://example.com/page' });
    expect(mocks.tab).toHaveBeenCalledWith({ active: true, currentWindow: true });
    mocks.tab.mockResolvedValueOnce([{ url: 'chrome://extensions/' }]);
    await expect(currentCapturePage()).rejects.toThrow('无法收藏');
    mocks.tab.mockResolvedValueOnce([{}]); await expect(currentCapturePage()).rejects.toThrow('无法读取');
  });
});
