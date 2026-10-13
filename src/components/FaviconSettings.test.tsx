import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FaviconSettings } from './FaviconSettings';
import { setupImageStorage } from '../test/imageStorage';
import { readFaviconPreferences } from '../services/faviconStorage';
import { listImages, writeImage } from '../services/imageStore';
let root: Root, container: HTMLDivElement;
beforeEach(async () => {
  localStorage.clear(); await setupImageStorage(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); container.setAttribute('role', 'dialog'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function click(label: string) { const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.getAttribute('aria-label') === label || b.textContent === label)!; await act(async () => button.click()); }
async function ready() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); }
it('saves keyboard-selected cache settings, consumes Escape, and clears icons without deleting wallpaper', async () => {
  const blob = new Blob([new Uint8Array(20)], { type: 'image/png' });
  await writeImage({ id: 'wallpaper:keep', kind: 'wallpaper', blob, savedAt: 1, usedAt: 1 });
  await writeImage({ id: 'favicon:test', kind: 'favicon', blob, savedAt: 1, usedAt: 1 });
  await act(async () => root.render(<FaviconSettings />)); await ready();
  await click('缓存网站图标'); await ready();
  expect((await readFaviconPreferences()).enabled).toBe(true);
  const select = container.querySelector<HTMLButtonElement>('[aria-label="图标缓存更新间隔"]')!;
  const key = async (key: string) => act(async () => select.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
  await key('ArrowDown'); await key('End'); await key('Enter'); await ready();
  expect((await readFaviconPreferences()).days).toBe(90);
  await key('ArrowDown'); await key('Escape'); expect(container.querySelector('[role="listbox"]')).toBeNull(); expect(document.activeElement).toBe(select);
  await click('清空图标缓存'); await ready();
  expect(await listImages('favicon')).toHaveLength(0); expect(await listImages('wallpaper')).toHaveLength(1);
  expect(container.textContent).toContain('缓存已清空');
});
it('leaves caching disabled if the optional permission is denied', async () => {
  vi.stubGlobal('chrome', { permissions: { contains: async () => false, request: async () => false } });
  await act(async () => root.render(<FaviconSettings />)); await ready(); await click('缓存网站图标');
  expect((await readFaviconPreferences()).enabled).toBe(false); expect(container.textContent).toContain('未获得图标服务访问权限');
});
