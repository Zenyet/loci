import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSettings } from './useSettings';
import { DEFAULT_SETTINGS, type Settings } from '../types';
import { patchWidgets } from '../services/widgetSettings';
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), changed: () => {} }));
vi.mock('../services/chromeApi', async importOriginal => ({ ...await importOriginal<object>(), loadSettings: () => mocks.load(), saveSettings: (next: Settings) => mocks.save(next) }));
vi.mock('../services/localStore', () => ({ subscribeLocal: (_key: string, changed: () => void) => { mocks.changed = changed; return () => {}; } }));
vi.mock('./useBingWallpaper', () => ({ useBingWallpaper: () => ({ data: null }) }));
vi.mock('./useImageSource', () => ({ useImageSource: () => ({ url: '' }) }));
let root: Root, container: HTMLDivElement, state: ReturnType<typeof useSettings>;
function Harness() { state = useSettings(); return null; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const at = (x: number) => patchWidgets(DEFAULT_SETTINGS.widgets, { desktop: { layout: { calendar: { x, y: 0.3, size: 'small' } } } });
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.load.mockReset().mockResolvedValue(DEFAULT_SETTINGS); mocks.save.mockReset().mockResolvedValue(undefined);
  container = document.createElement('div'); root = createRoot(container);
  await act(async () => root.render(<StrictMode><Harness /></StrictMode>));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
it('does not let an older settings read snap a newly dropped widget back', async () => {
  const oldRead = deferred<Settings>(); const write = deferred<void>();
  mocks.load.mockReturnValueOnce(oldRead.promise); mocks.save.mockReturnValueOnce(write.promise);
  await act(async () => mocks.changed());
  await act(async () => state.update({ widgets: at(0.8) }));
  await act(async () => oldRead.resolve({ ...DEFAULT_SETTINGS, widgets: at(0.2) }));
  expect(state.settings.widgets.desktop.layout.calendar?.x).toBe(0.8);
  mocks.load.mockResolvedValue({ ...DEFAULT_SETTINGS, widgets: at(0.8) });
  await act(async () => write.resolve());
  expect(state.settings.widgets.desktop.layout.calendar?.x).toBe(0.8);
});
it('keeps the latest of consecutive drops while earlier storage notifications arrive', async () => {
  const first = deferred<void>(), second = deferred<void>();
  mocks.save.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  await act(async () => state.update({ widgets: at(0.4) }));
  await act(async () => state.update({ widgets: at(0.9) }));
  mocks.load.mockResolvedValue({ ...DEFAULT_SETTINGS, widgets: at(0.4) });
  await act(async () => { first.resolve(); mocks.changed(); });
  expect(state.settings.widgets.desktop.layout.calendar?.x).toBe(0.9);
  expect(mocks.save).toHaveBeenCalledTimes(2);
  mocks.load.mockResolvedValue({ ...DEFAULT_SETTINGS, widgets: at(0.9) });
  await act(async () => second.resolve());
  expect(state.settings.widgets.desktop.layout.calendar?.x).toBe(0.9);
  mocks.load.mockResolvedValue({ ...DEFAULT_SETTINGS, widgets: at(0.6) });
  await act(async () => mocks.changed());
  expect(state.settings.widgets.desktop.layout.calendar?.x).toBe(0.6);
});
