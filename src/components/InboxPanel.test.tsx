import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { InboxPanel } from './InboxPanel';
import { DEFAULT_SETTINGS, type ChromeData } from '../types';
const mocks = vi.hoisted(() => ({ archive: vi.fn(), organize: vi.fn(), refresh: vi.fn() }));
vi.mock('../services/capture', async importOriginal => ({ ...await importOriginal<typeof import('../services/capture')>(), archiveInboxBookmark: (...args: unknown[]) => mocks.archive(...args) }));
const folder = { id: 'inbox', label: '收件箱', parentGroupId: null, depth: 0 };
const data: ChromeData = { barId: 'bar', groups: [folder, { id: 'work', label: '工作', parentGroupId: null, depth: 0 }], bookmarks: ['a', 'b'].map(id => ({ id, parentId: 'inbox', name: id, url: `https://${id}.example/`, group: '', visits: 0, last: '', color: '', letter: '' })), recents: [], source: 'fallback' };
let container: HTMLDivElement, root: Root;
function Harness({ source = 'fallback', empty = false }: { source?: ChromeData['source']; empty?: boolean }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" onClick={() => setOpen(true)}>打开收件箱</button><InboxPanel open={open} data={{ ...data, source }} folder={folder} bookmarks={empty ? [] : data.bookmarks} ready error={null} settings={DEFAULT_SETTINGS} organizing={false} onClose={() => setOpen(false)} onRefresh={mocks.refresh} onOrganize={mocks.organize} /></>;
}
async function click(name: string) {
  const element = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === name || button.getAttribute('aria-label') === name)!;
  expect(element).toBeTruthy(); await act(async () => { element.focus(); element.click(); });
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); mocks.archive.mockReset(); mocks.organize.mockReset(); mocks.refresh.mockReset();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<Harness />)); await click('打开收件箱');
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it('passes exactly the checked bookmarks into the review workflow', async () => {
  await act(async () => container.querySelector<HTMLInputElement>('[aria-label="选择 a"]')!.click());
  await click('整理所选'); expect(mocks.organize).toHaveBeenCalledWith({ ids: ['a'], inboxId: 'inbox' });
  expect(mocks.archive).not.toHaveBeenCalled();
});
it('keeps failed archives visible with an actionable error', async () => {
  mocks.archive.mockRejectedValueOnce(new Error('目标文件夹已删除，请重新选择。'));
  await click('移动 a 到');
  const option = [...container.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === '书签栏 / 工作')!;
  await act(async () => option.click());
  await click('移动');
  expect(mocks.archive).toHaveBeenCalledWith('a', 'inbox', 'work'); expect(container.querySelector('[role=alert]')?.textContent).toContain('目标文件夹已删除');
  expect(container.querySelectorAll('.inbox-item')).toHaveLength(2);
});
it.each(['Escape', 'button'])('closes with %s and restores the launching control', async method => {
  if (method === 'button') await click('关闭收件箱');
  else {
    const dialog = container.querySelector('[role=dialog]')!;
    await act(async () => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  }
  expect(container.querySelector('[role=dialog]')).toBeNull(); expect(document.activeElement?.textContent).toBe('打开收件箱');
});

it.each(['fallback', 'chrome'] as const)('shows capture instructions for the actual %s environment', async source => {
  await act(async () => root.render(<Harness source={source} empty />));
  const previewLink = container.querySelector<HTMLAnchorElement>('a[href="./popup.html"]');
  if (source === 'fallback') {
    expect(previewLink?.textContent).toBe('体验收藏');
    expect(container.textContent).toContain('不会写入 Chrome 书签');
    expect(container.textContent).not.toContain('在普通网页上点击浏览器工具栏');
  } else {
    expect(previewLink).toBeNull();
    expect(container.textContent).not.toContain('当前为网页预览');
    expect(container.textContent).toContain('在普通网页上点击浏览器工具栏中的 Loci 图标');
  }
});

it('closes the folder menu before the inbox and keeps focus on the selector', async () => {
  await click('移动 a 到');
  const trigger = container.querySelector<HTMLElement>('[role="combobox"][aria-label="移动 a 到"]')!;
  const key = async () => act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(container.querySelector('[role="dialog"] [role="listbox"]')).not.toBeNull();
  await key();
  expect(container.querySelector('[role="listbox"]')).toBeNull();
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.activeElement).toBe(trigger);
  await key();
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});
