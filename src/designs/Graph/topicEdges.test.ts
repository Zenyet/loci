import { describe, it, expect } from 'vitest';
import type { GraphEdge, GraphItem } from '../../types';
import { computeTopicEdges } from './topicEdges';
import { edgeId } from './edges';

const item = (id: string, visits = 0, topics: string[] = []): GraphItem => ({
  id, parentId: 'root', name: id, url: `https://${id}.com`, group: 'g',
  color: '#000', letter: id[0]!.toUpperCase(), visits, last: '', topics,
});

describe('computeTopicEdges', () => {
  it('returns nothing for fewer than two nodes', () => {
    expect(computeTopicEdges([], new Map(), [])).toEqual([]);
    expect(computeTopicEdges([item('a')], new Map([['a', ['dev']]]), [])).toEqual([]);
  });

  it('connects within each topic without linking unrelated topic hubs', () => {
    const nodes = [item('a', 5), item('b', 9), item('c', 2), item('d', 7), item('e', 1)];
    const topics = new Map([
      ['a', ['dev']], ['b', ['dev']], ['c', ['news']], ['d', ['news']], ['e', ['solo']],
    ]);
    const out = computeTopicEdges(nodes, topics, []);
    expect(out.every((e) => e.kind === 'auto')).toBe(true);
    expect(out.map(e => e.id).sort()).toEqual([edgeId('a', 'b'), edgeId('c', 'd')]);
  });

  it('uses topics[0] as the primary cluster key', () => {
    const nodes = [item('a', 1), item('b', 2)];
    const topics = new Map([['a', ['dev', 'x']], ['b', ['dev', 'y']]]);
    const out = computeTopicEdges(nodes, topics, []);
    expect(out).toHaveLength(1);
    expect([out[0]!.from, out[0]!.to].sort()).toEqual(['a', 'b']);
  });

  it('leaves a node with no topic disconnected', () => {
    const nodes = [item('a', 1, ['dev']), item('b', 2, ['dev']), item('c', 3)];
    const topics = new Map([['a', ['dev']], ['b', ['dev']]]); // c absent
    const out = computeTopicEdges(nodes, topics, []);
    expect(out.map(e => e.id)).toEqual([edgeId('a', 'b')]);
  });

  it('does not connect empty topics, folders, or unrelated primary topics', () => {
    const nodes = [item('a'), item('b'), item('c'), item('d'),
      { ...item('folder'), nodeKind: 'group' as const }];
    const topics = new Map([
      ['a', []], ['b', [' ']], ['c', ['dev']], ['d', ['news']], ['folder', ['dev']],
    ]);
    expect(computeTopicEdges(nodes, topics, [])).toEqual([]);
    expect(computeTopicEdges(nodes, new Map(), [])).toEqual([]);
  });

  it('does not shadow a manual edge', () => {
    const nodes = [item('a', 1), item('b', 2)];
    const topics = new Map([['a', ['dev']], ['b', ['dev']]]);
    const manual: GraphEdge[] = [{ id: edgeId('a', 'b'), from: 'b', to: 'a', kind: 'manual' }];
    expect(computeTopicEdges(nodes, topics, manual)).toEqual([]);
  });
});
