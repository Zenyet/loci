import { describe, it, expect } from 'vitest';
import type { GraphEdge, GraphItem } from '../../types';
import { computeAutoEdges, baseDomain } from './autoEdges';
import { edgeId } from './edges';

const item = (id: string, url: string, visits = 0): GraphItem => ({
  id,
  parentId: 'root',
  name: id,
  url,
  group: 'g',
  color: '#000',
  letter: id[0]!.toUpperCase(),
  visits,
  last: '',
});

const inFolder = (id: string, parentId: string, visits = 0): GraphItem => ({
  ...item(id, `https://${id}.com`, visits),
  parentId,
});

const groupItem = (id: string): GraphItem => ({
  ...item(id, 'newtab://group/' + id),
  nodeKind: 'group',
});

describe('baseDomain', () => {
  it('reduces subdomains to the registrable domain', () => {
    expect(baseDomain('mail.google.com')).toBe('google.com');
    expect(baseDomain('drive.google.com')).toBe('google.com');
    expect(baseDomain('google.com')).toBe('google.com');
  });

  it('handles a known two-level TLD', () => {
    expect(baseDomain('foo.bar.co.uk')).toBe('bar.co.uk');
  });
});

describe('computeAutoEdges', () => {
  it('connects same-cluster bookmarks in a star to the most-visited hub', () => {
    const nodes = [
      item('a', 'https://chatgpt.com', 50),
      item('b', 'https://claude.ai', 80),
      item('c', 'https://gemini.google.com', 30),
    ];
    const out = computeAutoEdges(nodes, []);
    // hub = b (80 visits); edges b-a and b-c.
    expect(out).toHaveLength(2);
    expect(out.every((e) => e.kind === 'auto')).toBe(true);
    const pairs = out.map((e) => [e.from, e.to].sort().join('-')).sort();
    expect(pairs).toEqual(['a-b', 'b-c']);
  });

  it('connects same-domain subdomains in a star', () => {
    const nodes = [
      item('m', 'https://mail.google.com', 10),
      item('d', 'https://drive.google.com', 40),
      item('g', 'https://google.com', 20),
    ];
    const out = computeAutoEdges(nodes, []);
    expect(out).toHaveLength(2); // hub = d
    const pairs = out.map((e) => [e.from, e.to].sort().join('-')).sort();
    expect(pairs).toEqual(['d-g', 'd-m']);
  });

  it('does not duplicate a pair already connected by a manual edge', () => {
    const nodes = [
      item('a', 'https://chatgpt.com', 50),
      item('b', 'https://claude.ai', 80),
    ];
    const manual: GraphEdge[] = [{ id: 'a b', from: 'a', to: 'b', kind: 'manual' }];
    expect(computeAutoEdges(nodes, manual)).toEqual([]);
  });

  it('does not duplicate a pair matched by both rules', () => {
    // Two sites that share BOTH a cluster and a domain → only one edge.
    const nodes = [
      item('x', 'https://gemini.google.com', 5),
      item('y', 'https://aistudio.google.com', 9),
    ];
    const out = computeAutoEdges(nodes, []);
    expect(out).toHaveLength(1);
  });

  it('skips group nodes and unparseable urls', () => {
    const nodes = [groupItem('grp'), item('a', 'not-a-url', 1), item('b', 'also-bad', 2)];
    expect(computeAutoEdges(nodes, [])).toEqual([]);
  });
});

describe('unrelated nodes', () => {
  it('does not connect unrelated bookmarks in the same folder', () => {
    expect(computeAutoEdges([
      inFolder('a', 'work', 5), inFolder('b', 'work', 9),
    ], [])).toEqual([]);
  });

  it('does not connect unrelated bookmarks across folders or singleton groups', () => {
    expect(computeAutoEdges([
      inFolder('a', 'work', 5), inFolder('b', 'work', 9),
      inFolder('c', 'play', 2), inFolder('d', 'play', 7),
      inFolder('e', 'solo', 100),
    ], [])).toEqual([]);
  });

  it('keeps folders and unrelated bookmarks separate from a related cluster', () => {
    const nodes = [
      groupItem('folder-a'), groupItem('folder-b'),
      item('ai-a', 'https://chatgpt.com', 10),
      item('ai-b', 'https://claude.ai', 5),
      item('unrelated', 'https://independent.example', 100),
    ];
    expect(computeAutoEdges(nodes, []).map(e => e.id)).toEqual([edgeId('ai-a', 'ai-b')]);
  });

  it('allows distinct related clusters without linking their hubs', () => {
    const nodes = [
      item('a', 'https://one.example.com', 10), item('b', 'https://two.example.com'),
      item('c', 'https://one.example.org', 20), item('d', 'https://two.example.org'),
    ];
    expect(computeAutoEdges(nodes, []).map(e => e.id).sort()).toEqual([
      edgeId('a', 'b'), edgeId('c', 'd'),
    ]);
  });
});
