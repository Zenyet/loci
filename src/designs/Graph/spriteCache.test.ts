import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RenderSpriteCache } from './spriteCache';

const bounds = { x: -5, y: -5, width: 10, height: 10 };
let surfaces: HTMLCanvasElement[];
const createCanvas = () => {
  const canvas = { width: 0, height: 0, getContext: () => ({ setTransform: vi.fn() }) } as unknown as HTMLCanvasElement;
  surfaces.push(canvas);
  return canvas;
};
const ctx = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
beforeEach(() => { surfaces = []; vi.spyOn(performance, 'now').mockReturnValue(0); vi.mocked(ctx.drawImage).mockClear(); });
afterEach(() => vi.restoreAllMocks());

describe('bounded sprite raster cache', () => {
  it('reuses art across movement and upgrades resolution only when needed', () => {
    const cache = new RenderSpriteCache(10000, 10, createCanvas), paint = vi.fn();
    cache.beginFrame();
    cache.draw(ctx, 'label', 0, 0, bounds, 1, paint);
    cache.draw(ctx, 'label', 80, 20, bounds, .8, paint);
    expect(paint).toHaveBeenCalledOnce();
    expect(ctx.drawImage).toHaveBeenLastCalledWith(surfaces[0], 75, 15, 10, 10);
    cache.draw(ctx, 'label', 0, 0, bounds, 2, paint);
    expect(paint).toHaveBeenCalledTimes(2);
    expect(surfaces[0].width).toBe(0);
    expect(cache.stats.pixels).toBe(400);
    cache.clear();
    expect(cache.stats).toEqual({ entries: 0, pixels: 0 });
    expect(surfaces[1].width).toBe(0);
  });

  it('never churns visible entries when a scene exceeds the pixel budget', () => {
    const cache = new RenderSpriteCache(200, 10, createCanvas), paint = vi.fn();
    for (let i = 0; i < 10; i++) {
      cache.beginFrame();
      expect(cache.draw(ctx, 'a', 0, 0, bounds, 1, paint)).toBe(true);
      expect(cache.draw(ctx, 'b', 0, 0, bounds, 1, paint)).toBe(true);
      expect(cache.draw(ctx, 'c', 0, 0, bounds, 1, paint)).toBe(false);
    }
    expect(paint).toHaveBeenCalledTimes(2);
    expect(cache.stats.pixels).toBe(200);
    cache.beginFrame(); cache.beginFrame();
    expect(cache.draw(ctx, 'c', 0, 0, bounds, 1, paint)).toBe(true);
    expect(cache.stats.pixels).toBe(200);
  });

  it('bounds entry count and declines oversized textures', () => {
    const cache = new RenderSpriteCache(1000, 1, createCanvas), paint = vi.fn();
    cache.beginFrame();
    expect(cache.draw(ctx, 'a', 0, 0, bounds, 1, paint)).toBe(true);
    expect(cache.draw(ctx, 'b', 0, 0, bounds, 1, paint)).toBe(false);
    expect(cache.draw(ctx, 'huge', 0, 0, { ...bounds, width: 2000 }, 1, paint)).toBe(false);
    expect(cache.stats).toEqual({ entries: 1, pixels: 100 });
  });

  it('bounds cold raster work per frame and keeps displaying an older resolution', () => {
    const cache = new RenderSpriteCache(10000, 10, createCanvas);
    let now = 0;
    vi.mocked(performance.now).mockImplementation(() => now);
    const paint = vi.fn(() => { now += 3; });
    cache.beginFrame();
    expect(cache.draw(ctx, 'a', 0, 0, bounds, 1, paint)).toBe(true);
    expect(cache.draw(ctx, 'a', 0, 0, bounds, 2, paint)).toBe(true);
    expect(cache.draw(ctx, 'b', 0, 0, bounds, 1, paint)).toBe(false);
    expect(paint).toHaveBeenCalledOnce();
    expect(cache.needsRefinement).toBe(true);
    cache.beginFrame();
    expect(cache.draw(ctx, 'a', 0, 0, bounds, 2, paint)).toBe(true);
    expect(paint).toHaveBeenCalledTimes(2);
    expect(cache.needsRefinement).toBe(false);
  });
});
