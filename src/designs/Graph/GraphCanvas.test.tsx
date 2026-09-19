import { act, useEffect, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { GraphCanvas } from './GraphCanvas';
import { drawGraph } from './render';
import { findNodeAt } from './hitTest';

const mocks = vi.hoisted(() => {
  const node = { id: 'folder', parentId: '', nodeKind: 'group', groupId: 'folder', name: 'Folder', url: '', group: '', color: '', letter: '', visits: 0, last: '', x: 0, y: 0, vx: 0, vy: 0, radius: 30, groupHue: 120 };
  return {
    node,
    sim: { nodesRef: { current: [node] }, simulationRef: { current: null }, startDrag: vi.fn(), dragTo: vi.fn(), endDrag: vi.fn(), reheat: vi.fn(), findById: vi.fn(() => node) },
    camera: { cameraRef: { current: { scale: 1, tx: 0, ty: 0 } }, subscribe: vi.fn(() => () => {}), cancelFocus: vi.fn(), focusReset: vi.fn(), focusOnWorldPoint: vi.fn(), reset: vi.fn(), wheelZoom: vi.fn() },
  };
});
vi.mock('./useGraphSim', () => ({ useGraphSim: () => mocks.sim }));
vi.mock('./useCamera', async importOriginal => ({ ...await importOriginal<object>(), useCamera: () => mocks.camera }));
vi.mock('./render', async importOriginal => ({ ...await importOriginal<object>(), drawGraph: vi.fn(), resizeCanvas: () => 1 }));
vi.mock('./hitTest', async importOriginal => {
  const original = await importOriginal<typeof import('./hitTest')>();
  return { ...original, findNodeAt: vi.fn(original.findNodeAt) };
});

let root: Root;
let container: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;
let sequence: number;
let frameAt: number;
const props: ComponentProps<typeof GraphCanvas> = {
  bookmarks: [], groups: [], edges: [], pins: {}, filterText: '', filterMatches: null,
  focusBookmarkId: null, focusNeighborhood: null, focusKind: null, focusGroupId: null,
  highlightGroupId: null, themeKey: 'light', reduceMotion: true,
  onRequestEdge: vi.fn(), onOpenBookmark: vi.fn(), onOpenGroup: vi.fn(), onBookmarkMenu: vi.fn(),
  onGroupMenu: vi.fn(), onEdgeMenu: vi.fn(), onCanvasMenu: vi.fn(), onFocusNode: vi.fn(),
};
async function flushFrame(elapsed = 16) { frameAt += elapsed; await act(async () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(frameAt)); }); }
async function settleHover() { await flushFrame(); await flushFrame(100); }
function latest() { return vi.mocked(drawGraph).mock.calls.at(-1)![1]; }
function pointer(target: Element, type: string, x = 500, y = 300) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  target.dispatchEvent(event);
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  frames = new Map(); sequence = 0; frameAt = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600, toJSON() {} });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.mocked(drawGraph).mockClear(); mocks.sim.endDrag.mockClear(); mocks.sim.dragTo.mockClear();
  vi.mocked(findNodeAt).mockClear(); vi.mocked(props.onOpenGroup).mockClear();
  await act(async () => root.render(<GraphCanvas {...props}/>));
  await flushFrame();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('uses the new folder theme on the first frame after the parent applies settings', async () => {
  const previous = document.body.style.getPropertyValue('--bg');
  function ThemeHost({ mode }: { mode: 'light' | 'dark' }) {
    useEffect(() => {
      document.body.style.setProperty('--bg', mode === 'light' ? 'oklch(0.98 0 0)' : 'oklch(0.22 0 0)');
    }, [mode]);
    return <GraphCanvas {...props} themeKey={mode}/>;
  }
  try {
    for (const mode of ['light', 'dark', 'light'] as const) {
      await act(async () => root.render(<ThemeHost mode={mode}/>));
      await flushFrame();
      expect(vi.mocked(drawGraph).mock.calls.at(-1)![3].bg)
        .toBe(mode === 'light' ? 'oklch(0.98 0 0)' : 'oklch(0.22 0 0)');
    }
  } finally {
    if (previous) document.body.style.setProperty('--bg', previous);
    else document.body.style.removeProperty('--bg');
  }
});

describe('Canvas modal isolation', () => {
  it('does not hover nodes when the pointer belongs to an overlay at the same coordinates', async () => {
    const canvas = container.querySelector('canvas')!;
    pointer(canvas, 'pointermove'); await settleHover();
    expect(latest().hoverNodeId).toBe('folder');
    const overlay = document.createElement('div'); container.append(overlay);
    pointer(overlay, 'pointermove'); await flushFrame();
    expect(latest().hoverNodeId).toBeNull();
  });

  it('clears existing hover and ignores all pointer events until the modal closes', async () => {
    const canvas = container.querySelector('canvas')!;
    pointer(canvas, 'pointermove'); await settleHover();
    expect(latest().hoverNodeId).toBe('folder');
    await act(async () => root.render(<GraphCanvas {...props} interactionBlocked/>));
    await flushFrame();
    expect(latest().hoverNodeId).toBeNull();
    expect(latest().hoverProgress).toBe(0);
    pointer(canvas, 'pointermove'); await settleHover();
    expect(latest().hoverNodeId).toBeNull();
    await act(async () => root.render(<GraphCanvas {...props}/>));
    pointer(canvas, 'pointermove'); await settleHover();
    expect(latest().hoverNodeId).toBe('folder');
  });

  it('cancels an active drag when a modal opens', async () => {
    const canvas = container.querySelector('canvas')!;
    canvas.setPointerCapture = vi.fn(); canvas.hasPointerCapture = vi.fn(() => true); canvas.releasePointerCapture = vi.fn();
    pointer(canvas, 'pointerdown'); pointer(canvas, 'pointermove', 510, 300); await flushFrame();
    expect(latest().draggingId).toBe('folder');
    await act(async () => root.render(<GraphCanvas {...props} interactionBlocked/>));
    await flushFrame();
    expect(mocks.sim.endDrag).toHaveBeenCalledWith(false);
    expect(latest().draggingId).toBeNull();
    expect(canvas.releasePointerCapture).toHaveBeenCalledWith(1);
  });
});

describe('hover input scheduling', () => {
  it('hit-tests only the latest pointer position once per frame', async () => {
    const canvas = container.querySelector('canvas')!;
    for (let i = 0; i < 100; i++) pointer(canvas, 'pointermove', 500 + i % 4, 300);
    expect(findNodeAt).not.toHaveBeenCalled();
    await flushFrame();
    expect(findNodeAt).toHaveBeenCalledOnce();
    expect(latest().hoverNodeId).toBeNull();
    await flushFrame(100);
    expect(findNodeAt).toHaveBeenCalledOnce();
    expect(latest().hoverNodeId).toBe('folder');
  });

  it('does not animate a node crossed between frames', async () => {
    const canvas = container.querySelector('canvas')!;
    const draws = vi.mocked(drawGraph).mock.calls.length;
    pointer(canvas, 'pointermove'); pointer(canvas, 'pointermove', 800, 300);
    await flushFrame(); await flushFrame(150);
    expect(findNodeAt).toHaveBeenCalledOnce();
    expect(vi.mocked(drawGraph).mock.calls.length).toBe(draws);
    expect(latest().hoverNodeId).toBeNull();
  });

  it('does not repaint stable empty space for every pointer event', async () => {
    const canvas = container.querySelector('canvas')!;
    const draws = vi.mocked(drawGraph).mock.calls.length;
    for (let i = 0; i < 10; i++) { pointer(canvas, 'pointermove', 800 + i, 300); await flushFrame(); }
    expect(vi.mocked(drawGraph).mock.calls.length).toBe(draws);
  });

  it('clicks immediately without waiting for hover intent', async () => {
    const canvas = container.querySelector('canvas')!;
    pointer(canvas, 'pointermove'); pointer(canvas, 'pointerdown'); pointer(canvas, 'pointerup');
    expect(props.onOpenGroup).toHaveBeenCalledWith('folder');
  });

  it('discards a pending highlight when a modal opens', async () => {
    const canvas = container.querySelector('canvas')!;
    pointer(canvas, 'pointermove'); await flushFrame();
    await act(async () => root.render(<GraphCanvas {...props} interactionBlocked/>));
    await flushFrame(150);
    expect(latest().hoverNodeId).toBeNull();
  });
});
