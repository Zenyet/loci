import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, it, expect, vi } from 'vitest';
import type { GraphItem, Group, PinsMap } from '../../../types';
import { radiusFor, useGraphSimCustom } from './useGraphSimCustom';
import type { GraphSim } from './types';
import { collectionPositions } from './collectionLayout';

describe('radiusFor', () => {
  it('gives bookmarks a large readable base radius', () => {
    expect(radiusFor(0, 'bookmark')).toBe(24);
  });

  it('grows bookmark radius slowly with visits and caps it', () => {
    expect(radiusFor(100, 'bookmark')).toBe(31); // 24 + sqrt(100)*0.7 = 31
    expect(radiusFor(1_000_000, 'bookmark')).toBe(32); // capped at 24 + 8
  });

  it('makes group nodes larger than bookmarks and caps them', () => {
    expect(radiusFor(1_000_000, 'group')).toBe(40); // capped at 30 + 10
  });

  it('grows groups gently with saved site count, including a true empty state', () => {
    expect(radiusFor(0, 'group')).toBe(30);
    expect(radiusFor(4, 'group')).toBeLessThan(radiusFor(25, 'group'));
    expect(radiusFor(25, 'group')).toBeLessThan(radiusFor(100, 'group'));
    expect(radiusFor(100, 'group')).toBe(radiusFor(10_000, 'group'));
  });
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('cools while a drag is held still and reheats when that node moves again', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const bookmarks: GraphItem[] = ['a', 'b'].map(id => ({ id, parentId: '', name: id, url: '', group: '', color: '', letter: id, visits: 0, last: '' }));
  let sim!: GraphSim;
  function Harness() { sim = useGraphSimCustom({ bookmarks, groups: [], edges: [], pins: {} }); return null; }
  const root = createRoot(document.createElement('div'));
  act(() => root.render(createElement(Harness)));
  try {
    sim.startDrag('a', 20, 30, new Set(['a', 'b']));
    for (let i = 0; i < 400; i++) sim.simulationRef.current!.tick();
    expect(sim.simulationRef.current!.alpha()).toBeLessThan(.003);
    sim.dragTo(20, 30);
    expect(sim.simulationRef.current!.alpha()).toBeLessThan(.003);
    sim.dragTo(80, 90);
    expect(sim.simulationRef.current!.alpha()).toBeGreaterThanOrEqual(.3);
    sim.simulationRef.current!.tick();
    expect(sim.findById('a')).toMatchObject({ x: 80, y: 90 });
    sim.endDrag(false);
  } finally { act(() => root.unmount()); }
});

describe('connected node dragging', () => {
  let root: ReturnType<typeof createRoot>;
  let sim: GraphSim;
  const bookmarks: GraphItem[] = ['a', 'b', 'pinned', 'unrelated'].map(id => ({
    id, parentId: '', name: id, url: '', group: '', color: '', letter: id, visits: 0, last: '',
  }));
  const edges: [] = [];
  const groups: [] = [];
  function Harness({ items = bookmarks, pins = {} }: { items?: GraphItem[]; pins?: PinsMap }) {
    sim = useGraphSimCustom({ bookmarks: items, groups, edges, pins });
    return null;
  }
  function mount(pins: PinsMap = {}) {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    root = createRoot(document.createElement('div'));
    act(() => root.render(createElement(Harness, { pins })));
    sim.nodesRef.current.forEach((node, i) => {
      if (!pins[node.id]) { node.x = i * 100; node.y = i * 50; }
    });
  }
  afterEach(() => { if (root) act(() => root.unmount()); });

  it('moves connected nodes with stable offsets, leaving pinned and unrelated nodes alone', () => {
    mount({ pinned: { x: 400, y: 200 } });
    const a = sim.findById('a')!, b = sim.findById('b')!;
    const pinned = { ...sim.findById('pinned')! }, unrelated = { ...sim.findById('unrelated')! };
    sim.startDrag('a', 20, 30, new Set(['a', 'b', 'pinned', 'missing']));
    expect(b).toMatchObject({ x: 120, y: 80, fx: 120, fy: 80 });
    sim.dragTo(300, -150);
    expect(a).toMatchObject({ x: 300, y: -150 });
    expect(b).toMatchObject({ x: 400, y: -100 });
    expect(sim.findById('pinned')).toEqual(pinned);
    expect(sim.findById('unrelated')).toEqual(unrelated);
    for (let i = 0; i < 30; i++) sim.simulationRef.current!.tick();
    expect(b.x - a.x).toBe(100);
    expect(b.y - a.y).toBe(50);
    expect(sim.endDrag(false)).toEqual({ id: 'a', x: 300, y: -150 });
    expect(a).toMatchObject({ fx: null, fy: null, vx: 0, vy: 0 });
    expect(b).toMatchObject({ fx: null, fy: null, vx: 0, vy: 0 });
    expect(sim.findById('pinned')).toMatchObject({ x: 400, y: 200, fx: 400, fy: 200 });
    sim.dragTo(999, 999);
    expect(a.x).toBe(300);
  });

  it('preserves the original pin when the grabbed node was already fixed', () => {
    mount({ a: { x: 5, y: 10 } });
    sim.startDrag('a', 100, 100, new Set(['a', 'b']));
    sim.endDrag(false);
    expect(sim.findById('a')).toMatchObject({ x: 5, y: 10, fx: 5, fy: 10 });
    expect(sim.findById('b')).toMatchObject({ fx: null, fy: null });
  });

  it('pins only the grabbed node when requested, releasing its neighbors', () => {
    mount();
    sim.startDrag('a', 200, 300, new Set(['a', 'b']));
    sim.endDrag(true);
    expect(sim.findById('a')).toMatchObject({ fx: 200, fy: 300 });
    expect(sim.findById('b')).toMatchObject({ fx: null, fy: null });
  });

  it('releases every temporary anchor when the topology changes or the view unmounts', () => {
    mount();
    const previous = sim.nodesRef.current;
    sim.startDrag('a', 100, 100, new Set(['a', 'b']));
    act(() => root.render(createElement(Harness, { items: bookmarks.filter(node => node.id !== 'a') })));
    for (const node of previous) expect(node).toMatchObject({ fx: null, fy: null });
    expect(sim.endDrag(false)).toBeNull();
    expect(sim.findById('a')).toBeNull();
    sim.startDrag('b', 200, 200, new Set(['b', 'unrelated']));
    const current = sim.nodesRef.current;
    act(() => root.unmount());
    for (const node of current) expect(node).toMatchObject({ fx: null, fy: null });
  });
});

function settledCollection(hiddenFolders = 0, looseSites = 0, splitParents = false) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const groups: Group[] = Array.from({ length: 4 + hiddenFolders }, (_, i) => ({
    id: `folder-${i}`, label: `${i}`, parentGroupId: null, depth: 0,
  }));
  const bookmarks: GraphItem[] = groups.slice(0, 4).map(group => ({
    id: `group:${group.id}`, parentId: group.id, groupId: group.id, nodeKind: 'group',
    name: group.label, url: '', group: '', color: '', letter: '', visits: 1_000_000, last: '', bookmarkCount: 4,
  }));
  for (let i = 0; i < looseSites; i++) {
    bookmarks.push({
      id: `site-${i}`, parentId: splitParents ? groups[i % 4].id : 'bar', nodeKind: 'bookmark',
      name: `${i}`, url: '', group: '', color: '', letter: '', visits: 0, last: '',
    });
  }
  let sim!: GraphSim;
  function Harness() {
    sim = useGraphSimCustom({ bookmarks, groups, edges: [], pins: {} });
    return null;
  }
  const root = createRoot(document.createElement('div'));
  act(() => root.render(createElement(Harness)));
  for (let i = 0; i < 400; i++) sim.simulationRef.current!.tick();
  const nodes = sim.nodesRef.current.map(node => ({ x: node.x, y: node.y, radius: node.radius }));
  act(() => root.unmount());
  return nodes;
}

describe('collection layout', () => {
  it('keeps four groups compact after settling and sizes them by sites, not visits', () => {
    const nodes = settledCollection();
    for (const node of nodes) {
      expect(Math.hypot(node.x, node.y)).toBeLessThan(235);
      expect(node.radius).toBe(radiusFor(4, 'group'));
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        expect(Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y)).toBeGreaterThan(nodes[i].radius + nodes[j].radius + 32);
      }
    }
  });

  it('does not spread visible nodes apart when unrelated folders exist elsewhere', () => {
    expect(settledCollection(20)).toEqual(settledCollection());
  });

  it('uses the same positions for mixed peers regardless of bookmark parent folders', () => {
    expect(settledCollection(0, 16, true)).toEqual(settledCollection(0, 16));
  });

  it('spreads mixed peers through a shared area without separating their radial ranges', () => {
    const nodes = settledCollection(0, 16);
    const folderRadii = nodes.slice(0, 4).map(node => Math.hypot(node.x, node.y));
    const siteRadii = nodes.slice(4).map(node => Math.hypot(node.x, node.y));
    expect(Math.min(...folderRadii)).toBeLessThan(Math.max(...siteRadii));
    expect(Math.max(...folderRadii)).toBeGreaterThan(Math.min(...siteRadii));
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        expect(Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y)).toBeGreaterThan(nodes[i].radius + nodes[j].radius);
      }
    }
  });

  it('seeds the same mixed positions when the incoming item order changes', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ id: `item-${i}` }));
    expect(collectionPositions(items)).toEqual(collectionPositions([...items].reverse()));
    expect(collectionPositions([{ id: 'only' }]).get('only')).toEqual({ x: 0, y: 0 });
  });
});
