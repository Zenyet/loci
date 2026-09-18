import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextMenu, type MenuItem } from './ContextMenu';

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();
const onAction = vi.fn();
const items: MenuItem[] = [
  { label: '添加书签', icon: 'bookmark', onClick: onAction },
  { label: '不可用', disabled: true, onClick: onAction },
  { label: '分组管理', icon: 'folder', separatorBefore: true, onClick: onAction },
];
async function render(x = 100, y = 100) {
  await act(async () => root.render(<ContextMenu x={x} y={y} items={items} onClose={onClose} />));
}
async function key(value: string) {
  await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })));
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  onClose.mockReset();
  onAction.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Context menu', () => {
  it('uses keyboard navigation, skips disabled actions, and closes without bubbling Escape', async () => {
    const globalKey = vi.fn();
    window.addEventListener('keydown', globalKey);
    try {
      await render();
      expect(document.activeElement?.getAttribute('role')).toBe('menu');
      await key('ArrowDown');
      expect(document.activeElement?.textContent).toBe('添加书签');
      await key('ArrowDown');
      expect(document.activeElement?.textContent).toBe('分组管理');
      await key('ArrowDown');
      expect(document.activeElement?.textContent).toBe('添加书签');
      await key('Escape');
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(globalKey).not.toHaveBeenCalled();
      expect(onAction).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', globalKey);
    }
  });

  it('clamps the measured menu within every viewport edge', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 240, bottom: 180, width: 240, height: 180, toJSON: () => {},
    });
    await render(window.innerWidth - 2, window.innerHeight - 2);
    const menu = container.querySelector<HTMLElement>('[role="menu"]')!;
    expect(menu.style.left).toBe(`${window.innerWidth - 248}px`);
    expect(menu.style.top).toBe(`${window.innerHeight - 188}px`);
    await render(-20, -30);
    expect(menu.style.left).toBe('8px');
    expect(menu.style.top).toBe('8px');
  });

  it('keeps disabled actions inert and invokes an enabled action once', async () => {
    await render();
    const buttons = container.querySelectorAll<HTMLButtonElement>('button');
    await act(async () => buttons[1]!.click());
    expect(onAction).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => buttons[0]!.click());
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
