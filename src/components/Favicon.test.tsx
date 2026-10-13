import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Favicon } from './Favicon';

let root: Root;
let container: HTMLDivElement;
const bookmark = { name: 'Example', url: 'https://example.test', color: '#345678', letter: 'E' };
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
async function render(url = bookmark.url) {
  await act(async () => root.render(<Favicon bookmark={{ ...bookmark, url }} />));
  await act(async () => { window.dispatchEvent(new Event('load')); });
  await advance(200);
}
async function loadImage() {
  const img = container.querySelector('img')!;
  Object.defineProperty(img, 'naturalWidth', { value: 32, configurable: true });
  await act(async () => { img.dispatchEvent(new Event('load')); });
  return img;
}
beforeEach(() => {
  localStorage.clear(); vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
});

it('keeps a successfully loaded icon visible beyond every fallback timeout', async () => {
  await render();
  const img = await loadImage();
  for (let i = 0; i < 4; i++) await advance(8000);
  expect(container.querySelector('img')).toBe(img);
  expect(img.style.display).toBe('block');
  expect(new URL(img.src).hostname).toBe('t0.gstatic.cn');
});

it('uses its letter when the gstatic request times out without requesting the original site', async () => {
  await render();
  await advance(8000);
  expect(container.querySelector('img')).toBeNull();
  expect(container.textContent).toBe('E');
});

it('resets the loaded state when a bookmark URL changes and falls back to its letter', async () => {
  await render(); await loadImage();
  await render('https://other.test');
  expect(new URL(container.querySelector('img')!.src).searchParams.get('url')).toBe('https://other.test');
  expect(container.textContent).toBe('E');
  for (let i = 0; i < 3; i++) await advance(8000);
  expect(container.querySelector('img')).toBeNull();
  expect(container.textContent).toBe('E');
});
