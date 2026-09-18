import { describe, it, expect } from 'vitest';
import type { GraphItem } from '../../types';
import { topicHue, topicHueById } from './topicHue';

const item = (id: string, topics?: string[]): GraphItem => ({
  id, parentId: 'root', name: id, url: `https://${id}.com`, group: 'g',
  color: '#000', letter: 'X', visits: 0, last: '', topics,
});

describe('topicHue', () => {
  it('is deterministic and in [0,360)', () => {
    const h = topicHue('dev');
    expect(topicHue('dev')).toBe(h);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(360);
  });
  it('differs for different topics', () => {
    expect(topicHue('dev')).not.toBe(topicHue('news'));
  });
});

describe('topicHueById', () => {
  it('maps each node id to its primary topic hue, skipping topicless nodes', () => {
    const map = topicHueById([item('a', ['dev']), item('b', [])], new Map([['a', ['dev']]]));
    expect(map.get('a')).toBe(topicHue('dev'));
    expect(map.has('b')).toBe(false);
  });
});
