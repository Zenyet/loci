import { afterEach, describe, expect, it, vi } from 'vitest';
import { FaviconCache, isDrawableFaviconImage } from './faviconCache';

function image(overrides: Partial<HTMLImageElement> = {}): HTMLImageElement {
  return {
    complete: true,
    naturalWidth: 16,
    naturalHeight: 16,
    ...overrides,
  } as HTMLImageElement;
}

describe('isDrawableFaviconImage', () => {
  it('accepts loaded icons with usable dimensions', () => {
    expect(isDrawableFaviconImage(image())).toBe(true);
  });

  it('rejects unloaded or broken icons', () => {
    expect(isDrawableFaviconImage(image({ complete: false }))).toBe(false);
    expect(isDrawableFaviconImage(image({ naturalWidth: 0 }))).toBe(false);
    expect(isDrawableFaviconImage(image({ naturalHeight: 0 }))).toBe(false);
  });

  it('rejects oversized images that would waste decoded memory', () => {
    expect(isDrawableFaviconImage(image({ naturalWidth: 512 }))).toBe(false);
    expect(isDrawableFaviconImage(image({ naturalHeight: 512 }))).toBe(false);
  });
});

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('limits concurrent icon requests, deduplicates origins, and cancels pending work', async () => {
  vi.useFakeTimers();
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
  const images: HTMLImageElement[] = [];
  vi.stubGlobal('Image', class {
    src = ''; onload: (() => void) | null = null; onerror = null;
    complete = true; naturalWidth = 32; naturalHeight = 32;
    decode = () => Promise.resolve();
    constructor() { images.push(this as unknown as HTMLImageElement); }
  });
  const cache = new FaviconCache(), ready = vi.fn();
  for (let i = 0; i < 100; i++) {
    cache.ensureLoaded(`https://site${i}.test/a`, ready);
    cache.ensureLoaded(`https://site${i}.test/b`, ready);
  }
  expect(images).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(200);
  expect(images).toHaveLength(6);
  images[0].onload?.(new Event('load'));
  await Promise.resolve();
  expect(ready).toHaveBeenCalledOnce();
  expect(images).toHaveLength(7);
  // A late decode must not revive an unmounted graph's requests or callbacks.
  images[1].onload?.(new Event('load'));
  cache.cancelPending();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(60000);
  expect(images).toHaveLength(7);
  expect(ready).toHaveBeenCalledOnce();
  expect(images.slice(1).every(img => img.src === '')).toBe(true);
  cache.ensureLoaded('https://site1.test/a', ready);
  expect(images).toHaveLength(8);
  cache.cancelPending();
});

it('cancels the deferred load before it creates any images', async () => {
  vi.useFakeTimers();
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
  const createImage = vi.fn();
  vi.stubGlobal('Image', createImage);
  const cache = new FaviconCache();
  cache.ensureLoaded('https://site.test/', vi.fn());
  cache.cancelPending();
  await vi.advanceTimersByTimeAsync(1000);
  expect(createImage).not.toHaveBeenCalled();
});
