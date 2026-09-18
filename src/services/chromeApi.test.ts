import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../types';
import { faviconCandidates } from './chromeApi';

describe('DEFAULT_SETTINGS.showEdges', () => {
  it('defaults edge drawing to on', () => {
    expect(DEFAULT_SETTINGS.showEdges).toBe(true);
  });
});

describe('faviconCandidates', () => {
  it('prefers the high-res apple-touch-icon first, .ico last', () => {
    expect(faviconCandidates('https://example.com')).toEqual([
      'https://example.com/apple-touch-icon.png',
      'https://example.com/favicon.png',
      'https://example.com/favicon.ico',
    ]);
  });

  it('tolerates a bare host without scheme', () => {
    expect(faviconCandidates('example.com')[0]).toBe(
      'https://example.com/apple-touch-icon.png'
    );
  });

  it('returns [] for an unparseable url', () => {
    expect(faviconCandidates('http://')).toEqual([]);
  });
});

import { normalizeSettings as _nz } from './chromeApi';

describe('normalizeSettings ai defaults', () => {
  it('fills ai defaults when absent', () => {
    const s = _nz({} as never);
    expect(s.ai).toEqual({ provider: 'off', apiKey: '', baseUrl: '', model: '' });
  });
  it('coerces an invalid provider back to off', () => {
    const s = _nz({ ai: { provider: 'bogus', apiKey: 'k', baseUrl: '', model: '' } } as never);
    expect(s.ai.provider).toBe('off');
    expect(s.ai.apiKey).toBe('k');
  });
});

describe('normalizeSettings grouping', () => {
  it('fills grouping defaults when absent', () => {
    const s = _nz({ theme: 'dark' } as never);
    expect(s.grouping).toEqual({
      granularity: 'balanced',
      minGroupSize: 2,
      nameLanguage: 'auto',
      scope: 'ungrouped',
      reuseExisting: true,
    });
  });

  it('resets invalid enum fields but keeps valid overrides', () => {
    const s = _nz({ grouping: { granularity: 'nope', scope: 'all', minGroupSize: 5 } } as never);
    expect(s.grouping.granularity).toBe('balanced'); // invalid → default
    expect(s.grouping.scope).toBe('all');            // valid override kept
    expect(s.grouping.minGroupSize).toBe(5);
  });
});


describe('recent history destinations', () => {
  it('retains the full path, query, and fragment so reopening returns to the visited page', async () => {
    vi.resetModules();
    const url = 'https://docs.example.com/guide/colors?lang=zh#rgb';
    vi.stubGlobal('chrome', {
      bookmarks: { getTree: async () => [{ children: [{ id: '1', children: [{ id: 'bookmark', title: 'Docs', url }] }] }] },
      history: { search: async () => [{ title: 'Color guide', url, lastVisitTime: Date.now() }] },
    });
    try {
      const { loadChromeData } = await import('./chromeApi');
      expect((await loadChromeData()).recents[0]!.url).toBe(url);
    } finally { vi.unstubAllGlobals(); vi.resetModules(); }
  });
});
