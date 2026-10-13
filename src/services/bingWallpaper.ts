import { readLocal, withLocalLock, writeLocal } from './localStore';
import { ASSET_PREFIX, deleteImages, isImageRef, listImages, migrateImage, readImage, saveImageBlob } from './imageStore';

export const BING_ORIGINS = ['https://cn.bing.com/*', 'https://www.bing.com/*'];
export const BING_CACHE_KEY = 'loci-bing-wallpaper-v1';
export const BING_ENDPOINT = 'https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN';
export interface BingWallpaper { url: string; imageRef: string; title: string; copyright: string; source: string; date: string; checkedAt: number; checkedDay: string }
export type BingFailure = 'permission' | 'network' | 'metadata' | 'image' | 'storage';
export class BingWallpaperError extends Error {
  constructor(public code: BingFailure, message: string) { super(message); }
}
export const bingDay = (now = new Date()) => now.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
export const hasBingPermission = async () => typeof chrome === 'undefined' || !chrome.permissions ? true : chrome.permissions.contains({ origins: BING_ORIGINS });
/** Call directly in the click handler so Chrome retains the user gesture. */
export async function requestBingPermission(): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.permissions) return true;
  const manifest = chrome.runtime?.getManifest?.();
  if (manifest && !BING_ORIGINS.every(origin => manifest.optional_host_permissions?.includes(origin))) {
    throw new BingWallpaperError('permission', '请先在 Chrome 扩展管理页重新加载 Loci，再开启必应壁纸。');
  }
  try { return await chrome.permissions.request({ origins: BING_ORIGINS }); }
  catch { throw new BingWallpaperError('permission', '无法申请必应访问权限，请重新加载扩展后重试。'); }
}

/** Both Vite development and production preview use the same narrow local proxy. */
export function bingRequestUrl(url: string, pageUrl = location.href): string {
  const page = new URL(pageUrl);
  if (['http:', 'https:'].includes(page.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(page.hostname)) {
    const parsed = new URL(url);
    return `/__loci-bing/${parsed.hostname === 'cn.bing.com' ? 'cn' : 'www'}${parsed.pathname}${parsed.search}`;
  }
  return url;
}
function bingUrl(value: unknown, image = false): string {
  if (typeof value !== 'string') throw new BingWallpaperError('metadata', '必应图片地址无效。');
  const url = new URL(value, 'https://cn.bing.com');
  if (url.protocol !== 'https:' || !['cn.bing.com', 'www.bing.com'].includes(url.hostname) || url.username || url.password || (image && (url.pathname !== '/th' || !url.searchParams.get('id')?.startsWith('OHR.')))) throw new BingWallpaperError('metadata', '必应图片地址无效。');
  return url.href;
}
export function parseBingWallpaper(raw: unknown): Omit<BingWallpaper, 'imageRef' | 'checkedAt' | 'checkedDay'> {
  const item = (raw as { images?: { url?: unknown; title?: unknown; copyright?: unknown; copyrightlink?: unknown; enddate?: unknown; wp?: unknown }[] })?.images?.[0];
  if (!item || item.wp !== true || typeof item.title !== 'string' || typeof item.copyright !== 'string' || typeof item.enddate !== 'string' || !/^\d{8}$/.test(item.enddate)) throw new BingWallpaperError('metadata', '今天的必应图片暂不可用作壁纸。');
  return { url: bingUrl(item.url, true), title: item.title, copyright: item.copyright, source: bingUrl(item.copyrightlink), date: item.enddate };
}
async function readBingWallpaper(): Promise<BingWallpaper | null> {
  const value = await readLocal<BingWallpaper & { dataUrl?: string }>(BING_CACHE_KEY);
  if (!value || !Number.isFinite(value.checkedAt) || value.checkedAt > Date.now() + 60_000 || typeof value.checkedDay !== 'string' || typeof value.title !== 'string' || typeof value.copyright !== 'string' || typeof value.date !== 'string' || !/^\d{8}$/.test(value.date)) return null;
  try { bingUrl(value.url, true); bingUrl(value.source); } catch { return null; }
  try {
    if (isImageRef(value.imageRef)) return await readImage(value.imageRef.slice(ASSET_PREFIX.length)) ? value : null;
    if (typeof value.dataUrl !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(value.dataUrl)) return null;
    // Preserve the old record if either the binary write or metadata commit fails.
    const imageRef = await migrateImage(value.dataUrl, 'bing');
    const { dataUrl: _legacy, ...metadata } = value;
    const next = { ...metadata, imageRef };
    await writeLocal(BING_CACHE_KEY, next);
    return next;
  } catch {
    // Legacy Base64 remains displayable until a later migration can succeed.
    return value.dataUrl?.startsWith('data:image/') ? { ...value, imageRef: value.dataUrl } : null;
  }
}
export function loadBingWallpaper(): Promise<BingWallpaper | null> {
  return withLocalLock('bing-wallpaper', readBingWallpaper);
}
/** Only retry the same resource on the other already-authorized Bing host. */
async function requestBing<T>(url: string, signal: AbortSignal, timeoutMs: number, read: (response: Response) => Promise<T>): Promise<T> {
  const alternate = new URL(url);
  alternate.hostname = alternate.hostname === 'cn.bing.com' ? 'www.bing.com' : 'cn.bing.com';
  let failure: unknown;
  for (const candidate of [url, alternate.href]) {
    signal.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, timeoutMs);
    try {
      const response = await fetch(bingRequestUrl(candidate), { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new BingWallpaperError('network', `必应服务暂时不可用（${response.status}）。`);
      const result = await read(response);
      signal.throwIfAborted();
      return result;
    } catch (error) {
      signal.throwIfAborted();
      failure = error;
    } finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); }
  }
  if (failure instanceof BingWallpaperError && failure.code !== 'network') throw failure;
  throw new BingWallpaperError('network', '必应两条线路均未连接成功，已保留当前壁纸。可点击“重试”。');
}
export async function refreshBingWallpaper(signal: AbortSignal, force = false): Promise<BingWallpaper> {
  return withLocalLock('bing-wallpaper', async () => {
    signal.throwIfAborted();
    if (!await hasBingPermission()) throw new BingWallpaperError('permission', '尚未获得必应访问权限，请点击“授权并重试”。');
    const cached = await readBingWallpaper();
    const age = cached ? Date.now() - cached.checkedAt : Infinity;
    if (cached && age >= 0 && age < (force ? 60_000 : 60 * 60_000) && cached.checkedDay === bingDay()) return cached;
    const metadata = await requestBing(BING_ENDPOINT, signal, 8_000, async response => {
      try { return parseBingWallpaper(await response.json()); }
      catch (error) { if (!(error instanceof SyntaxError)) throw error; throw new BingWallpaperError('metadata', '必应返回的图片信息不完整，请稍后重试。'); }
    });
    let imageRef = cached?.url === metadata.url ? cached.imageRef : '';
    if (!imageRef) {
      const blob = await requestBing(metadata.url, signal, 12_000, async response => {
        const image = await response.blob();
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(image.type) || image.size > 4_000_000 || image.size < 100) throw new BingWallpaperError('image', '必应图片格式或大小不受支持。');
        return image;
      });
      try { imageRef = await saveImageBlob(blob, 'bing'); }
      catch { throw new BingWallpaperError('storage', '图片已下载，但本机图片存储不可用，已保留之前的壁纸。'); }
    }
    signal.throwIfAborted();
    if (!isImageRef(imageRef)) throw new BingWallpaperError('storage', '旧壁纸仍可显示，图片存储暂不可用，请稍后重试。');
    const result = { ...metadata, imageRef, checkedAt: Date.now(), checkedDay: bingDay() };
    try { await writeLocal(BING_CACHE_KEY, result); }
    catch { throw new BingWallpaperError('storage', '图片已下载，但本机存储空间不足，未能保存壁纸。'); }
    // Only remove the previous bytes after metadata safely points at the new image.
    if (isImageRef(imageRef)) {
      const keep = imageRef.slice(ASSET_PREFIX.length);
      await listImages('bing').then(images => deleteImages(images.filter(image => image.id !== keep).map(image => image.id))).catch(() => {});
    }
    return result;
  }, signal);
}
