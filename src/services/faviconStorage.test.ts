import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setupImageStorage } from '../test/imageStorage';
import { readImage, writeImage } from './imageStore';
import { acquireFavicon, clearFaviconCache, faviconCacheStats, FAVICON_ORIGIN, requestFaviconPermission, saveFaviconPreferences } from './faviconStorage';
const enabled = { enabled: true, days: 30, maxMB: 20 };
const source = 'https://example.com';
const controller = () => new AbortController();
const picture = () => new Blob([new Uint8Array(100)], { type: 'image/png' });
beforeEach(async () => {
  localStorage.clear(); await setupImageStorage();
  vi.stubGlobal('location', { href: 'chrome-extension://loci/index.html' });
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 32, height: 32, close: vi.fn() })));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => picture() })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('deduplicates domains, persists binary images and loads them without another network request', async () => {
  await saveFaviconPreferences(enabled);
  const [a, b] = await Promise.all([acquireFavicon(`${source}/one?secret=1`, controller().signal), acquireFavicon(`${source}/two`, controller().signal)]);
  expect(fetch).toHaveBeenCalledOnce(); expect(a?.url).toMatch(/^blob:/); expect(b?.url).toMatch(/^blob:/);
  expect(String(vi.mocked(fetch).mock.calls[0][0])).not.toContain('secret');
  a?.release(); b?.release();
  const c = await acquireFavicon(source, controller().signal); c?.release();
  expect(fetch).toHaveBeenCalledOnce(); expect(await faviconCacheStats()).toEqual({ count: 1, bytes: 100 });
  expect(localStorage.getItem('loci-favicon-cache-settings-v1')).not.toContain('base64');
});
it('uses online URLs with caching disabled and skips private hosts entirely', async () => {
  const online = await acquireFavicon(source, controller().signal);
  expect(new URL(online!.url).hostname).toBe('t0.gstatic.cn');
  await saveFaviconPreferences(enabled);
  for (const url of ['http://localhost/a', 'http://192.168.1.1', 'https://company.internal', 'file:///tmp/a']) expect(await acquireFavicon(url, controller().signal)).toBeNull();
  expect(fetch).not.toHaveBeenCalled(); expect((await faviconCacheStats()).count).toBe(0);
});
it('retains an expired cached image when offline, without changing its freshness', async () => {
  await saveFaviconPreferences(enabled);
  await writeImage({ id: `favicon:${source}`, kind: 'favicon', blob: picture(), savedAt: 1, usedAt: 1 });
  vi.mocked(fetch).mockRejectedValue(new Error('offline'));
  const cached = await acquireFavicon(source, controller().signal);
  expect(cached?.url).toMatch(/^blob:/); cached?.release();
  expect((await readImage(`favicon:${source}`))?.savedAt).toBe(1);
});
it('does not cache invalid content or oversized decoded images', async () => {
  await saveFaviconPreferences(enabled);
  vi.mocked(fetch).mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['html'], { type: 'text/html' }) } as Response);
  const first = await acquireFavicon(source, controller().signal); first?.release();
  vi.mocked(createImageBitmap).mockResolvedValueOnce({ width: 1000, height: 1000, close: vi.fn() } as unknown as ImageBitmap);
  const second = await acquireFavicon('https://large.test', controller().signal); second?.release();
  expect(await faviconCacheStats()).toEqual({ count: 0, bytes: 0 });
});
it('evicts the least recently used images when the capacity is lowered', async () => {
  const blob = new Blob([new Uint8Array(3 * 1024 * 1024)], { type: 'image/png' });
  await writeImage({ id: 'favicon:older', kind: 'favicon', blob, savedAt: 1, usedAt: 1 });
  await writeImage({ id: 'favicon:newer', kind: 'favicon', blob, savedAt: 2, usedAt: 2 });
  await saveFaviconPreferences({ ...enabled, maxMB: 5 });
  expect(await readImage('favicon:older')).toBeUndefined(); expect(await readImage('favicon:newer')).toBeDefined();
});
it('does not repopulate a cleared cache with an already running download', async () => {
  await saveFaviconPreferences(enabled);
  let done!: (response: Response) => void;
  const requested = new Promise<void>(resolve => vi.mocked(fetch).mockImplementationOnce(() => { resolve(); return new Promise<Response>(accept => { done = accept; }); }));
  const pending = acquireFavicon(source, controller().signal); await requested;
  await clearFaviconCache();
  done({ ok: true, blob: async () => picture() } as Response);
  const image = await pending; image?.release();
  expect(await faviconCacheStats()).toEqual({ count: 0, bytes: 0 });
});
it('releases cancelled consumers and never writes their abandoned download', async () => {
  await saveFaviconPreferences(enabled);
  const c = controller();
  const requested = new Promise<void>(resolve => vi.mocked(fetch).mockImplementationOnce((_url, init) => {
    resolve(); return new Promise((_yes, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('abort'))));
  }));
  const pending = acquireFavicon(source, c.signal); const rejected = expect(pending).rejects.toThrow(); await requested; c.abort(); await rejected;
  expect((await faviconCacheStats()).count).toBe(0);
});
it('uses cached images after permission is revoked and never downloads new ones', async () => {
  await saveFaviconPreferences(enabled);
  await writeImage({ id: `favicon:${source}`, kind: 'favicon', blob: picture(), savedAt: 1, usedAt: 1 });
  vi.stubGlobal('chrome', { permissions: { contains: async () => false } });
  const cached = await acquireFavicon(source, controller().signal); cached?.release();
  const uncached = await acquireFavicon('https://uncached.test', controller().signal); uncached?.release();
  expect(cached?.url).toMatch(/^blob:/); expect(uncached?.url).toMatch(/^https:\/\/t0.gstatic.cn/); expect(fetch).not.toHaveBeenCalled();
});
it('requests only the optional icon host from an explicit user action', async () => {
  const request = vi.fn(async () => true);
  vi.stubGlobal('chrome', { permissions: { request }, runtime: { getManifest: () => ({ optional_host_permissions: [] }) } });
  await expect(requestFaviconPermission()).rejects.toThrow('重新加载 Loci'); expect(request).not.toHaveBeenCalled();
  vi.stubGlobal('chrome', { permissions: { request }, runtime: { getManifest: () => ({ optional_host_permissions: [FAVICON_ORIGIN] }) } });
  expect(await requestFaviconPermission()).toBe(true); expect(request).toHaveBeenCalledWith({ origins: [FAVICON_ORIGIN] });
});
it('limits downloads to six and cancels queued requests when their views disappear', async () => {
  await saveFaviconPreferences(enabled);
  let started = 0; let six!: () => void;
  const ready = new Promise<void>(resolve => { six = resolve; });
  vi.mocked(fetch).mockImplementation((_url, init) => {
    if (++started === 6) six();
    return new Promise((_yes, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('abort'))));
  });
  const controllers = Array.from({ length: 20 }, controller);
  const jobs = controllers.map((c, i) => acquireFavicon(`https://site${i}.test`, c.signal));
  const settled = Promise.allSettled(jobs);
  await ready; controllers.forEach(c => c.abort());
  expect((await settled).every(result => result.status === 'rejected')).toBe(true);
  expect(started).toBe(6); expect((await faviconCacheStats()).count).toBe(0);
});
