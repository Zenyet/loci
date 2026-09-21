import { describe, expect, it } from 'vitest';
import { advanceHoverFade } from './hoverFade';

describe('hover fade continuity', () => {
  it('keeps the dragged neighborhood readable, then restores ordinary hover on release', () => {
    const opacity = new Map<string, number>();
    advanceHoverFade(opacity, ['a', 'b', 'c'], 'a', 16, true, new Set(['a', 'b']));
    expect([...opacity.values()]).toEqual([1, 1, .3]);
    advanceHoverFade(opacity, ['a', 'b', 'c'], 'a', 16, true);
    expect([...opacity.values()]).toEqual([1, .3, .3]);
    advanceHoverFade(opacity, ['a', 'b', 'c'], null, 16, true);
    expect([...opacity.values()]).toEqual([1, 1, 1]);
  });
  it('eases in and out instead of jumping when the pointer leaves', () => {
    const opacity = new Map<string, number>();
    expect(advanceHoverFade(opacity, ['a', 'b'], 'a', 16, false)).toBe(true);
    const entered = opacity.get('b')!;
    expect(entered).toBeLessThan(1); expect(entered).toBeGreaterThan(.3);
    expect(opacity.get('a')).toBe(1);
    advanceHoverFade(opacity, ['a', 'b'], null, 16, false);
    expect(opacity.get('b')).toBeGreaterThan(entered); expect(opacity.get('b')).toBeLessThan(1);
    for (let i = 0; i < 40; i++) advanceHoverFade(opacity, ['a', 'b'], null, 16, false);
    expect(opacity.get('b')).toBe(1);
  });
  it('crossfades the previous and next hovered nodes', () => {
    const opacity = new Map([['a', 1], ['b', .3], ['c', .3]]);
    advanceHoverFade(opacity, ['a', 'b', 'c'], 'b', 16, false);
    expect(opacity.get('a')).toBeLessThan(1); expect(opacity.get('a')).toBeGreaterThan(.3);
    expect(opacity.get('b')).toBeGreaterThan(.3); expect(opacity.get('b')).toBeLessThan(1);
    expect(opacity.get('c')).toBe(.3);
  });
  it('uses elapsed time rather than frame count', () => {
    const slow = new Map<string, number>(), fast = new Map<string, number>();
    for (let i = 0; i < 10; i++) advanceHoverFade(slow, ['a', 'b'], 'a', 32, false);
    for (let i = 0; i < 40; i++) advanceHoverFade(fast, ['a', 'b'], 'a', 8, false);
    expect(slow.get('b')).toBeCloseTo(fast.get('b')!, 8);
  });
  it('respects reduced motion and drops nodes from old scopes', () => {
    const opacity = new Map([['old', .5]]);
    expect(advanceHoverFade(opacity, ['a', 'b'], 'a', 0, true)).toBe(false);
    expect(opacity).toEqual(new Map([['a', 1], ['b', .3]]));
    advanceHoverFade(opacity, ['a', 'b'], null, 0, true);
    expect(opacity.get('b')).toBe(1);
  });
});
