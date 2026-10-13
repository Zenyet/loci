import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BING_CACHE_KEY, BING_ENDPOINT, BING_ORIGINS, bingDay, bingRequestUrl, loadBingWallpaper, parseBingWallpaper, refreshBingWallpaper, requestBingPermission } from './bingWallpaper';
import { setupImageStorage } from '../test/imageStorage';
import { ASSET_PREFIX, listImages, readImage, saveImageBlob } from './imageStore';
import { writeLocal } from './localStore';
const raw = { images: [{ url: '/th?id=OHR.Example_ZH-CN123_1920x1080.jpg', title: '今日风景', copyright: '© Example', copyrightlink: 'https://www.bing.com/search?q=example', enddate: '20261012', wp: true }] };
const saved = async () => ({ ...parseBingWallpaper(raw), imageRef: await saveImageBlob(new Blob([new Uint8Array(200)], { type: 'image/jpeg' }), 'bing'), checkedAt: Date.now(), checkedDay: bingDay() });
beforeEach(async () => { await setupImageStorage(); localStorage.clear(); vi.stubGlobal('location', { href: 'chrome-extension://loci/index.html' }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('accepts only Bing-hosted wallpaper images and retains attribution', () => {
  expect(parseBingWallpaper(raw)).toMatchObject({ title: '今日风景', copyright: '© Example', url: 'https://cn.bing.com/th?id=OHR.Example_ZH-CN123_1920x1080.jpg' });
  for (const patch of [{ url: 'https://evil.test/th?id=OHR.a' }, { copyrightlink: 'javascript:alert(1)' }, { wp: false }]) expect(() => parseBingWallpaper({ images: [{ ...raw.images[0], ...patch }] })).toThrow();
});
it('reuses today’s local image without downloading again and rejects corrupt cache', async () => {
  vi.stubGlobal('fetch', vi.fn()); const cache = await saved(); await writeLocal(BING_CACHE_KEY, cache);
  expect(await refreshBingWallpaper(new AbortController().signal)).toEqual(cache); expect(fetch).not.toHaveBeenCalled();
  await writeLocal(BING_CACHE_KEY, { ...cache, imageRef: 'javascript:alert(1)' }); expect(await loadBingWallpaper()).toBeNull();
});
it('refreshes metadata on a new day and reuses unchanged image bytes', async () => {
  await writeLocal(BING_CACHE_KEY, { ...await saved(), checkedDay: '2000-01-01' });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(raw), { status: 200 })));
  const next = await refreshBingWallpaper(new AbortController().signal);
  expect(fetch).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledWith(BING_ENDPOINT, expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer' }));
  expect(next.checkedDay).toBe(bingDay()); expect(next.imageRef).toMatch(/^loci-asset:bing:/);
});
it('downloads and caches a new image once for simultaneous callers', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => raw }).mockResolvedValueOnce({ ok: true, blob: async () => new Blob([new Uint8Array(200)], { type: 'image/jpeg' }) });
  vi.stubGlobal('fetch', fetcher);
  const [first, second] = await Promise.all([refreshBingWallpaper(new AbortController().signal), refreshBingWallpaper(new AbortController().signal)]);
  expect(first).toEqual(second); expect(first.imageRef).toMatch(/^loci-asset:bing:/);
  expect((await readImage(first.imageRef.slice(ASSET_PREFIX.length)))!.blob.size).toBe(200);
  expect(fetcher).toHaveBeenCalledTimes(2); expect(await loadBingWallpaper()).toEqual(first);
});
it('rejects a non-image response without replacing the saved wallpaper', async () => {
  const cache = { ...await saved(), checkedDay: '2000-01-01' }; await writeLocal(BING_CACHE_KEY, cache);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ images: [{ ...raw.images[0], url: '/th?id=OHR.Other.jpg' }] }) }).mockResolvedValue({ ok: true, blob: async () => new Blob(['<html>unavailable</html>'], { type: 'text/html' }) }));
  await expect(refreshBingWallpaper(new AbortController().signal)).rejects.toThrow('格式或大小');
  expect(await loadBingWallpaper()).toEqual(cache);
});
it('preserves the previous image offline and makes no request without permission', async () => {
  const cache = { ...await saved(), checkedDay: '2000-01-01' }; await writeLocal(BING_CACHE_KEY, cache);
  const fetcher = vi.fn(async () => { throw new Error('offline'); }); vi.stubGlobal('fetch', fetcher);
  await expect(refreshBingWallpaper(new AbortController().signal)).rejects.toThrow(); expect(await loadBingWallpaper()).toEqual(cache);
  fetcher.mockClear(); vi.stubGlobal('chrome', { permissions: { contains: vi.fn(async () => false) } });
  await expect(refreshBingWallpaper(new AbortController().signal)).rejects.toMatchObject({ code: 'permission' }); expect(fetcher).not.toHaveBeenCalled();
});
it('uses local proxies in both development and built preview, but direct URLs in the extension', () => {
  expect(bingRequestUrl(BING_ENDPOINT, 'http://127.0.0.1:4173/')).toBe('/__loci-bing/cn/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN');
  expect(bingRequestUrl('https://www.bing.com/th?id=OHR.a', 'http://localhost:5174/')).toBe('/__loci-bing/www/th?id=OHR.a');
  expect(bingRequestUrl(BING_ENDPOINT, 'chrome-extension://loci/index.html')).toBe(BING_ENDPOINT);
});
it('recovers from a failed mainland endpoint and failed image request on the alternate Bing host', async () => {
  const fetcher = vi.fn()
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce({ ok: true, json: async () => raw })
    .mockResolvedValueOnce({ ok: false, status: 503 })
    .mockResolvedValueOnce({ ok: true, blob: async () => new Blob([new Uint8Array(200)], { type: 'image/jpeg' }) });
  vi.stubGlobal('fetch', fetcher);
  const result = await refreshBingWallpaper(new AbortController().signal);
  expect(fetcher.mock.calls.map(call => new URL(call[0]).hostname)).toEqual(['cn.bing.com', 'www.bing.com', 'cn.bing.com', 'www.bing.com']);
  expect(result.imageRef).toMatch(/^loci-asset:bing:/);
});
it('falls back after a per-host timeout and stops before fallback when cancelled', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  await writeLocal(BING_CACHE_KEY, { ...await saved(), checkedDay: '2000-01-01' });
  const hang = (_url: string, { signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
  const fetcher = vi.fn().mockImplementationOnce(hang).mockResolvedValueOnce({ ok: true, json: async () => raw });
  vi.stubGlobal('fetch', fetcher);
  const result = refreshBingWallpaper(new AbortController().signal);
  await vi.advanceTimersByTimeAsync(8000);
  expect((await result).title).toBe('今日风景'); expect(fetcher).toHaveBeenCalledTimes(2);
  await writeLocal(BING_CACHE_KEY, { ...await saved(), checkedDay: '2000-01-01' });
  fetcher.mockReset().mockImplementation(hang);
  const controller = new AbortController(); const pending = refreshBingWallpaper(controller.signal);
  const rejected = expect(pending).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(1); controller.abort(); await rejected;
  expect(fetcher).toHaveBeenCalledOnce();
});
it('requests permissions from a user action and distinguishes an extension that needs reloading', async () => {
  const request = vi.fn(async () => true);
  vi.stubGlobal('chrome', { permissions: { request }, runtime: { getManifest: () => ({ optional_host_permissions: [] }) } });
  await expect(requestBingPermission()).rejects.toThrow('重新加载 Loci'); expect(request).not.toHaveBeenCalled();
  vi.stubGlobal('chrome', { permissions: { request }, runtime: { getManifest: () => ({ optional_host_permissions: BING_ORIGINS }) } });
  expect(await requestBingPermission()).toBe(true); expect(request).toHaveBeenCalledWith({ origins: BING_ORIGINS });
});
it('does not fetch or overwrite cache after cancellation', async () => {
  const cache = await saved(); await writeLocal(BING_CACHE_KEY, cache); vi.stubGlobal('fetch', vi.fn());
  const controller = new AbortController(); controller.abort();
  await expect(refreshBingWallpaper(controller.signal)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled(); expect(await loadBingWallpaper()).toEqual(cache);
});

it('migrates legacy Base64 atomically and keeps only the latest Bing image after refresh', async () => {
  await writeLocal(BING_CACHE_KEY, { ...parseBingWallpaper(raw), dataUrl: 'data:image/jpeg;base64,AAAA', checkedAt: Date.now(), checkedDay: '2000-01-01' });
  const migrated = await loadBingWallpaper();
  expect(migrated?.imageRef).toMatch(/^loci-asset:bing:/);
  expect(localStorage.getItem(BING_CACHE_KEY)).not.toContain('base64');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ images: [{ ...raw.images[0], url: '/th?id=OHR.New.jpg' }] }) }).mockResolvedValueOnce({ ok: true, blob: async () => new Blob([new Uint8Array(300)], { type: 'image/jpeg' }) }));
  const next = await refreshBingWallpaper(new AbortController().signal);
  expect(next.imageRef).not.toBe(migrated?.imageRef);
  expect(await listImages('bing')).toHaveLength(1);
});
