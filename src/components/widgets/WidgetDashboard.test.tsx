import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WidgetDashboard } from './WidgetDashboard';
import { DEFAULT_SETTINGS } from '../../types';
import { patchWidgets } from '../../services/widgetSettings';
import { TODOS_KEY } from '../../hooks/useTodos';
import { writeLocal } from '../../services/localStore';

let root: Root, container: HTMLDivElement;
const panelChanged = vi.fn();
beforeEach(() => {
  localStorage.clear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', vi.fn());
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function click(label: string) {
  const target = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === label || button.textContent === label)!;
  expect(target).toBeTruthy(); await act(async () => target.click());
}
async function render() {
  await act(async () => root.render(<WidgetDashboard settings={patchWidgets(DEFAULT_SETTINGS.widgets, { todos: { enabled: true } })}
    onChange={() => {}} onConfigure={() => {}} onPanelChange={panelChanged} blocked={false} />));
}

it('starts with empty tasks, persists add/complete/delete/undo, and does not request disabled weather', async () => {
  await render(); await click('查看今日待办');
  expect(container.textContent).toContain('还没有待办');
  const input = container.querySelector<HTMLInputElement>('[aria-label="新待办"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '验证待办'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await click('添加待办');
  expect(JSON.parse(localStorage.getItem(TODOS_KEY)!)[0].text).toBe('验证待办');
  await click('删除待办 验证待办'); expect(container.textContent).toContain('已删除待办');
  await click('撤销'); expect(container.querySelectorAll('.todo-item')).toHaveLength(1);
  await act(async () => container.querySelector<HTMLInputElement>('.todo-item input')!.click());
  expect(JSON.parse(localStorage.getItem(TODOS_KEY)!)[0].done).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});

it('reflects changes from storage and yields its surface to search/settings', async () => {
  await render(); await click('查看今日待办');
  await act(async () => writeLocal(TODOS_KEY, [{ id: 'another-tab', text: '另一个标签页', done: false, tag: 'work' }]));
  expect(container.querySelector('.todo-list')!.textContent).toContain('另一个标签页');
  await act(async () => window.dispatchEvent(new CustomEvent('loci:surface', { detail: 'graph' })));
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(panelChanged).toHaveBeenLastCalledWith(false);
});

it('restores focus to the trigger after Escape', async () => {
  await render(); await click('查看今日待办');
  const panel = container.querySelector<HTMLElement>('[role="dialog"]')!;
  await act(async () => panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement?.getAttribute('aria-label')).toBe('查看今日待办');
});

it('keeps legacy clock and weather preferences together in one card', async () => {
  const settings = patchWidgets(DEFAULT_SETTINGS.widgets, { clock: { enabled: true, hour12: true }, weather: { enabled: true }, order: ['weather', 'todos', 'clock'] });
  await act(async () => root.render(<WidgetDashboard settings={settings} onChange={() => {}} onConfigure={() => {}} onPanelChange={panelChanged} blocked={false} />));
  const card = container.querySelector('[aria-label="时间与天气"]')!;
  expect(card.querySelector('time')).not.toBeNull();
  expect(card.querySelector('[aria-label="查看天气"]')).not.toBeNull();
  expect(container.querySelectorAll('[aria-label="时间与天气"]')).toHaveLength(1);
  await click('查看天气');
  expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('天气详情');
  expect(fetch).not.toHaveBeenCalled();
});

it('opens the calendar from the date even with clock/weather disabled, and restores focus when dismissed', async () => {
  await render(); await click('查看日历');
  expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('日历');
  expect(container.querySelector('[role="grid"]')).not.toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  await click('关闭小组件');
  expect(document.activeElement?.getAttribute('aria-label')).toBe('查看日历');
  await click('查看日历');
  await act(async () => container.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement?.getAttribute('aria-label')).toBe('查看日历');
});
