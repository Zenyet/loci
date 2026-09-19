import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { CapturePopup } from './CapturePopup';
import type { BookmarkData } from '../services/capture';

const mocks = vi.hoisted(() => ({ data: {} as BookmarkData, page: vi.fn(), save: vi.fn() }));
vi.mock('../hooks/useSettings', () => ({ useSettings: () => ({}) }));
vi.mock('../services/chromeApi', async importOriginal => ({ ...await importOriginal<typeof import('../services/chromeApi')>(), hasChromeApi: true, loadBookmarkData: async () => mocks.data, subscribeBookmarkChanges: () => () => {} }));
vi.mock('../services/capture', async importOriginal => ({ ...await importOriginal<typeof import('../services/capture')>(), currentCapturePage: () => mocks.page(), saveCapture: (...args: unknown[]) => mocks.save(...args) }));
let container: HTMLDivElement, root: Root;
async function render() { await act(async () => root.render(<CapturePopup />)); }
async function click(text: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === text)!;
  expect(button).toBeTruthy(); await act(async () => button.click());
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.data = { barId: 'bar', groups: [], bookmarks: [] };
  mocks.page.mockReset().mockResolvedValue({ title: '当前网页', url: 'https://example.com/article?x=1#part' });
  mocks.save.mockReset().mockResolvedValue({ status: 'saved', bookmarkId: 'saved', parentId: 'bar', title: '当前网页' });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it('prevents duplicate submit while saving and displays the committed location', async () => {
  let resolve!: (value: unknown) => void;
  mocks.save.mockReturnValue(new Promise(yes => { resolve = yes; }));
  await render();
  const form = container.querySelector('form')!;
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(mocks.save.mock.calls[0]![0]).toMatchObject({ title: '当前网页', url: 'https://example.com/article?x=1#part', allowDuplicate: false });
  await act(async () => resolve({ status: 'saved', bookmarkId: 'saved', parentId: 'bar', title: '当前网页' }));
  expect(container.textContent).toContain('好内容，留下了'); expect(container.textContent).toContain('书签栏');
});

it('shows duplicate locations and keeps existing bookmarks without a write', async () => {
  mocks.data.bookmarks = [{ id: 'existing', parentId: 'bar', name: '原收藏', url: 'https://example.com/article?x=1#part', group: '', color: '', visits: 0, last: '', letter: '' }];
  await render(); expect(container.textContent).toContain('这个网页已经收藏过');
  expect(container.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false);
  await click('保留已有收藏'); expect(mocks.save).not.toHaveBeenCalled();
  expect(container.textContent).toContain('已保留原来的收藏');
});

it('keeps editable fields after a save failure and allows retry', async () => {
  mocks.save.mockRejectedValueOnce(new Error('保存失败，请重试。'));
  await render(); await click('保存收藏');
  expect(container.querySelector('[role=alert]')?.textContent).toContain('保存失败');
  expect(container.querySelector<HTMLInputElement>('input')?.value).toBe('当前网页');
  await click('保存收藏'); expect(mocks.save).toHaveBeenCalledTimes(2); expect(container.textContent).toContain('好内容，留下了');
});

it('explains a restricted page and never offers a save action', async () => {
  mocks.page.mockRejectedValueOnce(new Error('这个页面无法收藏。'));
  await render(); expect(container.querySelector('[role=alert]')?.textContent).toContain('无法收藏');
  expect(container.querySelector('form')).toBeNull(); expect(mocks.save).not.toHaveBeenCalled();
});

it('saves to the folder chosen with the custom listbox', async () => {
  mocks.data.groups = [{ id: 'work', label: '工作', parentGroupId: null, depth: 0 }];
  await render();
  const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="保存到"]')!;
  await act(async () => trigger.click());
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === '书签栏 / 工作')!;
  await act(async () => option.click());
  expect(document.activeElement).toBe(trigger);
  await click('保存收藏');
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ destinationId: 'work' }));
});
