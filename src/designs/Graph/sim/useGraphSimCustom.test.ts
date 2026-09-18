import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, it, expect, vi } from 'vitest';
import type { GraphItem, Group } from '../../../types';
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
