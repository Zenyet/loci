import { faviconCandidates } from './chromeApi';
import { blobLease, deleteImages, listImages, readImage, writeImage, type ImageLease, type StoredImage } from './imageStore';
import { readLocal, subscribeLocal, withLocalLock, writeLocal } from './localStore';
export const FAVICON_SETTINGS_KEY = 'loci-favicon-cache-settings-v1';
const GENERATION_KEY = 'loci-favicon-cache-generation-v1';
const LOCK = 'favicon-images';
export const FAVICON_ORIGIN = 'https://t0.gstatic.cn/*';
export interface FaviconPreferences { enabled: boolean; days: number; maxMB: number }
export const DEFAULT_FAVICON_PREFERENCES: FaviconPreferences = { enabled: false, days: 30, maxMB: 20 };
export function normalizeFaviconPreferences(raw: Partial<FaviconPreferences> | undefined): FaviconPreferences {
  return { enabled: raw?.enabled === true, days: [7, 30, 90].includes(raw?.days ?? 0) ? raw!.days! : 30, maxMB: [5, 20, 50].includes(raw?.maxMB ?? 0) ? raw!.maxMB! : 20 };
}
export const readFaviconPreferences = async () => normalizeFaviconPreferences(await readLocal<FaviconPreferences>(FAVICON_SETTINGS_KEY));
export const hasFaviconPermission = async () => typeof chrome === 'undefined' || !chrome.permissions || await chrome.permissions.contains({ origins: [FAVICON_ORIGIN] });
/** Must run synchronously from the enabling click before awaiting anything else. */
export async function requestFaviconPermission(): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.permissions) return true;
  const manifest = chrome.runtime?.getManifest?.();
  if (manifest && !manifest.optional_host_permissions?.includes(FAVICON_ORIGIN)) throw new Error('请先在 Chrome 扩展管理页重新加载 Loci，再开启图标缓存。');
  return chrome.permissions.request({ origins: [FAVICON_ORIGIN] });
}
export function subscribeFaviconPreferences(callback: () => void): () => void {
  const unsubscribe = subscribeLocal(FAVICON_SETTINGS_KEY, callback);
  const removed = (typeof chrome === 'undefined' ? undefined : chrome.permissions?.onRemoved) as { addListener: (fn: () => void) => void; removeListener: (fn: () => void) => void } | undefined;
  removed?.addListener(callback);
  return () => { unsubscribe(); removed?.removeListener(callback); };
}
async function trim(maxMB: number): Promise<void> {
  const images = (await listImages('favicon')).sort((a, b) => b.usedAt - a.usedAt);
  let bytes = 0; let count = 0; const remove: string[] = [];
  for (const image of images) { bytes += image.blob.size; if (bytes > maxMB * 1024 * 1024 || ++count > 2000) remove.push(image.id); }
  await deleteImages(remove);
}
export async function saveFaviconPreferences(preferences: FaviconPreferences): Promise<void> {
  await withLocalLock(LOCK, async () => {
    const next = normalizeFaviconPreferences(preferences);
    await writeLocal(GENERATION_KEY, crypto.randomUUID());
    await writeLocal(FAVICON_SETTINGS_KEY, next);
    await trim(next.maxMB);
  });
}
export async function faviconCacheStats(): Promise<{ count: number; bytes: number }> {
  const images = await listImages('favicon');
  return { count: images.length, bytes: images.reduce((bytes, image) => bytes + image.blob.size, 0) };
}
export async function clearFaviconCache(): Promise<void> {
  await withLocalLock(LOCK, async () => {
    // An older download may finish later, but it cannot repopulate a cleared cache.
    await writeLocal(GENERATION_KEY, crypto.randomUUID());
    await deleteImages((await listImages('favicon')).map(image => image.id));
  });
}
export function faviconRequestUrl(url: string): string {
  const page = new URL(location.href);
  return ['http:', 'https:'].includes(page.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(page.hostname)
    ? `/__loci-favicon/faviconV2${new URL(url).search}` : url;
}
const jobs = new Map<string, { controller: AbortController; promise: Promise<Blob | null>; users: number }>();
let active = 0;
const waiters: (() => void)[] = [];
async function limited<T>(run: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  if (active < 6) active++;
  else await new Promise<void>((resolve, reject) => {
    const ready = () => { signal.removeEventListener('abort', abort); resolve(); };
    const abort = () => { const i = waiters.indexOf(ready); if (i >= 0) waiters.splice(i, 1); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true }); waiters.push(ready);
  });
  try { signal.throwIfAborted(); return await run(); }
  finally { const next = waiters.shift(); if (next) next(); else active--; }
}
async function download(url: string, signal: AbortSignal): Promise<Blob> {
  return limited(async () => {
    const controller = new AbortController(); const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true }); const timeout = setTimeout(abort, 8000);
    try {
      const response = await fetch(faviconRequestUrl(url), { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
      if (!response.ok) throw new Error('图标服务暂不可用。');
      const blob = await response.blob();
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/x-icon', 'image/vnd.microsoft.icon'].includes(blob.type) || blob.size > 256 * 1024 || !blob.size) throw new Error('无效的图标图片。');
      const decoded = await createImageBitmap(blob);
      const valid = decoded.width >= 8 && decoded.height >= 8 && decoded.width <= 192 && decoded.height <= 192;
      decoded.close(); if (!valid) throw new Error('图标尺寸不受支持。');
      signal.throwIfAborted(); return blob;
    } finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); }
  }, signal);
}
async function cachedBlob(url: string, prefs: FaviconPreferences, signal: AbortSignal): Promise<Blob | null> {
  const id = `favicon:${new URL(url).searchParams.get('url')}`;
  let stored: StoredImage | undefined;
  try { stored = await readImage(id); } catch { /* Still display online if storage is unavailable. */ }
  signal.throwIfAborted();
  if (stored && Date.now() - stored.savedAt >= 0 && Date.now() - stored.savedAt < prefs.days * 86400_000) {
    if (Date.now() - stored.usedAt > 3600_000) void withLocalLock(LOCK, async () => {
      const current = await readImage(id);
      if (current?.savedAt === stored!.savedAt) await writeImage({ ...current, usedAt: Date.now() });
    }).catch(() => {});
    return stored.blob;
  }
  if (!await hasFaviconPermission()) return stored?.blob ?? null;
  const generation = await readLocal<string>(GENERATION_KEY);
  const key = `${id}:${prefs.days}:${prefs.maxMB}:${generation}`;
  let job = jobs.get(key);
  if (!job) {
    const controller = new AbortController();
    const promise = (async () => {
      try {
        const blob = await download(url, controller.signal);
        await withLocalLock(LOCK, async () => {
          controller.signal.throwIfAborted();
          if (await readLocal(GENERATION_KEY) !== generation || !(await readFaviconPreferences()).enabled) return;
          await writeImage({ id, kind: 'favicon', blob, savedAt: Date.now(), usedAt: Date.now() });
          await trim(prefs.maxMB);
        }).catch(() => {});
        return blob;
      } catch { return stored?.blob ?? null; }
    })();
    job = { controller, promise, users: 0 }; jobs.set(key, job);
    void promise.finally(() => { if (jobs.get(key)?.promise === promise) jobs.delete(key); });
  }
  job.users++;
  return new Promise((resolve, reject) => {
    let done = false;
    const release = () => { if (done) return; done = true; signal.removeEventListener('abort', abort); if (--job.users === 0) job.controller.abort(); };
    const abort = () => { release(); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    job.promise.then(blob => { if (!done) { release(); resolve(blob); } }, error => { if (!done) { release(); reject(error); } });
  });
}
export async function acquireFavicon(pageUrl: string, signal: AbortSignal): Promise<ImageLease | null> {
  const url = faviconCandidates(pageUrl)[0]; if (!url) return null;
  signal.throwIfAborted();
  const prefs = await readFaviconPreferences().catch(() => DEFAULT_FAVICON_PREFERENCES);
  if (prefs.enabled) {
    const blob = await cachedBlob(url, prefs, signal).catch(() => { signal.throwIfAborted(); return null; });
    signal.throwIfAborted(); if (blob) return blobLease(blob);
  }
  signal.throwIfAborted();
  return { url, release: () => {} };
}
