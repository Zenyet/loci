/** Set of node ids sharing the focused node's primary topic (always includes id). */
export function topicNeighborhood(
  id: string,
  topicMap: Map<string, string[]>
): Set<string> {
  const own = topicMap.get(id);
  const primary = own && own.length ? own[0] : null;
  const out = new Set<string>([id]);
  if (primary == null) return out;
  for (const [other, topics] of topicMap) {
    if (topics.length && topics[0] === primary) out.add(other);
  }
  return out;
}
