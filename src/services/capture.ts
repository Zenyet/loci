import type { Bookmark, Group } from '../types';
import { createBookmark, createFolder, hasChromeApi, loadBookmarkData, moveBookmark, removeEmptyFolder } from './chromeApi';
import { readLocal, withLocalLock, writeLocal } from './localStore';

export const INBOX_KEY = 'loci-inbox-v1';
export const INBOX_DESTINATION = '__loci_inbox__';
export type BookmarkData = Awaited<ReturnType<typeof loadBookmarkData>>;
export interface InboxRecord { version: 1; folderId: string }
export type CaptureResult =
  | { status: 'duplicate'; matches: Bookmark[] }
  | { status: 'saved'; bookmarkId: string; parentId: string; title: string };

/** URL serialization only. Query order, tracking parameters, fragments and paths stay intact. */
export function captureUrl(raw: string): string {
  try {
    const url = new URL(raw.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
    return url.href;
  } catch { throw new Error('请使用有效的 http 或 https 网页地址。'); }
}

export function matchingBookmarks(data: BookmarkData, raw: string): Bookmark[] {
  const url = captureUrl(raw);
  return data.bookmarks.filter(bookmark => {
    try { return captureUrl(bookmark.url) === url; } catch { return false; }
  });
}

export function folderPath(data: BookmarkData, id: string): string {
  const parts: string[] = [];
  const visited = new Set<string>();
  let cursor: string | null = id;
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    if (cursor === data.barId) { parts.unshift(data.roots?.find(root => root.id === cursor)?.label ?? '书签栏'); break; }
    const folder = data.groups.find(group => group.id === cursor);
    if (!folder) break;
    parts.unshift(folder.label);
    cursor = folder.parentGroupId ?? (folder.isRoot ? null : data.barId);
  }
  return parts.join(' / ') || '原位置已不可用';
}

export function writableDestination(data: BookmarkData, id: string): boolean {
  return id === data.barId && !!id || data.groups.some(group => group.id === id && !group.readOnly);
}

export function inboxDescendants(groups: Group[], inboxId: string | null): Set<string> {
  const ids = new Set<string>(inboxId ? [inboxId] : []);
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of groups) if (group.parentGroupId && ids.has(group.parentGroupId) && !ids.has(group.id)) {
      ids.add(group.id); changed = true;
    }
  }
  return ids;
}

export async function readInbox(data: BookmarkData): Promise<Group | null> {
  const record = await readLocal<InboxRecord>(INBOX_KEY);
  if (record?.version !== 1 || typeof record.folderId !== 'string') return null;
  return data.groups.find(group => group.id === record.folderId && !group.isRoot && !group.readOnly) ?? null;
}

/** Caller holds the capture lock. Never adopts a same-name folder or migrates loose bookmarks. */
async function ensureInbox(data: BookmarkData): Promise<string> {
  const existing = await readInbox(data);
  if (existing) return existing.id;
  if (!data.barId) throw new Error('没有可写入的书签栏，请检查书签权限。');
  const id = await createFolder(data.barId, 'Loci 收件箱');
  try { await writeLocal<InboxRecord>(INBOX_KEY, { version: 1, folderId: id }); }
  catch {
    await removeEmptyFolder(id).catch(() => {});
    throw new Error('无法保存收件箱位置，请检查本地存储后重试。');
  }
  return id;
}

export async function saveCapture(input: {
  title: string; url: string; destinationId: string; allowDuplicate?: boolean; requestId: string;
}): Promise<CaptureResult> {
  const url = captureUrl(input.url);
  const title = input.title.trim();
  if (!title) throw new Error('请为这个收藏填写标题。');
  return withLocalLock('capture', async () => {
    const data = await loadBookmarkData();
    const last = await readLocal<{ requestId: string; bookmarkId: string }>('loci-capture-last-save');
    const saved = last?.requestId === input.requestId ? data.bookmarks.find(bookmark => bookmark.id === last.bookmarkId && bookmark.url === url) : null;
    if (saved) return { status: 'saved', bookmarkId: saved.id, parentId: saved.parentId, title: saved.name };
    const matches = matchingBookmarks(data, url);
    if (matches.length && !input.allowDuplicate) return { status: 'duplicate', matches };
    const parentId = input.destinationId === INBOX_DESTINATION ? await ensureInbox(data) : input.destinationId;
    if (input.destinationId !== INBOX_DESTINATION && !writableDestination(data, parentId)) {
      throw new Error('目标文件夹已不可用，请重新选择保存位置。');
    }
    const bookmarkId = await createBookmark(parentId, title, url);
    // The bookmark has already been committed. A receipt write must not turn success into a retry.
    await writeLocal('loci-capture-last-save', { requestId: input.requestId, bookmarkId }).catch(() => {});
    return { status: 'saved', bookmarkId, parentId, title };
  });
}

export async function archiveInboxBookmark(id: string, inboxId: string, destinationId: string): Promise<void> {
  await withLocalLock('capture', async () => {
    const data = await loadBookmarkData();
    const inbox = await readInbox(data);
    const bookmark = data.bookmarks.find(item => item.id === id);
    if (inbox?.id !== inboxId || !bookmark || bookmark.readOnly || bookmark.parentId !== inboxId) {
      throw new Error('这条书签的位置已变化，请刷新收件箱后重试。');
    }
    if (!writableDestination(data, destinationId) || inboxDescendants(data.groups, inboxId).has(destinationId)) {
      throw new Error('请选择收件箱之外的可用文件夹。');
    }
    await moveBookmark(id, { parentId: destinationId });
  });
}

export async function currentCapturePage(): Promise<{ title: string; url: string } | null> {
  if (!hasChromeApi) return null;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) throw new Error('无法读取当前页面。请在普通网页上点击 Loci 扩展按钮。');
  let url: string;
  try { url = captureUrl(tab.url); }
  catch { throw new Error('这个页面无法收藏。请在普通 http 或 https 网页上使用。'); }
  return { title: tab.title?.trim() || new URL(url).hostname, url };
}

export function openLociInbox(): void {
  if (hasChromeApi) void chrome.tabs.create({ url: chrome.runtime.getURL('index.html?view=inbox') });
  else window.open('/?view=inbox', '_blank', 'noopener,noreferrer');
}
