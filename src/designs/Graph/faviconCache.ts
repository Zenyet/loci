import { bookmarkOriginKey, faviconCandidates } from '../../services/chromeApi';
import { acquireFavicon } from '../../services/faviconStorage';
import type { ImageLease } from '../../services/imageStore';
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
 * Lazily preloads gstatic favicons after the document has fully loaded. `ensureLoaded` triggers a background fetch and calls
 * `onReady` when an image succeeds — use this to request a redraw.
 * `get` returns a ready image or null (draw the letter fallback).
 */
export class FaviconCache {
  private cache = new Map<string, Entry>();
  private origins = new Map<string, string | null>();
  private queue = new Map<string, { pageUrl: string; onReady: () => void }>();
  private leases = new Map<string, ImageLease>();
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

    this.queue.set(key, { pageUrl, onReady });
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
      const [key, { pageUrl, onReady }] = this.queue.entries().next().value!;
      this.queue.delete(key);
      this.set(key, 'loading');
      this.load(pageUrl, key, onReady);
    }
  }

  private set(key: string, entry: Entry): void {
    if (!(entry instanceof HTMLImageElement)) { this.leases.get(key)?.release(); this.leases.delete(key); }
    if (this.cache.has(key)) this.cache.delete(key);
    this.cache.set(key, entry);
    this.trim();
  }

  private trim(): void {
    while (this.cache.size > MAX_FAVICON_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) return;
      this.cache.delete(oldest);
      this.leases.get(oldest)?.release(); this.leases.delete(oldest);
    }
  }

  clear(): void {
    this.cancelPending();
    for (const lease of this.leases.values()) lease.release();
    this.leases.clear(); this.cache.clear();
  }

  private load(pageUrl: string, key: string, onReady: () => void): void {
    const img = new Image();
    img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
    const controller = new AbortController();
    let lease: ImageLease | null = null;
    let settled = false;
    let timeout: number | undefined;
    const finish = (ok: boolean) => {
      if (settled) return; settled = true;
      clearTimeout(timeout); img.onload = img.onerror = null;
      if (ok && isDrawableFaviconImage(img) && lease) {
        this.leases.set(key, lease); this.set(key, img); onReady();
      } else { lease?.release(); img.src = ''; this.set(key, 'error'); }
      this.active.delete(key); this.pump();
    };
    this.active.set(key, () => {
      settled = true; controller.abort(); clearTimeout(timeout);
      img.onload = img.onerror = null; img.src = ''; lease?.release();
    });
    img.onload = () => {
      if (!isDrawableFaviconImage(img)) { finish(false); return; }
      const decoded = typeof img.decode === 'function' ? img.decode() : Promise.resolve();
      decoded.then(() => finish(true), () => finish(false));
    };
    img.onerror = () => finish(false);
    void acquireFavicon(pageUrl, controller.signal).then(source => {
      if (settled) { source?.release(); return; }
      if (!source) { finish(false); return; }
      lease = source;
      timeout = window.setTimeout(() => finish(false), FAVICON_ATTEMPT_TIMEOUT_MS);
      img.src = source.url;
    }).catch(() => finish(false));
  }
}
