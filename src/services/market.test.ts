import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type MarketInstrument } from '../types';
import { MARKET_INDICES, normalizeWidgets, patchWidgets } from './widgetSettings';
import { marketPhase, parseMarketQuotes, parseQuoteTime, quoteChange, refreshMarket, shanghaiTime } from './market';

const { webcrypto } = await vi.importActual<{ webcrypto: Crypto }>('node:crypto');

const fields = ['ts_code', 'name', 'close', 'pre_close', 'open', 'high', 'low', 'trade_time'];
const stock: MarketInstrument = { kind: 'stock', code: '000001.SZ', name: '测试个股' };
const config = () => patchWidgets(DEFAULT_SETTINGS.widgets, { market: { enabled: true, token: 'test-token-not-real', watchlist: [stock] } }).market;
const signal = () => new AbortController().signal;
const quoteData = (items: MarketInstrument[]) => ({ fields, items: items.map(i => [i.code, i.name, 102, 100, 100, 103, 99, '2026-09-22 10:00:00']) });
function mockProvider(stockError = false) {
  return vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const { api_name } = JSON.parse(init?.body as string);
    const data = api_name === 'trade_cal' ? { fields: ['cal_date', 'is_open'], items: [['20260922', 1]] } : quoteData(api_name === 'rt_idx_k' ? MARKET_INDICES : [stock]);
    return new Response(JSON.stringify(stockError && api_name === 'rt_k' ? { code: -1, msg: 'echo test-token-not-real' } : { code: 0, data }));
  });
}
beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-22T02:00:00Z')); vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('market data contract', () => {
  it('keeps unavailable prices and missing timestamps distinct from zeros or fetch time', () => {
    const quotes = parseMarketQuotes({ fields, items: [['000001.SZ', '测试', 0, 0, null, Infinity, -1, '10:00:00']] }, [stock]);
    expect(quotes[0]).toMatchObject({ id: 'stock:000001.SZ', price: null, previous: null, open: null, high: null, low: null, quoteTime: null });
    expect(quoteChange(quotes[0])).toBeNull();
    expect(() => parseMarketQuotes({ fields: ['close'], items: [[2]] }, [stock])).toThrow('缺少');
    expect(parseQuoteTime('2026-02-30 10:00:00')).toBeNull();
    expect(parseQuoteTime('20260922 10:00:00')).toBe('2026-09-22T10:00:00+08:00');
  });
  it('uses the exchange calendar and Shanghai time, without treating make-up workdays as trading days', () => {
    expect(marketPhase(false, new Date('2026-09-20T02:00:00Z'))).toBe('休市');
    expect(marketPhase(null)).toBe('交易状态待确认');
    expect(marketPhase(true, new Date('2026-09-22T03:30:00Z'))).toBe('午间休市');
    expect(marketPhase(true, new Date('2026-09-22T06:58:00Z'))).toBe('收盘竞价');
    expect(shanghaiTime(new Date('2026-09-21T17:00:00Z')).date).toBe('2026-09-22');
  });
  it('normalizes watchlists and preserves legacy widget settings without auto-enabling new widgets', () => {
    const value = normalizeWidgets({ todos: { enabled: true }, market: { watchlist: [stock, stock, { kind: 'stock', code: '000001.SH' }, { kind: 'stock', code: 'bad' }], summary: 'bad' } } as never);
    expect(value.pinned).toEqual(['todos']); expect(value.market.watchlist).toEqual([stock]);
    expect(value.market.summary).toBe('index:000001.SH'); expect(value.market.enabled).toBe(false); expect(value.notes.enabled).toBe(false);
    expect(patchWidgets(value, { market: { colors: 'mono' } }).market.watchlist).toEqual([stock]);
  });
});
describe('market request lifecycle', () => {
  it('coalesces tabs using persistent caches and never writes a raw credential into cache keys or values', async () => {
    const fetcher = mockProvider(); vi.stubGlobal('fetch', fetcher);
    const [a, b] = await Promise.all([refreshMarket(config(), signal()), refreshMarket(config(), signal())]);
    expect(a).toEqual(b); expect(a.quotes).toHaveLength(4); expect(a.errors).toEqual({}); expect(fetcher).toHaveBeenCalledTimes(3);
    expect(a.quotes.map(q => q.id)).toContain('index:000001.SH'); expect(a.quotes.map(q => q.id)).toContain('stock:000001.SZ');
    await refreshMarket(config(), signal(), true); expect(fetcher).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(localStorage)).not.toContain('test-token-not-real');
    expect(fetcher.mock.calls.every(([url, init]) => url === 'https://api.tushare.pro' && init?.redirect === 'error')).toBe(true);
  });
  it('retains available index data when stock permissions fail, sanitizes errors and honors the retry window', async () => {
    const fetcher = mockProvider(true); vi.stubGlobal('fetch', fetcher);
    const first = await refreshMarket(config(), signal());
    expect(first.quotes).toHaveLength(3); expect(first.errors['stock:000001.SZ']).toContain('接口权限');
    expect(JSON.stringify(first)).not.toContain('test-token');
    await refreshMarket(config(), signal(), true); expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('retains a successful subset with explicit missing-row status across cache reads', async () => {
    const fetcher = mockProvider(); vi.stubGlobal('fetch', fetcher);
    fetcher.mockImplementation(async (_url, init) => new Response(JSON.stringify({ code: 0, data: JSON.parse(init?.body as string).api_name === 'trade_cal' ? { fields: ['cal_date', 'is_open'], items: [['20260922', 1]] } : quoteData(MARKET_INDICES.slice(0, 2)) })));
    const options = { ...config(), watchlist: [] };
    const first = await refreshMarket(options, signal()); const second = await refreshMarket(options, signal());
    expect(first.quotes).toHaveLength(2); expect(second).toEqual(first); expect(first.errors['index:399006.SZ']).toContain('暂无新报价'); expect(first.errors['index:000001.SH']).toBeUndefined();
  });
  it('preserves last successful prices on rate limiting and does not bypass the cooldown via manual refresh', async () => {
    const fetcher = mockProvider(); vi.stubGlobal('fetch', fetcher);
    const options = { ...config(), watchlist: [] };
    const first = await refreshMarket(options, signal());
    vi.setSystemTime(Date.now() + 70_000);
    fetcher.mockImplementation(async () => new Response('{}', { status: 429, headers: { 'Retry-After': '600' } }));
    const failed = await refreshMarket(options, signal());
    expect(failed.quotes).toEqual(first.quotes); expect(failed.errors['index:000001.SH']).toContain('限流');
    const calls = fetcher.mock.calls.length;
    await refreshMarket(options, signal(), true); expect(fetcher).toHaveBeenCalledTimes(calls);
  });
  it('does not access the network when disabled, disconnected, denied, or already aborted', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(refreshMarket({ ...config(), enabled: false }, signal())).rejects.toThrow('连接');
    await expect(refreshMarket({ ...config(), token: '' }, signal())).rejects.toThrow('连接');
    vi.stubGlobal('chrome', { permissions: { contains: async () => false } });
    await expect(refreshMarket(config(), signal())).rejects.toThrow('允许');
    const controller = new AbortController(); controller.abort();
    await expect(refreshMarket(config(), controller.signal)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('separates credentials so old-account cache never masquerades as a new connection', async () => {
    const fetcher = mockProvider(); vi.stubGlobal('fetch', fetcher);
    await refreshMarket(config(), signal());
    await refreshMarket({ ...config(), token: 'another-test-token' }, signal());
    expect(fetcher).toHaveBeenCalledTimes(6);
  });
});
