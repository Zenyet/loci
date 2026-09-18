import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GroupColor } from '../types';
import { ColorPalette } from './ColorPicker';
let root: Root, container: HTMLDivElement;
const change = vi.fn();
function Harness() {
  const [color, setColor] = useState<GroupColor>('#123456');
  return <ColorPalette value={color} onChange={next => { change(next); setColor(next); }} />;
}
async function input(label: string, value: string) {
  const el = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  change.mockClear();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe('full color picker', () => {
  it('keeps RGB and HEX in sync without accepting invalid hex', async () => {
    await input('HEX 颜色', '#1z2z3z');
    expect(change).not.toHaveBeenCalled();
    await input('HEX 颜色', '#010203');
    expect(change).toHaveBeenLastCalledWith('#010203');
    expect(container.querySelector<HTMLInputElement>('[aria-label="RGB B"]')!.value).toBe('3');
    await input('RGB R', '255');
    expect(change).toHaveBeenLastCalledWith('#ff0203');
    expect(container.querySelector<HTMLInputElement>('[aria-label="HEX 颜色"]')!.value).toBe('#FF0203');
  });

  it('preserves the editing hue at black and allows leaving black via the keyboard', async () => {
    await input('HEX 颜色', '#ff0000');
    const plane = container.querySelector<HTMLElement>('[aria-label="饱和度和明度色板"]')!;
    for (let i = 0; i < 11; i++) await act(async () => plane.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true })));
    expect(change).toHaveBeenLastCalledWith('#000000');
    await input('色相', '120');
    await act(async () => plane.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true })));
    expect(change).toHaveBeenLastCalledWith('#001a00');
  });

  it('keeps a screen-picked gray exactly instead of discarding it', async () => {
    vi.stubGlobal('EyeDropper', class { async open() { return { sRGBHex: '#808080' }; } });
    await act(async () => root.render(<Harness />));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="从屏幕取色"]')!.click());
    expect(change).toHaveBeenLastCalledWith('#808080');
  });
});
