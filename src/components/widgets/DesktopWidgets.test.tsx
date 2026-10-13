import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DesktopWidgets } from './DesktopWidgets';
import { DEFAULT_SETTINGS, type WidgetSettings } from '../../types';
import { normalizeWidgets, patchWidgets } from '../../services/widgetSettings';
let root: Root, container: HTMLDivElement;
let latest: WidgetSettings;
let delayAcknowledgement = false, acknowledge = () => {};
let paintId = 0;
const paints = new Map<number, FrameRequestCallback>();
function Harness() {
  const [settings, setSettings] = useState(() => normalizeWidgets(JSON.parse(localStorage.getItem('test-desktop') || 'null') ?? patchWidgets(DEFAULT_SETTINGS.widgets, { notes: { enabled: true } })));
  latest = settings;
  return <DesktopWidgets settings={settings} now={new Date(2026,9,12)} blocked={false} onChange={next => { localStorage.setItem('test-desktop', JSON.stringify(next)); if (delayAcknowledgement) acknowledge = () => setSettings(next); else setSettings(next); }} onConfigure={() => {}} onEditing={() => {}} render={() => '内容'} />;
}
beforeEach(async () => { delayAcknowledgement = false; paints.clear(); vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { paints.set(++paintId, callback); return paintId; }); vi.stubGlobal('cancelAnimationFrame', (id: number) => paints.delete(id)); localStorage.clear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); await act(async () => root.render(<Harness />)); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function button(label: string) { const b = container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!; await act(async () => b.click()); return b; }
it('moves a card with keyboard, persists it across remount, and keeps its data/position when removed', async () => {
  await button('编辑小组件');
  const move = container.querySelector<HTMLButtonElement>('[aria-label="移动便签"]')!;
  await act(async () => move.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
  const position = latest.desktop.layout.notes!; expect(position.x).toBeGreaterThan(0);
  await act(async () => root.unmount()); root = createRoot(container); await act(async () => root.render(<Harness />));
  expect(latest.desktop.layout.notes).toEqual(position);
  await button('编辑小组件'); await button('移除便签');
  expect(latest.notes.enabled).toBe(false); expect(latest.desktop.layout.notes).toEqual(position);
});
it('cancels a pointer drag with Escape without saving its transient position', async () => {
  await button('编辑小组件'); const move = container.querySelector<HTMLButtonElement>('[aria-label="移动便签"]')!;
  move.setPointerCapture = vi.fn(); move.hasPointerCapture = () => false;
  await act(async () => move.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 40, clientY: 100, bubbles: true, cancelable: true })));
  await act(async () => move.dispatchEvent(new MouseEvent('pointermove', { clientX: 220, clientY: 160, bubbles: true })));
  expect(container.querySelector('[data-moving]')).not.toBeNull();
  await act(async () => move.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(latest.desktop.layout.notes).toBeUndefined(); expect(container.querySelector('[data-moving]')).toBeNull();
});
it('saves a released pointer drag inside the viewport and retains the position on remount', async () => {
  await button('编辑小组件'); const move = container.querySelector<HTMLButtonElement>('[aria-label="移动便签"]')!;
  move.setPointerCapture = vi.fn(); move.hasPointerCapture = () => false;
  await act(async () => move.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 40, clientY: 100, bubbles: true, cancelable: true })));
  await act(async () => move.dispatchEvent(new MouseEvent('pointermove', { clientX: 4000, clientY: 4000, bubbles: true })));
  await act(async () => move.dispatchEvent(new MouseEvent('pointerup', { clientX: 4000, clientY: 4000, bubbles: true })));
  expect(latest.desktop.layout.notes).toEqual({ x: 1, y: 1, size: 'small', coordinateSpace: 'viewport' });
  await act(async () => root.unmount()); root = createRoot(container); await act(async () => root.render(<Harness />));
  expect(latest.desktop.layout.notes).toEqual({ x: 1, y: 1, size: 'small', coordinateSpace: 'viewport' });
});

async function pointer(target: Element, type: string, clientX: number, clientY: number, pointerId = 1) {
  const event = new MouseEvent(type, { button: 0, clientX, clientY, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  await act(async () => target.dispatchEvent(event));
  await act(async () => { const jobs = [...paints.values()]; paints.clear(); jobs.forEach(job => job(performance.now())); });
}
async function dragHandle() {
  await button('编辑小组件');
  const move = container.querySelector<HTMLButtonElement>('[aria-label="移动便签"]')!;
  move.setPointerCapture = vi.fn(); move.hasPointerCapture = () => false;
  return move;
}
it('shows pickup feedback immediately and commits a quick release without any pointermove', async () => {
  const move = await dragHandle();
  const card = move.closest('article')!;
  const left = Number.parseFloat(card.style.left), top = Number.parseFloat(card.style.top);
  await pointer(move, 'pointerdown', left + 80, top + 60);
  expect(card.hasAttribute('data-moving')).toBe(true);
  expect(container.querySelector('.widget-drag-origin')).not.toBeNull();
  expect(move.textContent).not.toContain('松手放置');
  // A fast release must not depend on another move event or a dwell timer.
  await pointer(move, 'pointerup', left - 120, top + 90);
  expect(Number.parseFloat(card.style.left)).toBeCloseTo(left - 200);
  expect(Number.parseFloat(card.style.top)).toBeCloseTo(top + 30);
  expect(card.hasAttribute('data-settling')).toBe(true);
  expect(move.textContent).not.toContain('已放置');
  expect(card.hasAttribute('data-moving')).toBe(false);
  expect(latest.desktop.layout.notes).toBeDefined();
});
it('uses the release position beyond the last move, and ignores capture loss after committing', async () => {
  const move = await dragHandle();
  const card = move.closest('article')!;
  const left = Number.parseFloat(card.style.left), top = Number.parseFloat(card.style.top);
  await pointer(move, 'pointerdown', left + 80, top + 60);
  await pointer(move, 'pointermove', left - 20, top + 70);
  await pointer(move, 'pointerup', left - 120, top + 90);
  await pointer(move, 'lostpointercapture', 0, 0);
  expect(Number.parseFloat(card.style.left)).toBeCloseTo(left - 200);
  expect(Number.parseFloat(card.style.top)).toBeCloseTo(top + 30);
  expect(card.hasAttribute('data-settling')).toBe(true);
  expect(move.textContent).not.toContain('已放置');
});
it('does not let a second pointer end a drag, and cancels on blur without saving', async () => {
  const move = await dragHandle();
  await pointer(move, 'pointerdown', 400, 200);
  await pointer(move, 'pointermove', 250, 230);
  const position = move.closest('article')!.getAttribute('style');
  await pointer(move, 'pointermove', 900, 500, 2);
  await pointer(move, 'pointerup', 900, 500, 2);
  expect(move.closest('article')!.getAttribute('style')).toBe(position);
  expect(latest.desktop.layout.notes).toBeUndefined();
  await act(async () => window.dispatchEvent(new Event('blur')));
  await pointer(move, 'pointerup', 250, 230);
  expect(container.querySelector('[data-moving]')).toBeNull();
  expect(latest.desktop.layout.notes).toBeUndefined();
  expect(container.querySelector('[role=status]')?.textContent).toContain('已取消移动');
});
it('does not pin a default card just by clicking its drag handle', async () => {
  const move = await dragHandle();
  await pointer(move, 'pointerdown', 400, 200);
  await pointer(move, 'pointerup', 400, 200);
  expect(latest.desktop.layout.notes).toBeUndefined();
  expect(container.querySelector('[data-moving]')).toBeNull();
});

it('keeps the dropped frame visible while controlled settings arrive late', async () => {
  delayAcknowledgement = true;
  const move = await dragHandle();
  const card = move.closest('article')!;
  const left = Number.parseFloat(card.style.left), top = Number.parseFloat(card.style.top);
  await pointer(move, 'pointerdown', left + 80, top + 60);
  await pointer(move, 'pointerup', left - 120, top + 90);
  expect(latest.desktop.layout.notes).toBeUndefined();
  expect(Number.parseFloat(card.style.left)).toBeCloseTo(left - 200);
  expect(Number.parseFloat(card.style.top)).toBeCloseTo(top + 30);
  await act(async () => acknowledge());
  expect(Number.parseFloat(card.style.left)).toBeCloseTo(left - 200);
  expect(Number.parseFloat(card.style.top)).toBeCloseTo(top + 30);
});
it('lifts a scrolled default card in viewport coordinates without jumping on release', async () => {
  const move = await dragHandle();
  const layer = container.querySelector<HTMLElement>('.desktop-widgets')!;
  const card = move.closest('article')!;
  const left = Number.parseFloat(card.style.left), top = Number.parseFloat(card.style.top);
  layer.scrollTop = 100;
  await pointer(move, 'pointerdown', left + 80, top - 100 + 60);
  expect(Number.parseFloat(card.style.top)).toBe(top - 100);
  expect(card.style.position).toBe('fixed');
  await pointer(move, 'pointerup', left - 120, top - 100 + 90);
  const result = Number.parseFloat(card.style.top);
  expect(result).toBeCloseTo(top - 70);
  layer.scrollTop = 0;
  expect(Number.parseFloat(card.style.top)).toBeCloseTo(result);
});
it('drops flush to the top-left edge and keeps edge controls inside the card', async () => {
  const move = await dragHandle();
  const card = move.closest('article')!;
  const left = Number.parseFloat(card.style.left), top = Number.parseFloat(card.style.top);
  await pointer(move, 'pointerdown', left + 80, top + 60);
  await pointer(move, 'pointermove', 83, 63);
  expect(container.querySelector<HTMLElement>('.desktop-widgets')!.dataset.dragEdges).toBe('left top');
  await pointer(move, 'pointerup', 83, 63);
  expect(card.style.left).toBe('0px'); expect(card.style.top).toBe('0px');
  expect(latest.desktop.layout.notes).toEqual({ x: 0, y: 0, size: 'small', coordinateSpace: 'viewport' });
});
