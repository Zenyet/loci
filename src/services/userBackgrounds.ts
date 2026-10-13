/** Named presets keep lightweight image references; picture bytes live in IndexedDB. */
import { migrateImage } from './imageStore';
import { readLocal, subscribeLocal, withLocalLock, writeLocal } from './localStore';
import { collectUnusedWallpapers, USER_BACKGROUNDS_KEY as KEY, WALLPAPER_LOCK } from './wallpaperStorage';
export interface UserBackground { id: string; label: string; value: string }
export const MAX_USER_BACKGROUNDS = 12;
async function read(): Promise<UserBackground[]> {
  const raw = await readLocal<UserBackground[]>(KEY);
  return Array.isArray(raw) ? raw.filter(bg => typeof bg?.id === 'string' && typeof bg.label === 'string' && typeof bg.value === 'string') : [];
}
async function migrate(list: UserBackground[]): Promise<UserBackground[]> {
  return Promise.all(list.map(async bg => {
    try { return { ...bg, value: await migrateImage(bg.value) }; } catch { return bg; }
  }));
}
export async function loadUserBackgrounds(): Promise<UserBackground[]> {
  return withLocalLock(WALLPAPER_LOCK, async () => {
    const raw = await read(); const next = await migrate(raw);
    if (next.some((bg, index) => bg.value !== raw[index].value)) {
      try { await writeLocal(KEY, next); } catch { return raw; }
    }
    await collectUnusedWallpapers().catch(() => {});
    return next;
  });
}
async function mutate(change: (list: UserBackground[]) => Promise<UserBackground[]> | UserBackground[]): Promise<UserBackground[]> {
  return withLocalLock(WALLPAPER_LOCK, async () => {
    const next = await change(await migrate(await read()));
    await writeLocal(KEY, next);
    await collectUnusedWallpapers().catch(() => {});
    return next;
  });
}
export function saveUserBackground(bg: Omit<UserBackground, 'id'>): Promise<UserBackground[]> {
  return mutate(async list => [{ id: `ub-${crypto.randomUUID()}`, label: bg.label.trim() || '未命名', value: await migrateImage(bg.value) }, ...list].slice(0, MAX_USER_BACKGROUNDS));
}
export const removeUserBackground = (id: string) => mutate(list => list.filter(bg => bg.id !== id));
export const renameUserBackground = (id: string, label: string) => mutate(list => list.map(bg => bg.id === id ? { ...bg, label: label.trim() || bg.label } : bg));
export function subscribeUserBackgrounds(cb: (list: UserBackground[]) => void): () => void {
  let alive = true;
  const unsubscribe = subscribeLocal(KEY, () => { void loadUserBackgrounds().then(list => { if (alive) cb(list); }).catch(() => {}); });
  return () => { alive = false; unsubscribe(); };
}
