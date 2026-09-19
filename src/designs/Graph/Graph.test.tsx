import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Graph } from './Graph';
import { DEFAULT_SETTINGS, type ChromeData, type GraphItem } from '../../types';

vi.mock('./GraphCanvas', () => ({ GraphCanvas: ({ bookmarks }: { bookmarks: GraphItem[] }) => <div data-testid="canvas">{bookmarks.map(bookmark => bookmark.name).join(',')}</div> }));
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  localStorage.clear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('makes every search result available, including the twelfth match', async () => {
  const data: ChromeData = { bookmarks: Array.from({ length: 12 }, (_, i) => ({ id: String(i), parentId: 'bar', name: `收藏 ${String(i).padStart(2, '0')}`, url: `https://example.com/${i}`, group: '', color: '', letter: '', visits: 0, last: '' })), groups: [], recents: [], barId: 'bar', source: 'fallback' };
  const open = vi.spyOn(window, 'open').mockImplementation(() => null);
  await act(async () => root.render(<Graph data={data} settings={DEFAULT_SETTINGS} resolvedTheme="light" />));
  await act(async () => container.querySelector<HTMLButtonElement>('.graph-search-launcher')!.click());
  const input = container.querySelector<HTMLInputElement>('.graph-search-input')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '收藏'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  const results = container.querySelectorAll<HTMLButtonElement>('[role="option"]');
  expect(results).toHaveLength(12);
  await act(async () => results[11].click());
  expect(open).toHaveBeenCalledWith('https://example.com/11', '_blank', 'noopener,noreferrer');
});

it('filters sources without losing other data and prevents creating inside a managed source', async () => {
  const data: ChromeData = { bookmarks: [], groups: [{ id: 'managed', label: '组织', parentGroupId: null, depth: 0, rootId: 'managed', isRoot: true, readOnly: true }], roots: [{ id: 'bar', label: '书签栏', readOnly: false }, { id: 'managed', label: '组织', readOnly: true }], recents: [], barId: 'bar', source: 'chrome' };
  await act(async () => root.render(<Graph data={data} settings={DEFAULT_SETTINGS} resolvedTheme="light" />));
  const select = container.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="书签来源"]')!;
  const key = async (key: string) => act(async () => select.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
  const add = [...container.querySelectorAll<HTMLButtonElement>('.graph-quick-actions button')].find(button => button.textContent === '添加')!;
  await key('Enter'); await key('End'); await key('Enter');
  expect(select.textContent).toBe('组织');
  expect(add.disabled).toBe(true);
  expect(container.querySelector('[data-testid="canvas"]')!.textContent).toContain('组织');
  await key('Enter'); await key('ArrowUp'); await key('Enter');
  expect(select.textContent).toBe('书签栏');
  expect(add.disabled).toBe(false);
  expect(container.querySelector('[data-testid="canvas"]')!.textContent).not.toContain('组织');
  expect(document.activeElement).toBe(select);
  expect(container.querySelector('.graph-search-input')).toBeNull();
});
