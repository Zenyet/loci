import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CalendarWidget } from './CalendarWidget';

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', vi.fn());
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render(showLunar = true, showHolidays = true) {
  await act(async () => root.render(<CalendarWidget now={new Date(2026, 8, 20)} settings={{ showLunar, showHolidays }} />));
}
function date(key: string) { return container.querySelector<HTMLButtonElement>(`[data-date="${key}"]`)!; }
async function click(label: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.getAttribute('aria-label') === label || item.textContent === label)!;
  expect(button).toBeTruthy(); await act(async () => button.click());
}
async function key(target: HTMLElement, value: string) {
  await act(async () => target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })));
}

it('shows today, official rest/work badges and an upcoming break without any network request', async () => {
  await render();
  expect(container.querySelectorAll('[role="gridcell"]')).toHaveLength(42);
  expect(date('2026-09-20').getAttribute('aria-current')).toBe('date');
  expect(date('2026-09-20').textContent).toContain('班');
  expect(date('2026-09-25').textContent).toContain('中秋节休');
  expect(container.querySelector('.calendar-upcoming')?.textContent).toContain('距今 5 天');
  expect(fetch).not.toHaveBeenCalled();
});

it('moves focus across month boundaries with keyboard and keeps only one date in the tab order', async () => {
  await render();
  await act(async () => date('2026-09-30').click());
  await key(date('2026-09-30'), 'ArrowRight');
  expect(container.querySelector('h2')?.textContent).toBe('2026年10月');
  expect(document.activeElement).toBe(date('2026-10-01'));
  expect(container.querySelectorAll('.calendar-day[tabindex="0"]')).toHaveLength(1);
  await key(date('2026-10-01'), 'Home');
  expect(document.activeElement).toBe(date('2026-09-28'));
  await key(date('2026-09-28'), 'PageDown');
  expect(document.activeElement).toBe(date('2026-10-28'));
  await click('今天');
  expect(date('2026-09-20').parentElement?.getAttribute('aria-selected')).toBe('true');
});

it('shows a missing-year notice and independently hides lunar and holiday information', async () => {
  await render();
  for (let i = 0; i < 4; i++) await click('下个月');
  expect(container.querySelector('h2')?.textContent).toBe('2027年1月');
  expect(container.querySelector('.calendar-source')?.textContent).toContain('2027 年放假安排待更新');
  await click('今天');
  await render(false, true);
  expect(container.querySelector('.calendar-day__lunar')).toBeNull();
  expect(date('2026-09-20').textContent).toContain('班');
  await render(true, false);
  expect(container.querySelector('.calendar-day__badge')).toBeNull();
  expect(container.querySelector('.calendar-source')).toBeNull();
  expect(date('2026-09-25').textContent).toContain('中秋节');
});
