/** Binary assets live outside the small JSON settings store. Object URLs are never persisted. */
export type ImageKind = 'wallpaper' | 'bing' | 'favicon';
export interface StoredImage { id: string; kind: ImageKind; blob: Blob; savedAt: number; usedAt: number }
export const IMAGE_DB = 'loci-images-v1';
export const ASSET_PREFIX = 'loci-asset:';
export const isImageRef = (value: string | null | undefined): value is string => !!value?.startsWith(ASSET_PREFIX);
let database: Promise<IDBDatabase> | undefined;
function openDatabase(): Promise<IDBDatabase> {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('浏览器无法使用图片存储。')); return; }
    const request = indexedDB.open(IMAGE_DB, 1);
    request.onupgradeneeded = () => { const store = request.result.createObjectStore('images', { keyPath: 'id' }); store.createIndex('kind', 'kind'); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('图片存储正被旧标签页占用，请关闭旧标签页后重试。'));
    request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); database = undefined; }; resolve(db); };
  }).catch(error => { database = undefined; throw error; });
  return database;
}
async function transact<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('images', mode);
    const request = operation(tx.objectStore('images'));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(tx.error ?? request.error ?? new Error('图片保存失败，请检查本机存储空间。'));
  });
}
export const readImage = (id: string) => transact<StoredImage | undefined>('readonly', store => store.get(id));
export const writeImage = (image: StoredImage) => transact('readwrite', store => store.put(image));
export const listImages = (kind: ImageKind) => transact<StoredImage[]>('readonly', store => store.index('kind').getAll(kind));
export async function deleteImages(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('images', 'readwrite');
    const store = tx.objectStore('images');
    ids.forEach(id => store.delete(id));
    tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
export async function saveImageBlob(blob: Blob, kind: 'wallpaper' | 'bing'): Promise<string> {
  const bytes = await blob.arrayBuffer();
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const id = `${kind}:${hash}`;
  if (!await readImage(id)) await writeImage({ id, kind, blob, savedAt: Date.now(), usedAt: Date.now() });
  return ASSET_PREFIX + id;
}
export function dataImageBlob(value: string): Blob {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(value);
  if (!match) throw new Error('旧壁纸数据无法读取，已保留原图。');
  const bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0));
  return new Blob([bytes], { type: match[1] });
}
export async function migrateImage(value: string, kind: 'wallpaper' | 'bing' = 'wallpaper'): Promise<string> {
  return value.startsWith('data:image/') ? saveImageBlob(dataImageBlob(value), kind) : value;
}
export interface ImageLease { url: string; release: () => void }
export function blobLease(blob: Blob): ImageLease {
  const url = URL.createObjectURL(blob); let released = false;
  return { url, release: () => { if (!released) { released = true; URL.revokeObjectURL(url); } } };
}
const live = new Map<string, { count: number; source: Promise<ImageLease> }>();
export async function acquireImage(value: string): Promise<ImageLease> {
  if (!isImageRef(value)) return { url: value, release: () => {} };
  let entry = live.get(value);
  if (!entry) {
    entry = { count: 0, source: readImage(value.slice(ASSET_PREFIX.length)).then(image => {
      if (!image) throw new Error('这张壁纸的本机图片已不可用，请重新选择图片。');
      return blobLease(image.blob);
    }) };
    live.set(value, entry);
  }
  entry.count++;
  let source: ImageLease;
  try { source = await entry.source; }
  catch (error) { if (--entry.count === 0) live.delete(value); throw error; }
  let released = false;
  return { url: source.url, release: () => {
    if (released) return; released = true;
    if (--entry.count === 0) { source.release(); live.delete(value); }
  } };
}
