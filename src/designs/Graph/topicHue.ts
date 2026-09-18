import type { GraphItem } from '../../types';

/** Deterministic hue in [0,360) from a topic label (FNV-1a). */
export function topicHue(topic: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < topic.length; i++) {
    h ^= topic.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 360;
}

/** id → hue for nodes that have a primary topic in topicMap. */
export function topicHueById(
  nodes: GraphItem[],
  topicMap: Map<string, string[]>
): Map<string, number> {
  const out = new Map<string, number>();
  for (const n of nodes) {
    const t = topicMap.get(n.id);
    if (t && t.length) out.set(n.id, topicHue(t[0]!));
  }
  return out;
}
