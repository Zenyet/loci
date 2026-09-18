export interface HoverTarget { nodeId: string | null; edgeId: string | null }
const EMPTY: HoverTarget = { nodeId: null, edgeId: null };
const same = (a: HoverTarget, b: HoverTarget) => a.nodeId === b.nodeId && a.edgeId === b.edgeId;

/** Briefly crossing a node should not launch a new spotlight animation.
 * Moving within the same target does not restart the dwell time. */
export class HoverIntent {
  active: HoverTarget;
  private candidate: HoverTarget;
  private deadline = 0;
  private departureAt: number | null = null;

  constructor(initial: HoverTarget = EMPTY) {
    this.active = initial;
    this.candidate = initial;
  }

  offer(target: HoverTarget, now: number): void {
    if (same(target, this.candidate)) return;
    this.candidate = target;
    this.deadline = now + (target.nodeId || target.edgeId ? 90 : 60);
    if (same(target, this.active)) this.departureAt = null;
    else this.departureAt ??= now;
  }

  advance(now: number): boolean {
    if (same(this.candidate, this.active)) return false;
    if (now >= this.deadline) {
      this.active = this.candidate;
      this.departureAt = null;
      return false;
    }
    // During a long rapid sweep, release the old spotlight instead of leaving
    // an unrelated node highlighted indefinitely while candidates keep changing.
    if (this.departureAt !== null && now - this.departureAt >= 140) this.active = EMPTY;
    return !same(this.candidate, this.active);
  }
}
