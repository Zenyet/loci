export interface SpriteBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Sprite {
  canvas: HTMLCanvasElement;
  density: number;
  pixels: number;
  used: number;
}

/** Cache expensive shadows, gradients and text, not whole viewport snapshots.
 * Raster memory is bounded separately from the main canvas. Entries touched
 * in the previous frame cannot evict each other, even in an oversized scene.
 */
export class RenderSpriteCache {
  private entries = new Map<string, Sprite>();
  private pixels = 0;
  private frame = 0;
  private rasterMs = 0;
  private admissionBlocked = false;
  private deferred = false;
  private sources = new WeakMap<object, number>();
  private nextSource = 0;

  constructor(
    private readonly maxPixels = 8_000_000,
    private readonly maxEntries = 2048,
    private readonly createCanvas = () => document.createElement('canvas'),
  ) {}

  beginFrame(): void {
    this.frame++;
    this.rasterMs = 0;
    this.admissionBlocked = false;
    this.deferred = false;
  }

  sourceId(source: object): number {
    let id = this.sources.get(source);
    if (id === undefined) { id = ++this.nextSource; this.sources.set(source, id); }
    return id;
  }

  get stats() { return { entries: this.entries.size, pixels: this.pixels }; }
  get needsRefinement() { return this.deferred && !this.admissionBlocked; }

  clear(): void {
    for (const sprite of this.entries.values()) this.release(sprite);
    this.entries.clear();
  }

  private release(sprite: Sprite): void {
    this.pixels -= sprite.pixels;
    // Release the backing store immediately instead of waiting for GC.
    sprite.canvas.width = sprite.canvas.height = 0;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    key: string,
    x: number,
    y: number,
    bounds: SpriteBounds,
    pixelScale: number,
    paint: (ctx: CanvasRenderingContext2D) => void,
  ): boolean {
    let sprite = this.entries.get(key);
    // Discrete resolutions avoid rebuilding at every wheel tick. Downsize only
    // under memory pressure so zooming out does not strand the budget in a few
    // oversized textures while hundreds of newly visible labels miss the cache.
    const density = Math.min(6, Math.max(1, Math.ceil(pixelScale)));
    const oversized = sprite && sprite.density > density && this.pixels > this.maxPixels * .7;
    if ((!sprite || sprite.density < density) && this.rasterMs >= 2) this.deferred = true;
    if ((!sprite || sprite.density < density || oversized) && this.rasterMs < 2 &&
        (!this.admissionBlocked || oversized)) {
      const started = performance.now();
      const width = Math.ceil(bounds.width * density);
      const height = Math.ceil(bounds.height * density);
      const pixels = width * height;
      if (pixels <= this.maxPixels) {
        for (const [oldKey, old] of this.entries) {
          if (this.pixels - (sprite?.pixels ?? 0) + pixels <= this.maxPixels &&
              (sprite || this.entries.size < this.maxEntries)) break;
          if (old === sprite || old.used >= this.frame - 1) continue;
          this.entries.delete(oldKey);
          this.release(old);
        }
        if (this.pixels - (sprite?.pixels ?? 0) + pixels <= this.maxPixels &&
            (sprite || this.entries.size < this.maxEntries)) {
          const canvas = this.createCanvas();
          canvas.width = width;
          canvas.height = height;
          const target = canvas.getContext('2d');
          if (target) {
            target.setTransform(density, 0, 0, density, -bounds.x * density, -bounds.y * density);
            paint(target);
            if (sprite) this.release(sprite);
            sprite = { canvas, density, pixels, used: this.frame };
            this.entries.set(key, sprite);
            this.pixels += pixels;
            if (oversized) this.admissionBlocked = false;
          }
        } else this.admissionBlocked = true;
      }
      this.rasterMs += performance.now() - started;
    }
    if (!sprite) return false;
    sprite.used = this.frame;
    ctx.drawImage(sprite.canvas, x + bounds.x, y + bounds.y,
      sprite.canvas.width / sprite.density, sprite.canvas.height / sprite.density);
    return true;
  }
}
