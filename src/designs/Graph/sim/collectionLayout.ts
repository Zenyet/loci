/** Seed peers across a filled area, without giving folders or loose sites an orbit. */
export function collectionPositions(items: readonly { id: string }[]): Map<string, { x: number; y: number }> {
  const hash = (id: string) => {
    let value = 2166136261;
    for (let i = 0; i < id.length; i++) value = Math.imul(value ^ id.charCodeAt(i), 16777619);
    // Avalanche adjacent numeric IDs as well as unrelated strings.
    value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
    value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
    value ^= value >>> 16;
    return value >>> 0;
  };
  // Graph items arrive folders-first. Mix by stable identity so neither kind
  // always starts at the center or on the outside; array order does not matter.
  const ordered = items.map(item => ({ id: item.id, rank: hash(item.id) }))
    .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
  const positions = ordered.map((item, i) => {
    const angle = i * Math.PI * (3 - Math.sqrt(5));
    const radius = 80 * Math.sqrt(i + .5);
    return { id: item.id, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
  const total = Math.max(1, positions.length);
  const cx = positions.reduce((sum, point) => sum + point.x, 0) / total;
  const cy = positions.reduce((sum, point) => sum + point.y, 0) / total;
  return new Map(positions.map(point => [point.id, { x: point.x - cx, y: point.y - cy }]));
}
