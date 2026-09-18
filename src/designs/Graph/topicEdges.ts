import type { GraphEdge, GraphItem } from '../../types';
import { edgeId } from './edges';

/** Highest-visit node wins; ties break by id ascending for stable output. */
function hubOf(nodes: GraphItem[]): GraphItem {
  return [...nodes].sort((a, b) => b.visits - a.visits || (a.id < b.id ? -1 : 1))[0]!;
}

/**
 * Connect bookmarks with the same primary AI topic to that topic's busiest
 * member. Distinct topics, unclassified bookmarks, and folders stay separate.
 * Display-only ('auto') edges never shadow a manual edge.
 */
export function computeTopicEdges(
  nodes: GraphItem[],
  topicMap: Map<string, string[]>,
  manualEdges: GraphEdge[]
): GraphEdge[] {
  if (nodes.length < 2) return [];

  const seen = new Set<string>();
  for (const e of manualEdges) seen.add(edgeId(e.from, e.to));

  const out: GraphEdge[] = [];
  const link = (a: GraphItem, b: GraphItem): void => {
    if (a.id === b.id) return;
    const id = edgeId(a.id, b.id);
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, from: a.id, to: b.id, kind: 'auto' });
  };

  const byTopic = new Map<string, GraphItem[]>();
  for (const n of nodes) {
    if (n.nodeKind === 'group') continue;
    const key = topicMap.get(n.id)?.[0]?.trim();
    if (!key) continue;
    const bucket = byTopic.get(key);
    if (bucket) bucket.push(n);
    else byTopic.set(key, [n]);
  }

  for (const members of byTopic.values()) {
    const hub = hubOf(members);
    for (const n of members) link(hub, n);
  }

  return out;
}
