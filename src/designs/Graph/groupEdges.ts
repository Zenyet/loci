import type { GraphEdge, GraphItem } from '../../types';
import { edgeId } from './edges';

/** An opened folder is itself a relationship. Join its visible components,
 * preserving existing links and leaving the unscoped home graph untouched. */
export function computeGroupEdges(
  nodes: GraphItem[],
  existingEdges: GraphEdge[],
  scopeGroupId: string | null,
): GraphEdge[] {
  if (scopeGroupId === null || nodes.length < 2) return [];
  const parent = new Map(nodes.map(node => [node.id, node.id]));
  const root = (id: string): string => {
    let current = id;
    while (parent.get(current) !== current) current = parent.get(current)!;
    while (id !== current) {
      const next = parent.get(id)!;
      parent.set(id, current);
      id = next;
    }
    return current;
  };
  for (const edge of existingEdges) {
    if (parent.has(edge.from) && parent.has(edge.to)) {
      parent.set(root(edge.to), root(edge.from));
    }
  }
  const sorted = [...nodes].sort((a, b) => b.visits - a.visits || a.id.localeCompare(b.id));
  const hub = sorted[0]!;
  const edges: GraphEdge[] = [];
  for (const node of sorted.slice(1)) {
    if (root(hub.id) === root(node.id)) continue;
    parent.set(root(node.id), root(hub.id));
    edges.push({ id: edgeId(hub.id, node.id), from: hub.id, to: node.id, kind: 'auto' });
  }
  return edges;
}
