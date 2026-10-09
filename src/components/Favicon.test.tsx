import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Favicon } from './Favicon';

let root: Root;
let container: HTMLDivElement;
const bookmark = { name: 'Example', url: 'https://example.test', color: '#345678', letter: 'E' };
const advance = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); };
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
  vi.useFakeTimers();
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
  expect(img.src).toBe('https://example.test/apple-touch-icon.png');
});

it('tries an alternate icon after a timeout and stops retrying once it loads', async () => {
  await render();
  await advance(8000);
  const img = await loadImage();
  expect(img.src).toBe('https://example.test/favicon.png');
  await advance(8000);
  expect(container.querySelector('img')).toBe(img);
});

it('resets the loaded state when a bookmark URL changes and falls back to its letter', async () => {
  await render(); await loadImage();
  await render('https://other.test');
  expect(container.querySelector('img')?.src).toBe('https://other.test/apple-touch-icon.png');
  expect(container.textContent).toBe('E');
  for (let i = 0; i < 3; i++) await advance(8000);
  expect(container.querySelector('img')).toBeNull();
  expect(container.textContent).toBe('E');
});
