import { Blob as NodeBlob } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { indexedDB } from 'fake-indexeddb';
import { vi } from 'vitest';
import { deleteImages, listImages } from '../services/imageStore';
export async function setupImageStorage() {
  vi.stubGlobal('indexedDB', indexedDB);
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => `blob:test-${crypto.randomUUID()}`);
    static revokeObjectURL = vi.fn();
  });
  for (const kind of ['wallpaper', 'bing', 'favicon'] as const) await deleteImages((await listImages(kind)).map(image => image.id));
}
