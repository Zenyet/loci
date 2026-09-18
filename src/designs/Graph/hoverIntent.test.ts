import { describe, expect, it } from 'vitest';
import { HoverIntent } from './hoverIntent';

const a = { nodeId: 'a', edgeId: null }, b = { nodeId: 'b', edgeId: null };
const empty = { nodeId: null, edgeId: null };

describe('hover intent', () => {
  it('ignores fly-bys and accepts a stable target after 90 ms', () => {
    const intent = new HoverIntent();
    intent.offer(a, 0); expect(intent.advance(40)).toBe(true);
    intent.offer(b, 40); intent.advance(100);
    expect(intent.active).toEqual(empty);
    intent.offer(empty, 100); expect(intent.advance(200)).toBe(false);
    expect(intent.active).toEqual(empty);
    intent.offer(a, 220); expect(intent.advance(310)).toBe(false);
    expect(intent.active).toEqual(a);
  });
  it('does not restart the delay while moving inside one node', () => {
    const intent = new HoverIntent();
    intent.offer(a, 0); intent.offer({ ...a }, 50); intent.offer({ ...a }, 89);
    intent.advance(90); expect(intent.active).toEqual(a);
  });
  it('bridges brief gaps without a fade-out/fade-in cycle', () => {
    const intent = new HoverIntent(a);
    intent.offer(empty, 10); intent.advance(50); expect(intent.active).toEqual(a);
    intent.offer(a, 51); expect(intent.advance(70)).toBe(false);
    expect(intent.active).toEqual(a);
    intent.offer(empty, 100); intent.advance(160); expect(intent.active).toEqual(empty);
  });
  it('releases the previous highlight during a sustained rapid sweep', () => {
    const intent = new HoverIntent(a);
    for (let i = 1; i <= 5; i++) {
      intent.offer({ nodeId: `sweep-${i}`, edgeId: null }, i * 40);
      intent.advance(i * 40);
    }
    expect(intent.active).toEqual(empty);
  });
});
