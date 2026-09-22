import { z } from 'zod';
import type { MarketInstrument, WidgetSettings } from '../types';
import { instrumentId, MARKET_INDICES } from './widgetSettings';
import { readLocal, withLocalLock, writeLocal } from './localStore';

export const MARKET_ORIGINS = ['https://api.tushare.pro/*'];
const ENDPOINT = 'https://api.tushare.pro';
export const MARKET_MIN_REFRESH = 30_000;
const finite = z.number().finite();
const quoteSchema = z.object({ id: z.string(), code: z.string(), name: z.string(), kind: z.enum(['index', 'stock']),
  price: finite.nullable(), previous: finite.nullable(), open: finite.nullable(), high: finite.nullable(), low: finite.nullable(),
  quoteTime: z.string().nullable(), fetchedAt: finite });
export type MarketQuote = z.infer<typeof quoteSchema>;
export interface MarketSnapshot {
  quotes: MarketQuote[];
  errors: Record<string, string>;
  tradingDate: string;
  isTradingDay: boolean | null;
}
const cacheSchema = z.object({ fetchedAt: finite, phase: z.string(), quotes: z.array(quoteSchema), errors: z.record(z.string(), z.string()).default({}) });
const envelope = z.object({ code: z.number(), data: z.object({ fields: z.array(z.string()), items: z.array(z.array(z.unknown())) }).nullable().optional() });
export class MarketError extends Error {
  constructor(message: string, public retryAfter = 120_000) { super(message); }
}
export async function hasMarketPermission() {
  return typeof chrome === 'undefined' || !chrome.permissions ? true : chrome.permissions.contains({ origins: MARKET_ORIGINS });
}
/** Call synchronously from the connect button's user gesture. */
export async function requestMarketPermission() {
  return typeof chrome === 'undefined' || !chrome.permissions ? true : chrome.permissions.request({ origins: MARKET_ORIGINS });
}
export function shanghaiTime(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  return { date: `${part('year')}-${part('month')}-${part('day')}`, minute: Number(part('hour')) * 60 + Number(part('minute')) };
}
export function marketPhase(isTradingDay: boolean | null, now = new Date()) {
  if (isTradingDay === null) return '交易状态待确认';
  if (!isTradingDay) return '休市';
  const { minute } = shanghaiTime(now);
  if (minute < 555) return '盘前';
  if (minute < 565) return '开盘竞价';
  if (minute < 570) return '等待开盘';
  if (minute < 690) return '交易中';
  if (minute < 780) return '午间休市';
  if (minute < 897) return '交易中';
  if (minute < 900) return '收盘竞价';
  return '竞价已收盘';
}
export function quoteChange(quote: MarketQuote | undefined) {
  if (quote?.price == null || quote.previous == null || quote.previous <= 0) return null;
  return { amount: quote.price - quote.previous, percent: (quote.price - quote.previous) / quote.previous * 100 };
}
export const marketNumber = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const marketPercent = (quote: MarketQuote | undefined) => { const change = quoteChange(quote); return change ? `${change.percent > 0 ? '+' : ''}${change.percent.toFixed(2)}%` : '—'; };

async function accountKey(token: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
async function request(token: string, api: string, params: Record<string, string>, signal: AbortSignal, fields: string) {
  signal.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 12_000);
  try {
    const response = await fetch(ENDPOINT, { method: 'POST', body: JSON.stringify({ api_name: api, token, params, fields }),
      headers: { 'Content-Type': 'application/json' }, signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
    if (response.status === 429) {
      const retry = response.headers.get('Retry-After');
      const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - Date.now() : 900_000;
      throw new MarketError('行情服务限流，请稍后刷新。', Number.isFinite(delay) ? Math.max(60_000, delay) : 900_000);
    }
    if (!response.ok) throw new MarketError('行情服务暂时不可用，请稍后重试。');
    const parsed = envelope.safeParse(await response.json());
    if (!parsed.success) throw new MarketError('行情数据格式不完整。');
    // Never surface the provider's raw message: it could echo request credentials.
    if (parsed.data.code !== 0) throw new MarketError('请求未获通过，请检查 Token、对应接口权限和调用额度。', 300_000);
    if (!parsed.data.data) throw new MarketError('数据源没有返回行情。');
    return parsed.data.data;
  } catch (error) {
    if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    if (error instanceof MarketError) throw error;
    throw new MarketError(controller.signal.aborted ? '行情请求超时，请稍后重试。' : '无法连接行情服务，请检查网络和扩展权限。');
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}
function rowObjects(data: { fields: string[]; items: unknown[][] }) {
  return data.items.map(row => Object.fromEntries(data.fields.map((field, i) => [field, row[i]])));
}
/** Only full, valid provider timestamps are accepted; never replace them with fetch time. */
export function parseQuoteTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{4})-?(\d{2})-?(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const normalized = `${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`;
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime()) || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 || shanghaiTime(date).date !== `${year}-${month}-${day}`) return null;
  return normalized;
}
export function parseMarketQuotes(data: { fields: string[]; items: unknown[][] }, instruments: MarketInstrument[], fetchedAt = Date.now()): MarketQuote[] {
  if (!['ts_code', 'close', 'pre_close'].every(field => data.fields.includes(field))) throw new MarketError('行情缺少代码、最新价或昨收字段。');
  const rows = rowObjects(data);
  const price = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
  return instruments.flatMap(item => {
    const row = rows.find(r => r.ts_code === item.code);
    if (!row) return [];
    return [{ id: instrumentId(item), code: item.code, kind: item.kind, name: typeof row.name === 'string' && row.name.trim() ? row.name.slice(0, 40) : item.name || item.code,
      price: price(row.close), previous: price(row.pre_close), open: price(row.open), high: price(row.high), low: price(row.low), quoteTime: parseQuoteTime(row.trade_time), fetchedAt }];
  });
}

async function tradingDay(token: string, account: string, signal: AbortSignal): Promise<boolean | null> {
  const date = shanghaiTime().date;
  const key = `loci-market-calendar:${account}:${date}`;
  const schema = z.object({ open: z.boolean().nullable(), fetchedAt: finite });
  const parsed = schema.safeParse(await readLocal(key));
  if (parsed.success && parsed.data.fetchedAt <= Date.now() && Date.now() - parsed.data.fetchedAt < (parsed.data.open === null ? 3_600_000 : 86_400_000)) return parsed.data.open;
  let open: boolean | null = null;
  try {
    const day = date.replaceAll('-', '');
    const rows = rowObjects(await request(token, 'trade_cal', { exchange: 'SSE', start_date: day, end_date: day }, signal, 'cal_date,is_open'));
    const row = rows.find(item => item.cal_date === day);
    if (row?.is_open === 0 || row?.is_open === 1) open = row.is_open === 1;
  } catch { signal.throwIfAborted(); }
  signal.throwIfAborted();
  await writeLocal(key, { open, fetchedAt: Date.now() });
  return open;
}

export async function refreshMarket(config: WidgetSettings['market'], signal: AbortSignal, force = false): Promise<MarketSnapshot> {
  signal.throwIfAborted();
  if (!config.enabled || !config.token) throw new MarketError('请先连接行情服务。');
  if (!await hasMarketPermission()) throw new MarketError('请先允许连接 Tushare。');
  const account = await accountKey(config.token);
  return withLocalLock(`market:${account}`, async () => {
    signal.throwIfAborted();
    if (!await hasMarketPermission()) throw new MarketError('行情服务权限已移除，请重新连接。');
    const isTradingDay = await tradingDay(config.token, account, signal);
    const tradingDate = shanghaiTime().date;
    const phase = marketPhase(isTradingDay);
    const active = ['交易中', '开盘竞价', '收盘竞价'].includes(phase);
    const snapshot: MarketSnapshot = { quotes: [], errors: {}, isTradingDay, tradingDate };
    // Separate endpoints preserve indices when the stock subscription is unavailable (and vice versa).
    for (const instruments of [MARKET_INDICES, config.watchlist]) {
      if (!instruments.length) continue;
      const kind = instruments[0].kind;
      const key = `loci-market-v1:${account}:${kind}:${instruments.map(i => i.code).sort().join(',')}`;
      const parsed = cacheSchema.safeParse(await readLocal(key));
      const cached = parsed.success && parsed.data.fetchedAt <= Date.now() ? parsed.data : null;
      const retryKey = `loci-market-retry:${account}:${kind}`;
      const retry = z.object({ at: finite, message: z.string() }).safeParse(await readLocal(retryKey));
      const maxAge = force ? MARKET_MIN_REFRESH : active ? 60_000 : 6 * 3_600_000;
      let quotes = cached?.quotes ?? [];
      Object.assign(snapshot.errors, cached?.errors);
      try {
        if (retry.success && retry.data.at > Date.now()) throw new MarketError(retry.data.message, retry.data.at - Date.now());
        if (!cached || Date.now() - cached.fetchedAt >= maxAge || (!force && cached.phase !== `${tradingDate}:${phase}`)) {
          const result = await request(config.token, kind === 'index' ? 'rt_idx_k' : 'rt_k', { ts_code: instruments.map(i => i.code).join(',') }, signal, 'ts_code,name,close,pre_close,open,high,low,trade_time');
          const incoming = parseMarketQuotes(result, instruments);
          for (const instrument of instruments) delete snapshot.errors[instrumentId(instrument)];
          // Missing rows retain their last record and remain explicitly marked unavailable.
          const missing = instruments.filter(item => !incoming.some(q => q.id === instrumentId(item)));
          quotes = [...incoming, ...(cached?.quotes ?? []).filter(q => missing.some(item => instrumentId(item) === q.id))];
          for (const item of missing) snapshot.errors[instrumentId(item)] = '暂无新报价，可能停牌、代码无效或数据暂缺。';
          signal.throwIfAborted();
          const errors = Object.fromEntries(missing.map(item => [instrumentId(item), snapshot.errors[instrumentId(item)]]));
          await writeLocal(key, { fetchedAt: Date.now(), phase: `${tradingDate}:${phase}`, quotes, errors });
        }
      } catch (error) {
        signal.throwIfAborted();
        const failure = error instanceof MarketError ? error : new MarketError('无法保存行情缓存，请检查本地存储。');
        for (const item of instruments) snapshot.errors[instrumentId(item)] = failure.message;
        if (!retry.success || retry.data.at <= Date.now()) await writeLocal(retryKey, { at: Date.now() + failure.retryAfter, message: failure.message }).catch(() => {});
      }
      snapshot.quotes.push(...quotes.filter(q => instruments.some(item => instrumentId(item) === q.id)));
    }
    return snapshot;
  }, signal);
}
