/** Per-node opacity keeps enter, leave, and moving between nodes continuous. */
export function advanceHoverFade(
  opacity: Map<string, number>,
  nodeIds: Iterable<string>,
  activeId: string | null,
  elapsedMs: number,
  reducedMotion: boolean,
): boolean {
  const visible = new Set(nodeIds);
  for (const id of opacity.keys()) if (!visible.has(id)) opacity.delete(id);
  let animating = false;
  const amount = 1 - Math.exp(-Math.max(0, elapsedMs) / 85);
  for (const id of visible) {
    const target = activeId && activeId !== id ? 0.3 : 1;
    const previous = opacity.get(id) ?? 1;
    const next = reducedMotion ? target : previous + (target - previous) * amount;
    const settled = Math.abs(next - target) < 0.002;
    opacity.set(id, settled ? target : next);
    animating ||= !settled;
  }
  return animating;
}
