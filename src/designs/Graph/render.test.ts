import { describe, expect, it, vi } from 'vitest';
import type { GraphNode } from '../../types';
import type { FaviconCache } from './faviconCache';
import {
  avatarColor,
  drawGraph,
  edgeStyleFor,
  hueForNode,
  oklchLightness,
  RenderTextCache,
  resizeCanvas,
  labelMaterial,
  type RenderState,
  type Theme,
} from './render';

function createContext(
  drawImage: CanvasRenderingContext2D['drawImage'],
  fillRect: CanvasRenderingContext2D['fillRect'] = vi.fn() as unknown as CanvasRenderingContext2D['fillRect']
) {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    clip: vi.fn(),
    fillRect,
    drawImage,
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    closePath: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    measureText: vi.fn((text: string) => ({ width: text.length * 6 }) as TextMetrics),
    setLineDash: vi.fn(),
    roundRect: vi.fn(),
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'center' as CanvasTextAlign,
    textBaseline: 'middle' as CanvasTextBaseline,
    lineJoin: 'round' as CanvasLineJoin,
    lineCap: 'round' as CanvasLineCap,
    globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
  } as unknown as CanvasRenderingContext2D;
}

function readyFavicon(): HTMLImageElement {
  return {
    complete: true,
    naturalWidth: 16,
    naturalHeight: 16,
  } as HTMLImageElement;
}

const node: GraphNode = {
  id: 'bookmark-1',
  parentId: 'folder-1',
  name: 'Example',
  url: 'https://example.com',
  group: 'Work',
  color: '#123456',
  letter: 'EX',
  visits: 0,
  last: '-',
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  radius: 20,
  groupHue: 120,
};

const theme: Theme = {
  fg: '#fff',
  fgMuted: '#888',
  bg: '#000',
  line: '#333',
};

function stateWithFavicons(favicons: FaviconCache): RenderState {
  return {
    nodes: [node],
    nodeById: new Map([[node.id, node]]),
    edges: [],
    pins: {},
    hoverNodeId: null,
    hoverEdgeId: null,
    draggingId: null,
    filterMatches: null,
    ghost: null,
    favicons,
    highlightGroupId: null,
    focusNeighborhood: null,
    focusKind: null,
    textCache: new RenderTextCache(),
  };
}

describe('drawGraph', () => {
  it.each(['#000000', '#ffffff', '#102030'] as const)('preserves the selected folder color %s in canvas shading', color => {
    const ctx = createContext(vi.fn());
    const stops = vi.fn();
    ctx.createLinearGradient = vi.fn(() => ({ addColorStop: stops })) as unknown as CanvasRenderingContext2D['createLinearGradient'];
    const group: GraphNode = { ...node, nodeKind: 'group', groupHue: color };
    const favicons = { get: () => null } as unknown as FaviconCache;
    drawGraph(ctx, { ...stateWithFavicons(favicons), nodes: [group], nodeById: new Map([[group.id, group]]) },
      { scale: 1, tx: 0, ty: 0 }, theme, { width: 800, height: 600, dpr: 1 });
    expect(stops).toHaveBeenCalledWith(.25, color);
  });

  it.each([0, 24, 12345])('keeps the exact group count of %i in its upper-right badge without hovering', (count) => {
    const favicons = { get: () => readyFavicon(), markBroken: vi.fn() } as unknown as FaviconCache;
    const ctx = createContext(vi.fn());
    const group: GraphNode = { ...node, nodeKind: 'group', bookmarkCount: count, name: '工具' };
    drawGraph(ctx, { ...stateWithFavicons(favicons), nodes: [group], nodeById: new Map([[group.id, group]]) },
      { scale: 1, tx: 0, ty: 0 }, theme, { width: 800, height: 600, dpr: 1 });
    expect(ctx.fillText).toHaveBeenCalledWith(String(count), group.x + group.radius * .74, group.y - group.radius * .74 + .5);
    expect(ctx.fillText).toHaveBeenCalledWith('工具', group.x, group.y + group.radius + 7);
    expect(ctx.fillText).toHaveBeenCalledTimes(2);
  });

  it('fades the label with its icon and renders regular text without an outline', () => {
    const favicons = { get: () => readyFavicon(), markBroken: vi.fn() } as unknown as FaviconCache;
    const ctx = createContext(vi.fn());
    const samples: { alpha: number; font: string }[] = [];
    ctx.drawImage = vi.fn(() => { samples.push({ alpha: ctx.globalAlpha, font: ctx.font }); });
    ctx.fillText = vi.fn(() => { samples.push({ alpha: ctx.globalAlpha, font: ctx.font }); });
    drawGraph(ctx, { ...stateWithFavicons(favicons), nodeOpacity: new Map([[node.id, .42]]) },
      { scale: 1, tx: 0, ty: 0 }, theme, { width: 100, height: 100, dpr: 1 });
    expect(samples.map(sample => sample.alpha)).toEqual([.42, .42]);
    expect(samples[1].font).toContain('400 14px');
    expect(ctx.strokeText).not.toHaveBeenCalled();
  });

  it('draws the favicon as the node, with no backing shape', () => {
    const markBroken = vi.fn();
    const favicons = {
      get: vi.fn(() => readyFavicon()),
      markBroken,
    } as unknown as FaviconCache;
    const drawImage = vi.fn();
    const ctx = createContext(
      drawImage as unknown as CanvasRenderingContext2D['drawImage']
    );

    drawGraph(
      ctx,
      stateWithFavicons(favicons),
      { scale: 1, tx: 0, ty: 0 },
      theme,
      { width: 100, height: 100, dpr: 1 }
    );

    // Frameless: the favicon is drawn and nothing backs or breaks it.
    expect(drawImage).toHaveBeenCalled();
    expect(markBroken).not.toHaveBeenCalled();
  });

  it('falls back instead of throwing when a cached favicon becomes broken', () => {
    const markBroken = vi.fn();
    const favicons = {
      get: vi.fn(() => readyFavicon()),
      markBroken,
    } as unknown as FaviconCache;
    const drawImage = vi.fn(() => {
      throw new DOMException('broken image', 'InvalidStateError');
    }) as unknown as CanvasRenderingContext2D['drawImage'];
    const ctx = createContext(drawImage);

    expect(() =>
      drawGraph(
        ctx,
        stateWithFavicons(favicons),
        { scale: 1, tx: 0, ty: 0 },
        theme,
        { width: 100, height: 100, dpr: 1 }
      )
    ).not.toThrow();
    expect(markBroken).toHaveBeenCalledWith('https://example.com');
  });
});

it('does not clear an unchanged canvas backing store on redundant resize notifications', () => {
  const canvas = document.createElement('canvas');
  resizeCanvas(canvas, 100, 80);
  const widthSetter = vi.spyOn(canvas, 'width', 'set');
  const heightSetter = vi.spyOn(canvas, 'height', 'set');
  resizeCanvas(canvas, 100, 80);
  expect(widthSetter).not.toHaveBeenCalled(); expect(heightSetter).not.toHaveBeenCalled();
  widthSetter.mockRestore(); heightSetter.mockRestore();
});

it('enforces the backing pixel budget even on a CSS viewport larger than 6 megapixels', () => {
  const canvas = document.createElement('canvas');
  const dpr = resizeCanvas(canvas, 8000, 4000);
  expect(dpr).toBeLessThan(1);
  expect(canvas.width * canvas.height).toBeLessThanOrEqual(6_000_000);
});

it('keeps hovered and matching labels readable in a dense zoomed-out overview', () => {
  const nodes = Array.from({ length: 200 }, (_, i) => ({ ...node, id: `${i}`, name: `Node ${i}`, x: i * 5 }));
  const favicons = { get: () => readyFavicon() } as unknown as FaviconCache;
  const state = { ...stateWithFavicons(favicons), nodes, nodeById: new Map(nodes.map(n => [n.id, n])),
    hoverNodeId: '0', filterMatches: new Set(['1']) };
  const ctx = createContext(vi.fn());
  drawGraph(ctx, state, { scale: .3, tx: 0, ty: 0 }, theme, { width: 800, height: 600, dpr: 1 });
  const labels = vi.mocked(ctx.fillText).mock.calls.map(args => args[0]);
  expect(labels).toContain('Node 0');
  expect(labels).toContain('Node 1');
  expect(labels).not.toContain('Node 2');
});

it('keeps dragged neighbors labeled at low zoom and emphasizes their connections', () => {
  const nodes = Array.from({ length: 200 }, (_, i) => ({ ...node, id: `${i}`, name: `Node ${i}`, x: i * 5 }));
  const favicons = { get: () => readyFavicon() } as unknown as FaviconCache;
  const state: RenderState = { ...stateWithFavicons(favicons), nodes, nodeById: new Map(nodes.map(n => [n.id, n])),
    draggingId: '0', dragNeighborhood: new Set(['0', '1']),
    edges: [{ id: 'direct', from: '0', to: '1', kind: 'auto' }, { id: 'other', from: '2', to: '3', kind: 'auto' }] };
  const ctx = createContext(vi.fn());
  const strokes: { width: number; alpha: number }[] = [];
  ctx.stroke = vi.fn(() => { strokes.push({ width: ctx.lineWidth, alpha: ctx.globalAlpha }); });
  drawGraph(ctx, state, { scale: .3, tx: 0, ty: 0 }, theme, { width: 800, height: 600, dpr: 1 });
  const labels = vi.mocked(ctx.fillText).mock.calls.map(args => args[0]);
  expect(labels).toEqual(['Node 0', 'Node 1']);
  expect(strokes[0]).toEqual({ width: 2.5, alpha: 1 });
  expect(strokes[1]).toEqual({ width: 1.3, alpha: .5 });
});

describe('edgeStyleFor', () => {
  it('draws auto edges as a visible, solid connective web', () => {
    // Auto edges are now the primary connective tissue (every node joins one
    // web), not a rare same-domain hint — so they must read clearly. A
    // sub-pixel, low-alpha dashed line vanishes once the camera zooms out.
    const s = edgeStyleFor('auto', false);
    expect(s.lineWidth).toBeGreaterThanOrEqual(1);
    expect(s.alphaMul).toBeGreaterThanOrEqual(0.45);
    expect(s.dash).toEqual([]);
  });

  it('draws manual edges solid and more prominent than auto', () => {
    const manual = edgeStyleFor('manual', false);
    const auto = edgeStyleFor('auto', false);
    expect(manual.dash).toEqual([]);
    expect(manual.lineWidth).toBeGreaterThan(auto.lineWidth);
    expect(manual.alphaMul).toBeGreaterThan(auto.alphaMul);
  });

  it('hover overrides kind with a solid prominent style', () => {
    const s = edgeStyleFor('auto', true);
    expect(s.dash).toEqual([]);
    expect(s.lineWidth).toBeGreaterThanOrEqual(2);
    expect(s.alphaMul).toBe(1);
  });
});

describe('avatarColor', () => {
  it('is deterministic for the same seed', () => {
    expect(avatarColor('https://github.com')).toBe(avatarColor('https://github.com'));
  });

  it('returns an oklch string', () => {
    expect(avatarColor('x')).toMatch(/^oklch\(/);
  });

  it('varies hue across different seeds', () => {
    expect(avatarColor('https://a.com')).not.toBe(avatarColor('https://b.com'));
  });
});

describe('oklchLightness', () => {
  it('reads the L channel from an oklch string', () => {
    expect(oklchLightness('oklch(0.18 0.008 60)')).toBeCloseTo(0.18);
  });

  it('tolerates leading whitespace from getComputedStyle', () => {
    expect(oklchLightness(' oklch(0.96 0.006 80)')).toBeCloseTo(0.96);
  });

  it('defaults to 1 (treated as light) for non-oklch input', () => {
    expect(oklchLightness('#111')).toBe(1);
  });
});

describe('hueForNode', () => {
  const node = { id: 'a', groupHue: 120 } as never;
  it('prefers a topic hue when present', () => {
    expect(hueForNode(node, new Map([['a', 47]]))).toBe(47);
  });
  it('falls back to groupHue when no topic hue', () => {
    expect(hueForNode(node, new Map())).toBe(120);
    expect(hueForNode(node, null)).toBe(120);
  });
});

describe('label surfaces on arbitrary wallpaper', () => {
  const luminance = (channels: number[]) => channels.map(channel => {
    const value = channel / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const rgb = (hex: string) => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));

  it.each(['oklch(0.97 0.006 75)', 'oklch(0.22 0.008 265)'])('keeps text contrast on both black and white wallpaper: %s', background => {
    const material = labelMaterial(background);
    const values = material.background.match(/[\d.]+/g)!.map(Number);
    for (const wallpaper of [0, 255]) {
      const surface = values.slice(0, 3).map(channel => channel * values[3] + wallpaper * (1 - values[3]));
      for (const ink of [material.foreground, material.secondary]) {
        const a = luminance(rgb(ink)), b = luminance(surface);
        expect((Math.max(a, b) + .05) / (Math.min(a, b) + .05)).toBeGreaterThan(4.5);
      }
    }
  });

  it('caches label widths across animation frames', () => {
    const ctx = createContext(vi.fn()); const cache = new RenderTextCache();
    ctx.font = '400 14px sans-serif';
    cache.width(ctx, 'Example'); cache.width(ctx, 'Example');
    expect(ctx.measureText).toHaveBeenCalledOnce();
    ctx.font = '400 11px sans-serif'; cache.width(ctx, 'Example');
    expect(ctx.measureText).toHaveBeenCalledTimes(2);
  });
});
