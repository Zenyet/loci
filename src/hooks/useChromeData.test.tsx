import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useChromeData } from './useChromeData';
import type { ChromeData } from '../types';

const mocks = vi.hoisted(() => ({ load: vi.fn(), changed: () => {} }));
vi.mock('../services/chromeApi', () => ({ loadChromeData: () => mocks.load(), subscribeBookmarkChanges: (callback: () => void) => { mocks.changed = callback; return () => {}; } }));
it('keeps the newest bookmark event when an earlier load resolves late', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const pending: ((data: ChromeData) => void)[] = [];
  mocks.load.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
  let state!: ReturnType<typeof useChromeData>;
  function Harness() { state = useChromeData(); return null; }
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => mocks.changed());
    const data: ChromeData = { barId: 'bar', bookmarks: [], groups: [], recents: [], source: 'chrome' };
    await act(async () => pending[1]!({ ...data, barId: 'latest' }));
    await act(async () => pending[0]!({ ...data, barId: 'older' }));
    expect(state.data?.barId).toBe('latest'); expect(state.loading).toBe(false);
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
