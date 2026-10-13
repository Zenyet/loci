import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { acquireImage, ASSET_PREFIX, dataImageBlob, listImages, readImage, saveImageBlob, writeImage } from './imageStore';
import { loadSettings, saveSettings } from './chromeApi';
import { loadUserBackgrounds, saveUserBackground, removeUserBackground } from './userBackgrounds';
import { collectUnusedWallpapers } from './wallpaperStorage';
import { setupImageStorage } from '../test/imageStorage';
import { DEFAULT_SETTINGS } from '../types';
beforeEach(async () => { localStorage.clear(); await setupImageStorage(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const legacy = 'data:image/png;base64,AQIDBA==';
it('deduplicates uploaded/legacy bytes and releases shared object URLs after the last view', async () => {
  const blob = dataImageBlob(legacy);
  const first = await saveImageBlob(blob, 'wallpaper');
  expect(await saveImageBlob(blob, 'wallpaper')).toBe(first);
  expect(await listImages('wallpaper')).toHaveLength(1);
  const [a, b] = await Promise.all([acquireImage(first), acquireImage(first)]);
  expect(a.url).toBe(b.url); expect(URL.createObjectURL).toHaveBeenCalledOnce();
  a.release(); a.release(); expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  b.release(); expect(URL.revokeObjectURL).toHaveBeenCalledWith(a.url);
  const c = await acquireImage(first); expect(c.url).not.toBe(a.url); c.release();
});
it('migrates settings and saved presets without retaining Base64 or duplicating bytes', async () => {
  localStorage.setItem('newtab-settings', JSON.stringify({ ...DEFAULT_SETTINGS, bgImage: legacy }));
  localStorage.setItem('newtab-user-backgrounds', JSON.stringify([{ id: 'old', label: '旧壁纸', value: legacy }]));
  const [settings, presets] = await Promise.all([loadSettings(), loadUserBackgrounds()]);
  expect(settings.bgImage).toMatch(/^loci-asset:wallpaper:/);
  expect(presets[0].value).toBe(settings.bgImage);
  expect(localStorage.getItem('newtab-settings')).not.toContain('base64');
  expect(localStorage.getItem('newtab-user-backgrounds')).not.toContain('base64');
  expect(await listImages('wallpaper')).toHaveLength(1);
  await saveSettings({ ...settings, accentHue: 90 });
  expect((await loadSettings()).bgImage).toBe(settings.bgImage);
});
it('preserves legacy data when the binary transaction fails', async () => {
  localStorage.setItem('newtab-settings', JSON.stringify({ ...DEFAULT_SETTINGS, bgImage: legacy }));
  vi.spyOn(crypto.subtle, 'digest').mockRejectedValueOnce(new Error('quota'));
  expect((await loadSettings()).bgImage).toBe(legacy);
  expect(JSON.parse(localStorage.getItem('newtab-settings')!).bgImage).toBe(legacy);
});
it('does not delete referenced wallpapers or a concurrent upload, and collects old orphaned bytes', async () => {
  const ref = await saveImageBlob(dataImageBlob(legacy), 'wallpaper');
  await saveSettings({ ...DEFAULT_SETTINGS, bgImage: ref });
  const presets = await saveUserBackground({ value: ref, label: '保留' });
  const original = (await readImage(ref.slice(ASSET_PREFIX.length)))!;
  await writeImage({ ...original, savedAt: 1 });
  const orphan = { ...original, id: 'wallpaper:orphan', savedAt: 1 }; await writeImage(orphan);
  await writeImage({ ...original, id: 'wallpaper:uploading', savedAt: Date.now() });
  await removeUserBackground(presets[0].id);
  await collectUnusedWallpapers();
  expect(await readImage(original.id)).toBeDefined(); expect(await readImage(orphan.id)).toBeUndefined();
  expect(await readImage('wallpaper:uploading')).toBeDefined();
});
it('serializes simultaneous preset changes without losing another tab’s data', async () => {
  await Promise.all([saveUserBackground({ label: '一', value: 'https://example.com/one.jpg' }), saveUserBackground({ label: '二', value: 'https://example.com/two.jpg' })]);
  expect((await loadUserBackgrounds()).map(bg => bg.label).sort()).toEqual(['一', '二']);
});
