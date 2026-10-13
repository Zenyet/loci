import type { Bookmark, BookmarkRoot, ChromeData, Group, HistoryItem, Settings } from '../types';
import { DEFAULT_SETTINGS } from '../types';
import { normalizeWidgets } from './widgetSettings';
import { readWallpaperSettings, saveWallpaperSettings } from './wallpaperStorage';
import {
  mockCreateBookmark,
  mockCreateFolder,
  mockLoadData,
  mockMove,
  mockRemove,
  mockRemoveTree,
  mockSubscribe,
  mockUpdate,
} from './mockBookmarks';

// ─── Chrome API detection ─────────────────────────────────────────────────

export const hasChromeApi: boolean =
  typeof chrome !== 'undefined' && typeof chrome.bookmarks !== 'undefined';

// ─── Deterministic color + letter assignment ──────────────────────────────

const PALETTE = [
  '#1a1a1a', '#5e6ad2', '#a259ff', '#e8e8e3', '#4a154b', '#ea4335',
  '#4285f4', '#1fa463', '#ff0033', '#1db954', '#e50914', '#ff4500',
  '#000000', '#cc785c', '#10a37f', '#007acc', '#ff6363', '#f48024',
  '#ff6600', '#ff6719', '#202020',
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function colorFor(url: string): string {
  return PALETTE[hashStr(url) % PALETTE.length]!;
}

function letterFor(name: string): string {
  const words = name.trim().split(/\s+/);
  const first = words[0] || '?';
  // For non-Latin text use the first character alone.
  if (/[^\x00-\x7F]/.test(first)) return first[0]!;
  if (words.length >= 2) {
    return (first[0]! + words[1]![0]).toUpperCase();
  }
  return (first[0]! + (first[1] || first[0]!)).toUpperCase();
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function formatLast(ms: number | undefined): string {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} 小时前`;
  const days = Math.round(hrs / 24);
  return `${days} 天前`;
}

function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours().toString().padStart(2, '0')}:${d
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
}

// ─── Bookmarks tree → flat lists ──────────────────────────────────────────

type BrowserBookmarkNode = chrome.bookmarks.BookmarkTreeNode & { folderType?: string };

export function flattenBookmarks(tree: chrome.bookmarks.BookmarkTreeNode[]): {
  bookmarks: Bookmark[]; groups: Group[]; barId: string | null; roots: BookmarkRoot[];
} {
  const rootNodes = (tree[0]?.children ?? []).filter(node => !node.url) as BrowserBookmarkNode[];
  const bar = rootNodes.find(node => node.folderType === 'bookmarks-bar' && !node.unmodifiable)
    ?? rootNodes.find(node => node.id === '1' && !node.unmodifiable)
    ?? rootNodes.find(node => !node.unmodifiable);
  const barId = bar?.id ?? null;
  const bookmarks: Bookmark[] = [];
  const groups: Group[] = [];
  const roots: BookmarkRoot[] = rootNodes.map(node => ({
    id: node.id, readOnly: !!node.unmodifiable,
    label: node.title || (node.id === barId ? '书签栏' : node.folderType === 'mobile' || node.id === '3' ? '移动设备书签' : node.folderType === 'managed' ? '受管理的书签' : '其他书签'),
  }));
  const walk = (node: chrome.bookmarks.BookmarkTreeNode, rootId: string, groupLabel: string, depth: number, readOnly: boolean) => {
    for (const child of node.children ?? []) {
      const locked = readOnly || !!child.unmodifiable;
      if (child.url) {
        const name = child.title || domainOf(child.url);
        bookmarks.push({ id: child.id, parentId: child.parentId || node.id,
          name, url: child.url, group: groupLabel, color: colorFor(child.url), letter: letterFor(name),
          visits: 0, last: '—', rootId, readOnly: locked });
      } else {
        const label = child.title || '未命名';
        groups.push({ id: child.id, label, parentGroupId: node.id === barId ? null : node.id,
          depth, rootId, readOnly: locked });
        walk(child, rootId, label, depth + 1, locked);
      }
    }
  };
  for (const node of rootNodes) {
    const root = roots.find(candidate => candidate.id === node.id)!;
    if (node.id !== barId) groups.push({ id: node.id, label: root.label, parentGroupId: null,
      depth: 0, rootId: node.id, isRoot: true, readOnly: root.readOnly });
    walk(node, node.id, node.id === barId ? '未分组' : root.label, node.id === barId ? 0 : 1, root.readOnly);
  }
  return { bookmarks, groups, barId, roots };
}

async function loadBookmarks() {
  return flattenBookmarks(hasChromeApi ? await chrome.bookmarks.getTree() : []);
}

// ─── History + visit counts ───────────────────────────────────────────────

async function loadHistory(): Promise<{
  recents: HistoryItem[];
  visitsByUrl: Map<string, { count: number; last: number }>;
}> {
  if (!hasChromeApi || !chrome.history) {
    return { recents: [], visitsByUrl: new Map() };
  }
  try {
    const items = await chrome.history.search({
      text: '',
      startTime: Date.now() - 30 * 86_400_000,
      maxResults: 2000,
    });

    const visitsByUrl = new Map<string, { count: number; last: number }>();
    for (const it of items) {
      if (!it.url) continue;
      const d = domainOf(it.url);
      const prev = visitsByUrl.get(d) || { count: 0, last: 0 };
      visitsByUrl.set(d, {
        count: prev.count + (it.visitCount || 1),
        last: Math.max(prev.last, it.lastVisitTime || 0),
      });
    }

    const recents: HistoryItem[] = items
      .filter((i) => i.url && i.title)
      .sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0))
      .slice(0, 20)
      .map((i) => ({
        title: i.title || domainOf(i.url!),
        url: i.url!,
        at: formatClock(i.lastVisitTime || Date.now()),
        lastVisitTime: i.lastVisitTime || 0,
      }));

    return { recents, visitsByUrl };
  } catch {
    return { recents: [], visitsByUrl: new Map() };
  }
}

// ─── Top sites (fallback source) ──────────────────────────────────────────

async function loadTopSites(barId: string): Promise<{ bookmarks: Bookmark[]; groups: Group[] }> {
  if (!hasChromeApi || !chrome.topSites) return { bookmarks: [], groups: [] };
  try {
    const sites = await chrome.topSites.get();
    const bms: Bookmark[] = sites.slice(0, 20).map((s, i) => ({
      id: `ts-${i}`,
      readOnly: true, rootId: barId,
      parentId: barId,
      name: s.title || domainOf(s.url),
      url: s.url,
      group: '常用',
      color: colorFor(s.url),
      letter: letterFor(s.title || domainOf(s.url)),
      visits: 100 - i * 3,
      last: '—',
    }));
    return { bookmarks: bms, groups: [] };
  } catch {
    return { bookmarks: [], groups: [] };
  }
}

// ─── Public: aggregate loader ─────────────────────────────────────────────

/** Bookmark-only snapshot: capture never needs browsing history or top-site fallbacks. */
export async function loadBookmarkData(): Promise<Pick<ChromeData, 'bookmarks' | 'groups' | 'barId' | 'roots'>> {
  if (hasChromeApi) return loadBookmarks();
  return mockLoadData();
}

export async function loadChromeData(): Promise<ChromeData> {
  if (!hasChromeApi) {
    // In dev we back CRUD with a localStorage-based mock, so loading just
    // replays that state. First-run seeds from the FALLBACK fixtures so the
    // initial screen looks identical to the old read-only fallback path.
    const m = mockLoadData();
    return {
      bookmarks: m.bookmarks,
      recents: m.recents,
      groups: m.groups,
      barId: m.barId,
      source: 'fallback',
    };
  }

  let { bookmarks, groups, barId, roots } = await loadBookmarks();
  const { recents, visitsByUrl } = await loadHistory();

  if (bookmarks.length === 0 && barId) {
    const ts = await loadTopSites(barId);
    bookmarks = ts.bookmarks;
    // Preserve real empty folders and source roots while showing top sites.
  }

  for (const b of bookmarks) {
    const v = visitsByUrl.get(domainOf(b.url));
    if (v) {
      b.visits = v.count;
      b.last = formatLast(v.last);
    }
  }

  if (bookmarks.length === 0) {
    return {
      bookmarks,
      recents,
      groups,
      barId,
      roots, source: 'chrome',
    };
  }

  return { bookmarks, recents, groups, barId, roots, source: 'chrome' };
}

// ─── CRUD on bookmarks and folders ────────────────────────────────────────

export async function createBookmark(
  parentId: string,
  title: string,
  url: string
): Promise<string> {
  if (!hasChromeApi) return mockCreateBookmark(parentId, title, url);
  const node = await chrome.bookmarks.create({ parentId, title, url });
  return node.id;
}

export async function removeBookmark(id: string): Promise<void> {
  if (!hasChromeApi) return mockRemove(id);
  await chrome.bookmarks.remove(id);
}

export async function updateBookmark(
  id: string,
  changes: { title?: string; url?: string }
): Promise<void> {
  if (!hasChromeApi) return mockUpdate(id, changes);
  await chrome.bookmarks.update(id, changes);
}

export async function moveBookmark(
  id: string,
  dest: { parentId?: string; index?: number }
): Promise<void> {
  if (!hasChromeApi) return mockMove(id, dest);
  await chrome.bookmarks.move(id, dest);
}

export async function createFolder(parentId: string, title: string): Promise<string> {
  if (!hasChromeApi) return mockCreateFolder(parentId, title);
  const node = await chrome.bookmarks.create({ parentId, title });
  return node.id;
}

export async function renameFolder(id: string, title: string): Promise<void> {
  if (!hasChromeApi) return mockUpdate(id, { title });
  await chrome.bookmarks.update(id, { title });
}

export async function removeFolder(id: string): Promise<void> {
  if (!hasChromeApi) return mockRemoveTree(id);
  await chrome.bookmarks.removeTree(id);
}

/** Non-recursive: removes an (expected-empty) folder. chrome.bookmarks.remove
 *  THROWS on a non-empty folder, so a stranded child is preserved rather than deleted. */
export async function removeEmptyFolder(id: string): Promise<void> {
  if (!hasChromeApi) return mockRemove(id);
  await chrome.bookmarks.remove(id);
}

export async function moveFolder(
  id: string,
  dest: { parentId?: string; index?: number }
): Promise<void> {
  if (!hasChromeApi) return mockMove(id, dest);
  await chrome.bookmarks.move(id, dest);
}

// ─── Bookmark change subscription ─────────────────────────────────────────

export function subscribeBookmarkChanges(cb: () => void): () => void {
  if (!hasChromeApi) return mockSubscribe(cb);
  if (!chrome.bookmarks.onCreated) return () => {};
  const handlers: Array<() => void> = [];
  const register = <T extends chrome.events.Event<(...args: any[]) => void>>(
    ev: T
  ) => {
    ev.addListener(cb);
    handlers.push(() => ev.removeListener(cb));
  };
  register(chrome.bookmarks.onCreated);
  register(chrome.bookmarks.onRemoved);
  register(chrome.bookmarks.onChanged);
  register(chrome.bookmarks.onMoved);
  return () => handlers.forEach((h) => h());
}

// ─── Settings (chrome.storage.local with localStorage fallback) ───────────

const VALID_THEMES = new Set(['dark', 'light', 'system']);

const VALID_AI_PROVIDERS = new Set(['off', 'anthropic', 'openai', 'google', 'deepseek', 'alibaba', 'moonshot', 'zhipu', 'baichuan', 'minimax', 'openrouter', 'cloudflare', 'groq', 'custom']);

export function normalizeSettings(raw: Partial<Settings> | null | undefined): Settings {
  const next = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
  delete (next as Settings & { showStrip?: boolean }).showStrip;
  next.bingWallpaper = next.bingWallpaper === true;
  if (!VALID_THEMES.has(next.theme)) next.theme = DEFAULT_SETTINGS.theme;
  const ai = { ...DEFAULT_SETTINGS.ai, ...(next.ai ?? {}) };
  // Migrate legacy provider IDs (type assertion needed for runtime migration)
  if ((ai.provider as string) === 'claude') ai.provider = 'anthropic';
  if ((ai.provider as string) === 'openai-compatible') ai.provider = 'custom';
  if (!VALID_AI_PROVIDERS.has(ai.provider)) ai.provider = 'off';
  next.ai = ai;
  const VALID_GRANULARITY = new Set(['coarse', 'balanced', 'fine']);
  const VALID_NAME_LANG = new Set(['auto', 'zh', 'en']);
  const VALID_SCOPE = new Set(['ungrouped', 'all']);
  const grouping = { ...DEFAULT_SETTINGS.grouping, ...(next.grouping ?? {}) };
  if (!VALID_GRANULARITY.has(grouping.granularity)) grouping.granularity = DEFAULT_SETTINGS.grouping.granularity;
  if (!VALID_NAME_LANG.has(grouping.nameLanguage)) grouping.nameLanguage = DEFAULT_SETTINGS.grouping.nameLanguage;
  if (!VALID_SCOPE.has(grouping.scope)) grouping.scope = DEFAULT_SETTINGS.grouping.scope;
  if (typeof grouping.minGroupSize !== 'number' || grouping.minGroupSize < 1) {
    grouping.minGroupSize = DEFAULT_SETTINGS.grouping.minGroupSize;
  }
  if (typeof grouping.reuseExisting !== 'boolean') grouping.reuseExisting = DEFAULT_SETTINGS.grouping.reuseExisting;
  next.grouping = grouping;
  next.widgets = normalizeWidgets(next.widgets);
  return next;
}

export async function loadSettings(): Promise<Settings> {
  try { return normalizeSettings(await readWallpaperSettings<Settings>()); }
  catch { return DEFAULT_SETTINGS; }
}

export async function saveSettings(s: Settings): Promise<void> {
  await saveWallpaperSettings(s);
}

// ─── Todos persistence ────────────────────────────────────────────────────

const TODOS_KEY = 'newtab-todos';

export async function loadTodosRaw<T>(fallback: T): Promise<T> {
  if (hasChromeApi && chrome.storage?.local) {
    const obj = await chrome.storage.local.get(TODOS_KEY);
    return obj[TODOS_KEY] ?? fallback;
  }
  try {
    const raw = localStorage.getItem(TODOS_KEY);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export async function saveTodosRaw<T>(value: T): Promise<void> {
  if (hasChromeApi && chrome.storage?.local) {
    await chrome.storage.local.set({ [TODOS_KEY]: value });
    return;
  }
  try {
    localStorage.setItem(TODOS_KEY, JSON.stringify(value));
  } catch {
    /* noop */
  }
}

// ─── Favicon URL ──────────────────────────────────────────────────────────

/** Stable cache key per bookmark origin (favicon file path varies by site). */
export function bookmarkOriginKey(pageUrl: string): string | null {
  try {
    const u = new URL(/^https?:\/\//.test(pageUrl) ? pageUrl : `https://${pageUrl}`);
    return u.origin;
  } catch {
    return null;
  }
}

/** Public origin only: paths, query strings, credentials and private hosts never leave the browser. */
export function faviconCandidates(pageUrl: string): string[] {
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(pageUrl) ? pageUrl : `https://${pageUrl}`);
    const host = u.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(u.protocol) || !host.includes('.') || host.endsWith('.local') || host.endsWith('.localhost')
      || host.endsWith('.internal') || host.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return [];
    const query = new URLSearchParams({ client: 'SOCIAL', type: 'FAVICON', fallback_opts: 'TYPE,SIZE,URL', url: `https://${host}`, size: '64' });
    return [`https://t0.gstatic.cn/faviconV2?${query}`];
  } catch { return []; }
}

/** First candidate only; prefer `faviconCandidates` when loading. */
export function faviconUrl(pageUrl: string): string | null {
  const c = faviconCandidates(pageUrl);
  return c[0] ?? null;
}

// ─── Navigation ───────────────────────────────────────────────────────────

export function openUrl(url: string, newTab: boolean = true): void {
  const full = /^[a-z][a-z\d+.-]*:/i.test(url) ? url : `https://${url}`;
  if (newTab) {
    window.open(full, '_blank', 'noopener,noreferrer');
  } else {
    window.location.href = full;
  }
}

export function googleSearchUrl(q: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}
