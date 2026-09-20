import { bookmarkOriginKey, faviconCandidates } from '../../services/chromeApi';
import { scheduleAfterDocumentLoad } from '../../utils/scheduleAfterDocumentLoad';

type Entry = HTMLImageElement | 'loading' | 'error';

/** Abandon one URL and try the next when the request hangs (e.g. filtered network). */
const FAVICON_ATTEMPT_TIMEOUT_MS = 8000;
const MIN_FAVICON_SIDE = 8;
const MAX_FAVICON_SIDE = 192;
const MAX_FAVICON_CACHE_ENTRIES = 384;
const MAX_CONCURRENT_LOADS = 6;

export function isDrawableFaviconImage(img: HTMLImageElement): boolean {
  return (
    img.complete &&
    img.naturalWidth >= MIN_FAVICON_SIDE &&
    img.naturalHeight >= MIN_FAVICON_SIDE &&
    img.naturalWidth <= MAX_FAVICON_SIDE &&
    img.naturalHeight <= MAX_FAVICON_SIDE
  );
}

/**
 * Lazily preloads site favicons after the document has fully loaded, trying
 * common paths in order. `ensureLoaded` triggers a background fetch and calls
 * `onReady` when an image succeeds — use this to request a redraw.
 * `get` returns a ready image or null (draw the letter fallback).
 */
export class FaviconCache {
  private cache = new Map<string, Entry>();
  private origins = new Map<string, string | null>();
  private queue = new Map<string, { urls: string[]; onReady: () => void }>();
  private active = new Map<string, () => void>();
  private cancelScheduled: (() => void) | null = null;
  private documentReady = false;

  private origin(pageUrl: string): string | null {
    if (this.origins.has(pageUrl)) return this.origins.get(pageUrl)!;
    const key = bookmarkOriginKey(pageUrl);
    if (this.origins.size >= 4096) this.origins.delete(this.origins.keys().next().value!);
    this.origins.set(pageUrl, key);
    return key;
  }

  get(pageUrl: string): HTMLImageElement | null {
    const key = this.origin(pageUrl);
    if (!key) return null;
    const entry = this.cache.get(key);
    if (!(entry instanceof HTMLImageElement)) return null;
    if (isDrawableFaviconImage(entry)) {
      this.set(key, entry);
      return entry;
    }
    this.set(key, 'error');
    return null;
  }

  markBroken(pageUrl: string): void {
    const key = this.origin(pageUrl);
    if (!key) return;
    this.set(key, 'error');
    this.queue.delete(key);
    this.active.get(key)?.();
    this.active.delete(key);
    this.pump();
  }

  ensureLoaded(pageUrl: string, onReady: () => void): void {
    const key = this.origin(pageUrl);
    if (!key) return;
    if (this.cache.has(key) || this.queue.has(key) || this.active.has(key)) return;

    const urls = faviconCandidates(pageUrl);
    if (urls.length === 0) return;

    this.queue.set(key, { urls, onReady });
    if (this.documentReady) this.pump();
    else if (!this.cancelScheduled) {
      this.cancelScheduled = scheduleAfterDocumentLoad(() => {
        this.cancelScheduled = null;
        this.documentReady = true;
        this.pump();
      });
    }
  }

  /** Navigation/unmount must not leave hundreds of fetches and timers alive. */
  cancelPending(): void {
    this.cancelScheduled?.();
    this.cancelScheduled = null;
    this.queue.clear();
    for (const [key, cancel] of this.active) {
      cancel();
      if (this.cache.get(key) === 'loading') this.cache.delete(key);
    }
    this.active.clear();
  }

  private pump(): void {
    if (!this.documentReady) return;
    while (this.active.size < MAX_CONCURRENT_LOADS && this.queue.size) {
      const [key, { urls, onReady }] = this.queue.entries().next().value!;
      this.queue.delete(key);
      this.set(key, 'loading');
      this.tryUrls(urls, key, onReady);
    }
  }

  private set(key: string, entry: Entry): void {
    if (this.cache.has(key)) this.cache.delete(key);
    this.cache.set(key, entry);
    this.trim();
  }

  private trim(): void {
    while (this.cache.size > MAX_FAVICON_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) return;
      this.cache.delete(oldest);
    }
  }

  private tryUrls(urls: string[], key: string, onReady: () => void, index = 0): void {
    const url = urls[index];
    const img = new Image();
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';

    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const finish = (next: 'ok' | 'retry') => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      img.onload = null;
      img.onerror = null;
      if (next === 'ok' && isDrawableFaviconImage(img)) {
        this.set(key, img);
        this.active.delete(key);
        onReady();
        this.pump();
        return;
      }
      img.src = '';
      if (index + 1 >= urls.length) {
        this.set(key, 'error');
        this.active.delete(key);
        this.pump();
      }
      else this.tryUrls(urls, key, onReady, index + 1);
    };

    timeoutId = window.setTimeout(() => finish('retry'), FAVICON_ATTEMPT_TIMEOUT_MS);

    img.onload = () => {
      if (!isDrawableFaviconImage(img)) {
        finish('retry');
        return;
      }
      const decoded =
        typeof img.decode === 'function' ? img.decode() : Promise.resolve();
      decoded.then(() => finish('ok'), () => finish('retry'));
    };
    img.onerror = () => finish('retry');

    this.active.set(key, () => {
      settled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      img.onload = img.onerror = null;
      img.src = '';
    });

    img.src = url;
  }
}
