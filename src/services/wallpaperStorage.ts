import { ASSET_PREFIX, deleteImages, isImageRef, listImages, migrateImage } from './imageStore';
import { readLocal, withLocalLock, writeLocal } from './localStore';
export const WALLPAPER_LOCK = 'wallpaper-data';
export const USER_BACKGROUNDS_KEY = 'newtab-user-backgrounds';
const SETTINGS_KEY = 'newtab-settings';
/** Rewrite only after the binary image is safely committed. A failed migration keeps the original. */
export async function migrateWallpaperSettings<T extends { bgImage?: string | null }>(settings: T): Promise<T> {
  if (!settings.bgImage?.startsWith('data:image/')) return settings;
  try { return { ...settings, bgImage: await migrateImage(settings.bgImage) }; }
  catch { return settings; }
}
export async function readWallpaperSettings<T extends { bgImage?: string | null }>(): Promise<T | undefined> {
  return withLocalLock(WALLPAPER_LOCK, async () => {
    const raw = await readLocal<T>(SETTINGS_KEY);
    if (!raw) return raw;
    const next = await migrateWallpaperSettings(raw);
    if (next !== raw) {
      try { await writeLocal(SETTINGS_KEY, next); } catch { return raw; }
    }
    return next;
  });
}
export async function saveWallpaperSettings<T extends { bgImage?: string | null }>(settings: T): Promise<void> {
  await withLocalLock(WALLPAPER_LOCK, async () => {
    await writeLocal(SETTINGS_KEY, await migrateWallpaperSettings(settings));
    await collectUnusedWallpapers().catch(() => {});
  });
}
/** Call under WALLPAPER_LOCK. A grace period protects uploads in other tabs before settings are committed. */
export async function collectUnusedWallpapers(): Promise<void> {
  const settings = await readLocal<{ bgImage?: string }>(SETTINGS_KEY);
  const presets = await readLocal<{ value: string }[]>(USER_BACKGROUNDS_KEY);
  const references = new Set([settings?.bgImage, ...(Array.isArray(presets) ? presets.map(bg => bg.value) : [])].filter(isImageRef).map(ref => ref.slice(ASSET_PREFIX.length)));
  const images = await listImages('wallpaper');
  await deleteImages(images.filter(image => !references.has(image.id) && image.savedAt < Date.now() - 24 * 60 * 60_000).map(image => image.id));
}
