import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityDock, frequentBookmarks, visitLabel } from './ActivityDock';
import type { Bookmark, HistoryItem } from '../types';

vi.mock('./Favicon', () => ({ Favicon: () => <span /> }));
const now = new Date(2026, 8, 18, 14, 30);
const bookmark = (id: string, visits: number, url = `https://${id}.test`) => ({ id, name: id, url, visits, color: '#345678', letter: id[0]!, parentId: 'folder', group: '', last: '' } as Bookmark);
const recent = (title: string, url: string, date: Date): HistoryItem => ({ title, url, at: '', lastVisitTime: date.getTime() });
const props: ComponentProps<typeof ActivityDock> = {
  bookmarks: [bookmark('alpha', 1), bookmark('beta', 10)],
  recents: [recent('Older article', 'https://docs.test/guide?lang=zh#colors', new Date(2026, 8, 17, 10)), recent('Design systems', 'https://design.test/article', new Date(2026, 8, 18, 14, 25))],
  now, openInNewTab: true,
};
let root: Root, container: HTMLDivElement;
async function render(overrides: Partial<typeof props> = {}) { await act(async () => root.render(<ActivityDock {...props} {...overrides} />)); }
async function open(view = '最近访问') { await act(async () => container.querySelector<HTMLButtonElement>(`[aria-label="${view}"][aria-haspopup="dialog"]`)!.click()); }
async function search(value: string) {
  if (!container.querySelector('[aria-label="查找最近访问"]')) await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="搜索最近访问"]')!.click());
  const input = container.querySelector<HTMLInputElement>('[aria-label="查找最近访问"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Activity dock', () => {
  it('ranks frequent bookmarks without duplicate destinations or mutating the input', () => {
    const bookmarks = [bookmark('low', 1), bookmark('high', 10), bookmark('duplicate', 9, 'https://high.test')];
    expect(frequentBookmarks(bookmarks).map(item => item.id)).toEqual(['high', 'low']);
    expect(bookmarks.map(item => item.id)).toEqual(['low', 'high', 'duplicate']);
  });

  it('opens searchable history with time groups and links to the complete original page', async () => {
    await render(); await open();
    expect(document.activeElement?.getAttribute('role')).toBe('dialog');
    expect(container.querySelector('[aria-label="查找最近访问"]')).toBeNull();
    const items = container.querySelectorAll<HTMLAnchorElement>('.activity-panel__item');
    expect(items[0]!.textContent).toContain('Design systems');
    expect(items[1]!.href).toBe('https://docs.test/guide?lang=zh#colors');
    expect(container.querySelectorAll('.activity-panel__day h3')[0]!.textContent).toBe('今天');
    expect(container.querySelectorAll('.activity-panel__day h3')[1]!.textContent).toBe('昨天');
    await search('DOCS.TEST');
    expect(container.querySelectorAll('.activity-panel__item')).toHaveLength(1);
    expect(container.querySelector('.activity-panel__item')?.textContent).toContain('Older article');
    await search('missing');
    expect(container.textContent).toContain('没有找到相关页面');
    const clear = [...container.querySelectorAll('button')].find(button => button.textContent === '清除搜索')!;
    await act(async () => clear.click());
    expect(container.querySelectorAll('.activity-panel__item')).toHaveLength(2);
  });

  it('consumes Escape, returns focus to the trigger, and resets search on reopening', async () => {
    await render(); await open(); await search('design');
    const key = vi.fn(); window.addEventListener('keydown', key);
    try {
      await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
      expect(container.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement?.textContent).toBe('最近访问');
      expect(key).not.toHaveBeenCalled();
      await open();
      expect(container.querySelectorAll('.activity-panel__item')).toHaveLength(2);
    } finally { window.removeEventListener('keydown', key); }
  });

  it('dismisses on an outside press and when another modal blocks interaction', async () => {
    await render(); await open();
    await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await open(); await render({ blocked: true });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('provides empty states and follows the open-in-new-tab preference', async () => {
    await render({ openInNewTab: false }); await open('常用');
    expect(container.querySelector('a')?.getAttribute('target')).toBeNull();
    await render({ bookmarks: [], recents: [] });
    expect(container.textContent).toContain('收藏的网站会出现在这里');
    await open();
    expect(container.textContent).toContain('还没有最近访问');
    expect(container.querySelector('[aria-label="查找最近访问"]')).toBeNull();
  });

  it('keeps the resting toolbar compact and exposes shortcuts only when requested', async () => {
    await render();
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.querySelectorAll('button')).toHaveLength(2);
    await open('常用');
    const links = container.querySelectorAll<HTMLAnchorElement>('.activity-panel__item');
    expect(links).toHaveLength(2);
    expect(links[0]!.getAttribute('aria-label')).toBe('打开 beta');
    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(links[0]);
      links[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(links[1]);
    const tab = [...container.querySelectorAll<HTMLButtonElement>('.activity-panel__tabs button')].find(button => button.textContent === '最近访问')!;
    await act(async () => tab.click());
    expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('最近访问');
    expect(container.querySelector('.activity-panel__item')?.textContent).toContain('Design systems');
  });

  it('does not invent dates for history fixtures with unknown visit times', () => {
    expect(visitLabel({ title: 'test', url: 'test.com', at: '14:22', lastVisitTime: 0 }, now)).toEqual({ day: '最近', time: '14:22', full: '14:22' });
    expect(visitLabel(props.recents[1]!, now).time).toBe('5 分钟前');
  });
});
