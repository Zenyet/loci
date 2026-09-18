import { describe, it, expect } from 'vitest';
import { topicNeighborhood } from './topicNeighborhood';

describe('topicNeighborhood', () => {
  const topics = new Map([
    ['a', ['dev']], ['b', ['dev']], ['c', ['news']],
  ]);
  it('returns all node ids sharing the focused node primary topic, incl. itself', () => {
    expect(topicNeighborhood('a', topics)).toEqual(new Set(['a', 'b']));
  });
  it('returns just the node itself when it has no topic', () => {
    expect(topicNeighborhood('z', topics)).toEqual(new Set(['z']));
  });
});
