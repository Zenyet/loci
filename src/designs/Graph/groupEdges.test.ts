import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphItem } from '../../types';
import { computeGroupEdges } from './groupEdges';
import { edgeId } from './edges';

const node = (id: string, visits = 0, nodeKind: GraphItem['nodeKind'] = 'bookmark'): GraphItem => ({
  id, visits, nodeKind, parentId: 'work', name: id, url: `https://${id}.example`,
  group: 'Work', color: '', letter: id, last: '',
});
const link = (from: string, to: string, kind: GraphEdge['kind'] = 'manual'): GraphEdge => ({
  from, to, kind, id: edgeId(from, to),
});

describe('opened group connections', () => {
  it('connects the whole group, including child folders, without a dense complete graph', () => {
    const nodes = [node('a'), node('b', 10), node('folder', 2, 'group'), node('c')];
    const edges = computeGroupEdges(nodes, [], 'work');
    expect(edges).toHaveLength(3);
    expect(new Set(edges.flatMap(edge => [edge.from, edge.to]))).toEqual(new Set(nodes.map(n => n.id)));
    expect(edges.every(edge => edge.kind === 'auto' && edge.from === 'b')).toBe(true);
  });

  it('does not force connections at home, or for empty/single-node groups', () => {
    expect(computeGroupEdges([node('a'), node('b')], [], null)).toEqual([]);
    expect(computeGroupEdges([], [], 'work')).toEqual([]);
    expect(computeGroupEdges([node('a')], [], 'work')).toEqual([]);
  });

  it('only bridges existing components, preserving manual and topic relationships', () => {
    const nodes = [node('a', 10), node('b'), node('c'), node('d')];
    const existing = [link('a', 'b'), link('c', 'd', 'auto')];
    expect(computeGroupEdges(nodes, existing, 'work')).toEqual([link('a', 'c', 'auto')]);
    expect(computeGroupEdges(nodes, [...existing, link('b', 'c')], 'work')).toEqual([]);
    expect(existing).toHaveLength(2);
  });

  it('ignores paths through nodes outside the open folder and is stable across input order', () => {
    const nodes = [node('a'), node('b'), node('c')];
    const existing = [link('a', 'outside'), link('outside', 'b')];
    const edges = computeGroupEdges(nodes, existing, 'work');
    expect(edges).toHaveLength(2);
    expect(computeGroupEdges([...nodes].reverse(), existing, 'work')).toEqual(edges);
  });
});
