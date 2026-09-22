import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WidgetDashboard } from './WidgetDashboard';
import { DEFAULT_SETTINGS, type ChromeData, type WidgetSettings } from '../../types';
import { patchWidgets } from '../../services/widgetSettings';
import { NOTES_KEY } from '../../hooks/useNotes';
import { TODOS_KEY } from '../../hooks/useTodos';
import { FOCUS_KEY } from '../../services/focus';
import { writeLocal } from '../../services/localStore';

let root: Root, container: HTMLDivElement;
const initial = () => patchWidgets(DEFAULT_SETTINGS.widgets, { notes: { enabled: true }, focus: { enabled: true }, revisit: { enabled: true }, market: { enabled: true }, pinned: ['notes', 'focus', 'revisit'] });
const data: ChromeData = { groups: [{ id: 'a', label: '设计', parentGroupId: null, depth: 0 }, { id: 'b', label: '开发', parentGroupId: null, depth: 0 }], bookmarks: [], recents: [], barId: null, source: 'fallback' };
function Harness({ value = initial() }: { value?: WidgetSettings }) { const [settings, setSettings] = useState(value); return <WidgetDashboard settings={settings} chromeData={data} onChange={setSettings} blocked={false} onConfigure={() => {}} onPanelChange={() => {}} />; }
beforeEach(() => { localStorage.clear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', vi.fn()); vi.stubGlobal('innerWidth', 1200); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function render(value?: WidgetSettings) { await act(async () => root.render(<Harness value={value} />)); }
async function click(label: string) { const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.getAttribute('aria-label') === label || b.textContent === label); expect(button).toBeTruthy(); await act(async () => button!.click()); }
async function key(element: Element, value: string) { await act(async () => element.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }))); }
async function input(value: string) { const el = container.querySelector<HTMLTextAreaElement>('textarea')!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); }); }

it('autosaves notes across close/reopen, turns the first line into a real todo, and prevents duplicates', async () => {
  await render(); await click('查看便签'); await input('读完收藏\n整理想法');
  expect(JSON.parse(localStorage.getItem(NOTES_KEY)!)).toBe('读完收藏\n整理想法');
  await click('首行转为待办'); await click('首行转为待办');
  expect(JSON.parse(localStorage.getItem(TODOS_KEY)!)).toHaveLength(1);
  expect(container.textContent).toContain('已经在待办');
  await click('关闭小组件'); await click('查看便签'); expect(container.querySelector('textarea')!.value).toBe('读完收藏\n整理想法');
  expect(fetch).not.toHaveBeenCalled();
});
it('retains unsaved note text and exposes a retry when storage fails', async () => {
  await render(); await click('查看便签');
  const original = Storage.prototype.setItem;
  const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) { if (key === NOTES_KEY) throw new Error('quota'); original.call(this, key, value); });
  await input('保留未保存内容'); expect(container.textContent).toContain('便签尚未保存'); expect(container.querySelector('textarea')!.value).toBe('保留未保存内容');
  spy.mockRestore(); await click('重试保存'); expect(JSON.parse(localStorage.getItem(NOTES_KEY)!)).toBe('保留未保存内容');
});
it('computes focus time from the persisted deadline, pauses correctly, and recovers after remount', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-22T02:00:00Z'));
  await render(); await click('查看专注计时'); await click('开始');
  const stored = JSON.parse(localStorage.getItem(FOCUS_KEY)!); expect(stored.endAt).toBe(Date.now() + 25 * 60_000);
  await act(async () => { vi.setSystemTime(Date.now() + 120_000); vi.advanceTimersByTime(1000); });
  expect(container.querySelector('.focus-time')!.textContent).toBe('22:59');
  await click('暂停'); const paused = JSON.parse(localStorage.getItem(FOCUS_KEY)!); expect(paused.endAt).toBeNull(); expect(paused.remaining).toBe(22 * 60_000 + 59_000);
  await click('关闭小组件'); await click('查看专注计时'); expect(container.querySelector('.focus-time')!.textContent).toBe('22:59');
  await click('继续'); expect(JSON.parse(localStorage.getItem(FOCUS_KEY)!).endAt).toBe(Date.now() + paused.remaining);
  await act(async () => root.unmount()); root = createRoot(container);
  vi.setSystemTime(Date.now() + 60_000); await render(); await click('查看专注计时');
  expect(container.querySelector('.focus-time')!.textContent).toBe('21:59');
});
it('keeps all enabled tools reachable on narrow screens and restores focus to More', async () => {
  vi.stubGlobal('innerWidth', 360); await render();
  expect(container.querySelectorAll('.widget-bar [aria-label="查看专注计时"]')).toHaveLength(0);
  await click('更多小组件'); await click('查看专注计时');
  await key(container.querySelector('[role="dialog"]')!, 'Escape');
  expect(container.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement?.getAttribute('aria-label')).toBe('更多小组件');
});
it('closes the custom task selector before closing its widget and saves a keyboard selection', async () => {
  await writeLocal(TODOS_KEY, [{ id: 'task', text: '读一篇文章', tag: 'work', done: false }]);
  await render(); await click('查看专注计时');
  const trigger = container.querySelector('[aria-label="关联待办"]')!;
  await key(trigger, 'ArrowDown'); expect(container.querySelector('[role="listbox"]')).not.toBeNull();
  await key(trigger, 'Escape'); expect(container.querySelector('[role="listbox"]')).toBeNull(); expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  await key(trigger, 'ArrowDown'); await key(trigger, 'ArrowDown'); await key(trigger, 'Enter');
  expect(JSON.parse(localStorage.getItem(FOCUS_KEY)!).taskId).toBe('task');
});
it('uses a named folder selector with keyboard choice and nested Escape dismissal', async () => {
  await render(); await click('查看收藏回访');
  const trigger = container.querySelector('[aria-label="回访文件夹"]')!;
  await key(trigger, 'ArrowDown'); await key(trigger, 'End'); await key(trigger, 'Enter'); expect(trigger.textContent).toContain('开发');
  await key(trigger, 'ArrowDown'); await key(trigger, 'Escape'); expect(container.querySelector('[role="listbox"]')).toBeNull(); expect(container.querySelector('[role="dialog"]')).not.toBeNull();
});
it('shows a connection form without mock prices or network access for an unconfigured market', async () => {
  await render(); await click('更多小组件'); await click('查看市场速览');
  expect(container.querySelector('[aria-label="Tushare Token"]')).not.toBeNull(); expect(container.querySelector('.market-price')).toBeNull(); expect(fetch).not.toHaveBeenCalled();
});
