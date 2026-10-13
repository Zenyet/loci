import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WidgetDashboard } from './WidgetDashboard';
import { DEFAULT_SETTINGS } from '../../types';
import { patchWidgets } from '../../services/widgetSettings';
import { TODOS_KEY } from '../../hooks/useTodos';
import { writeLocal } from '../../services/localStore';
import { DESKTOP_WIDGETS } from '../../services/widgetLayout';

let root: Root, container: HTMLDivElement;
const editingChanged = vi.fn();
beforeEach(() => {
  localStorage.clear(); editingChanged.mockClear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', vi.fn());
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function click(label: string) {
  const target = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === label || button.textContent === label)!;
  expect(target).toBeTruthy(); await act(async () => target.click());
}
async function render(blocked = false) {
  await act(async () => root.render(<WidgetDashboard settings={patchWidgets(DEFAULT_SETTINGS.widgets, { todos: { enabled: true } })}
    onChange={() => {}} onConfigure={() => {}} onEditingChange={editingChanged} blocked={blocked} />));
}

it('adds, completes, deletes and undoes tasks directly in the card without opening a dialog', async () => {
  await render();
  expect(container.textContent).toContain('还没有待办');
  const input = container.querySelector<HTMLInputElement>('[aria-label="新待办"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '验证待办'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await click('添加待办');
  expect(JSON.parse(localStorage.getItem(TODOS_KEY)!)[0].text).toBe('验证待办');
  await click('删除待办 验证待办'); expect(container.textContent).toContain('已删除待办');
  await click('撤销'); expect(container.querySelectorAll('.todo-item')).toHaveLength(1);
  await act(async () => container.querySelector<HTMLInputElement>('.todo-item input')!.click());
  expect(JSON.parse(localStorage.getItem(TODOS_KEY)!)[0].done).toBe(true);
  await click('查看已完成 · 1'); expect(container.querySelector('.todo-item.is-done')).not.toBeNull();
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(editingChanged).not.toHaveBeenCalledWith(true);
  expect(fetch).not.toHaveBeenCalled();
});

it('reflects storage updates and makes card controls inert while settings are open', async () => {
  await render();
  await act(async () => writeLocal(TODOS_KEY, [{ id: 'another-tab', text: '另一个标签页', done: false, tag: 'work' }]));
  expect(container.querySelector('.todo-list')!.textContent).toContain('另一个标签页');
  await render(true);
  expect((container.querySelector('.desktop-widgets') as HTMLElement).inert).toBe(true);
  expect(container.querySelector<HTMLButtonElement>('[aria-label="编辑小组件"]')!.disabled).toBe(true);
});

it('blocks graph interaction only while arranging cards and restores focus after Escape', async () => {
  await render(); await click('编辑小组件');
  expect(editingChanged).toHaveBeenLastCalledWith(true);
  const move = container.querySelector('[aria-label="移动日历"]')!;
  await act(async () => move.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(editingChanged).toHaveBeenLastCalledWith(false);
  expect(document.activeElement?.getAttribute('aria-label')).toBe('编辑小组件');
});

it('never opens a popup when any enabled card or calendar day is clicked', async () => {
  const settings = patchWidgets(DEFAULT_SETTINGS.widgets, Object.fromEntries(DESKTOP_WIDGETS.map(id => [id, { enabled: true }])));
  await act(async () => root.render(<WidgetDashboard settings={settings} onChange={() => {}} onConfigure={() => {}} onEditingChange={editingChanged} blocked={false} />));
  const cards = container.querySelectorAll<HTMLElement>('.desktop-widget');
  expect(cards).toHaveLength(DESKTOP_WIDGETS.length);
  for (const card of cards) { await act(async () => card.click()); expect(container.querySelector('[role="dialog"]')).toBeNull(); }
  await act(async () => container.querySelector<HTMLButtonElement>('.calendar-day')!.click());
  expect(container.querySelector('[role="grid"]')).not.toBeNull();
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(container.querySelector('.desktop-widget__open')).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
