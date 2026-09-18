import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const KEY = 'newtab-group-hues';
beforeEach(() => { vi.resetModules(); localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

describe('group color persistence', () => {
  it('retains legacy hues alongside exact colors after a fresh load', async () => {
    localStorage.setItem(KEY, JSON.stringify({ legacy: 140 }));
    const store = await import('./groupHues');
    await store.setGroupHue('dark', '#102030');
    await store.setGroupHue('black', '#000000');
    await store.setGroupHue('white', '#ffffff');
    await store.setGroupHue('gray', '#808080');
    vi.resetModules();
    const reloaded = await import('./groupHues');
    expect(await reloaded.loadGroupHues()).toEqual({ legacy: 140, dark: '#102030', black: '#000000', white: '#ffffff', gray: '#808080' });
    await reloaded.clearGroupHue('dark');
    expect(JSON.parse(localStorage.getItem(KEY)!)).not.toHaveProperty('dark');
  });

  it('serializes rapid changes and notifies with the exact final color', async () => {
    const saved: unknown[] = [];
    vi.stubGlobal('chrome', { bookmarks: {}, storage: { local: {
      get: async () => ({}),
      set: async (value: unknown) => { await Promise.resolve(); saved.push(value); },
    } } });
    const store = await import('./groupHues');
    await store.loadGroupHues();
    const listener = vi.fn();
    const unsubscribe = store.subscribeGroupHues(listener);
    await Promise.all([
      store.setGroupHue('one', '#111111'),
      store.setGroupHue('two', '#abcdef'),
      store.setGroupHue('one', '#123456'),
    ]);
    expect(saved.at(-1)).toEqual({ [KEY]: { one: '#123456', two: '#abcdef' } });
    expect(listener).toHaveBeenLastCalledWith({ one: '#123456', two: '#abcdef' });
    unsubscribe();
  });

  it('ignores malformed stored values without discarding valid colors', async () => {
    localStorage.setItem(KEY, JSON.stringify({ a: '#ABC', b: -20, bad: '#1z2z3z', object: {}, nil: null }));
    const store = await import('./groupHues');
    expect(await store.loadGroupHues()).toEqual({ a: '#aabbcc', b: 340 });
  });
});
