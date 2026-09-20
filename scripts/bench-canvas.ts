import { drawGraph, RenderTextCache, resizeCanvas, type RenderState } from '../src/designs/Graph/render';
import type { GraphNode } from '../src/types';
import type { FaviconCache } from '../src/designs/Graph/faviconCache';
import { RenderSpriteCache } from '../src/designs/Graph/spriteCache';
import { Engine } from '../src/designs/Graph/sim/engine';

// Served by bench-canvas.mjs. Synthetic data never touches user bookmarks.
const canvas = document.createElement('canvas');
document.body.style.cssText = 'margin:0;background:#f8f7f5;overflow:hidden';
document.body.append(canvas);
const ctx = canvas.getContext('2d')!;
const width = 1440, height = 900;
const dpr = resizeCanvas(canvas, width, height);
const theme = { fg: '#222', fgMuted: '#888', bg: 'oklch(0.98 0 0)', line: '#ccc' };
const frame = () => new Promise<number>(resolve => requestAnimationFrame(resolve));
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))];
const cameraAt = (elapsed: number) => ({ scale: .3 + .95 * (.5 - .5 * Math.cos(elapsed / 650)), tx: Math.sin(elapsed / 900) * 160, ty: Math.cos(elapsed / 900) * 80 });
let prepared: RenderState;
let frameBudgetMs = 1000 / 60;

async function calibrate() {
  const intervals = [];
  let previous = await frame();
  for (let i = 0; i < 45; i++) { const now = await frame(); intervals.push(now - previous); previous = now; }
  frameBudgetMs = percentile(intervals, .5);
  return { frameBudgetMs, refreshHz: 1000 / frameBudgetMs };
}

const icons = await Promise.all(Array.from({ length: 64 }, async (_, i) => {
  const icon = new Image();
  icon.src = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect x="3" y="3" width="58" height="58" rx="14" fill="hsl(${i * 31} 65% 50%)"/><path d="M20 18v28h26" fill="none" stroke="white" stroke-width="7"/></svg>`);
  await icon.decode();
  return icon;
}));

async function prepareScenario(count: number) {
  const cols = Math.ceil(Math.sqrt(count));
  const nodes: GraphNode[] = Array.from({ length: count }, (_, i) => ({
    id: String(i), parentId: `g${i % 12}`, name: `Bookmark ${i} · 参考文档`,
    url: `https://example.test/${i}`, group: 'Test', color: '#378adc', letter: 'L',
    visits: 1, last: '', nodeKind: i % 5 === 0 ? 'group' : 'bookmark', bookmarkCount: i,
    radius: i % 5 === 0 ? 32 : 25, groupHue: (i % 12) * 30,
    x: (i % cols - (cols - 1) / 2) * 110,
    y: (Math.floor(i / cols) - (Math.ceil(count / cols) - 1) / 2) * 110,
    vx: 0, vy: 0,
  }));
  const state: RenderState = {
    nodes, nodeById: new Map(nodes.map(n => [n.id, n])),
    edges: nodes.slice(1).map((n, i) => ({ id: `e${i}`, from: String(i), to: n.id, kind: 'auto', createdAt: 0 })),
    pins: {}, hoverNodeId: null, hoverEdgeId: null, draggingId: null, filterMatches: null,
    ghost: null, favicons: { get: (url: string) => {
      const index = Number(url.slice(url.lastIndexOf('/') + 1));
      return index % 7 === 0 ? null : icons[index % icons.length];
    } } as unknown as FaviconCache,
    highlightGroupId: null, focusNeighborhood: null, focusKind: null, textCache: new RenderTextCache(),
    spriteCache: new RenderSpriteCache(),
  };
  // Warm the same scene and zoom range before sampling steady interaction.
  for (let i = 0; i < 90; i++) {
    await frame();
    drawGraph(ctx, state, cameraAt(i * 40), theme, { width, height, dpr });
  }
  prepared = state;
  await frame(); await frame();
}

async function runScenario(durationMs = 4000) {
  const state = prepared;
  const count = state.nodes.length;
  const intervals: number[] = [], draws: number[] = [];
  let previous = await frame();
  const start = previous;
  while (previous - start < durationMs) {
    const now = await frame();
    intervals.push(now - previous);
    const t = performance.now();
    drawGraph(ctx, state, cameraAt(now - start), theme, { width, height, dpr });
    draws.push(performance.now() - t);
    previous = now;
  }
  const cache = state.spriteCache?.stats;
  state.spriteCache?.clear();
  return { count, cache, frames: draws.length, elapsedMs: previous - start,
    fps: draws.length * 1000 / (previous - start), frameP95Ms: percentile(intervals, .95),
    drawMedianMs: percentile(draws, .5), drawP95Ms: percentile(draws, .95),
    longFrames: intervals.filter(ms => ms > frameBudgetMs * 1.5).length, frameBudgetMs, width, height, dpr };
}

function runSimulationBenchmark() {
  const nodes = prepared.nodes.map(node => ({ ...node }));
  const engine = new Engine({ groupRadius: 0, groupStrength: .032 });
  engine.setTopology(nodes, [], new Map());
  engine.alphaTarget(.3);
  for (let i = 0; i < 30; i++) engine.tick();
  const ticks = [];
  for (let i = 0; i < 100; i++) { const started = performance.now(); engine.tick(); ticks.push(performance.now() - started); }
  return { count: nodes.length, tickMedianMs: percentile(ticks, .5), tickP95Ms: percentile(ticks, .95) };
}

Object.assign(window, { prepareScenario, runScenario, calibrate, runSimulationBenchmark });
