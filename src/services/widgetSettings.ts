import { DEFAULT_SETTINGS, type WeatherCity, type WidgetId, type WidgetSettings, type WidgetToolId, type MarketInstrument, type DesktopWidgetId, type WidgetPlacement } from '../types';

export const MARKET_INDICES: MarketInstrument[] = [
  { kind: 'index', code: '000001.SH', name: '上证指数' },
  { kind: 'index', code: '399001.SZ', name: '深证成指' },
  { kind: 'index', code: '399006.SZ', name: '创业板指' },
];
export const instrumentId = (item: MarketInstrument) => `${item.kind}:${item.code}`;
export const validStockCode = (code: string) => /^(?:6\d{5}\.SH|[03]\d{5}\.SZ)$/.test(code);

export function validCity(value: unknown): value is WeatherCity {
  if (!value || typeof value !== 'object') return false;
  const city = value as WeatherCity;
  return Number.isFinite(city.id) && typeof city.name === 'string' && !!city.name.trim()
    && typeof city.region === 'string' && typeof city.country === 'string'
    && Number.isFinite(city.latitude) && Math.abs(city.latitude) <= 90
    && Number.isFinite(city.longitude) && Math.abs(city.longitude) <= 180;
}

export function normalizeWidgets(raw: Partial<WidgetSettings> | undefined): WidgetSettings {
  const defaults = DEFAULT_SETTINGS.widgets;
  const order = Array.isArray(raw?.order) ? raw.order : [];
  const watchlist: MarketInstrument[] = [];
  for (const item of Array.isArray(raw?.market?.watchlist) ? raw.market.watchlist : []) {
    if (item?.kind !== 'stock' || typeof item.code !== 'string' || !validStockCode(item.code) || watchlist.some(stock => stock.code === item.code)) continue;
    watchlist.push({ kind: 'stock', code: item.code, name: typeof item.name === 'string' ? item.name.trim().slice(0, 40) : item.code });
    if (watchlist.length === 10) break;
  }
  const tools = defaults.order.filter((id): id is WidgetToolId => id !== 'clock' && id !== 'weather');
  const pinned = Array.isArray(raw?.pinned) ? raw.pinned : defaults.pinned;
  const instruments = [...MARKET_INDICES, ...watchlist];
  const layout: Partial<Record<DesktopWidgetId, WidgetPlacement>> = {};
  for (const id of [...defaults.order, 'calendar'] as DesktopWidgetId[]) {
    const item = raw?.desktop?.layout?.[id];
    if (item && Number.isFinite(item.x) && Number.isFinite(item.y)) layout[id] = {
      x: Math.min(1, Math.max(0, item.x)), y: Math.min(1, Math.max(0, item.y)),
      size: item.size === 'medium' || item.size === 'large' ? item.size : 'small',
      ...(item.coordinateSpace === 'viewport' ? { coordinateSpace: 'viewport' as const } : {}),
    };
  }
  return {
    version: 1,
    desktop: { appearance: ['light', 'dark', 'tinted'].includes(raw?.desktop?.appearance ?? '') ? raw!.desktop!.appearance : 'auto', layout },
    order: [...new Set([...order.filter((id): id is WidgetId => defaults.order.includes(id)), ...defaults.order])],
    pinned: [...new Set(pinned.filter(id => tools.includes(id)))].slice(0, 3),
    clock: { enabled: raw?.clock?.enabled === true, hour12: raw?.clock?.hour12 === true },
    weather: {
      enabled: raw?.weather?.enabled === true,
      city: validCity(raw?.weather?.city) ? raw.weather.city : null,
      unit: raw?.weather?.unit === 'fahrenheit' ? 'fahrenheit' : 'celsius',
    },
    todos: { enabled: raw?.todos?.enabled === true },
    notes: { enabled: raw?.notes?.enabled === true },
    focus: { enabled: raw?.focus?.enabled === true, minutes: Number.isInteger(raw?.focus?.minutes) && raw!.focus!.minutes >= 1 && raw!.focus!.minutes <= 180 ? raw!.focus!.minutes : 25 },
    revisit: { enabled: raw?.revisit?.enabled === true, folderId: typeof raw?.revisit?.folderId === 'string' ? raw.revisit.folderId : '' },
    market: {
      enabled: raw?.market?.enabled === true,
      token: typeof raw?.market?.token === 'string' ? raw.market.token.trim().slice(0, 512) : '',
      watchlist,
      summary: instruments.some(item => instrumentId(item) === raw?.market?.summary) ? raw!.market!.summary : defaults.market.summary,
      colors: raw?.market?.colors === 'green-up' || raw?.market?.colors === 'mono' ? raw.market.colors : 'red-up',
    },
    calendar: {
      enabled: raw?.calendar?.enabled !== false,
      showLunar: raw?.calendar?.showLunar !== false,
      showHolidays: raw?.calendar?.showHolidays !== false,
    },
  };
}

type WidgetPatch = { [K in WidgetId | 'calendar']?: Partial<WidgetSettings[K]> } & { order?: WidgetId[]; pinned?: WidgetToolId[]; desktop?: Partial<WidgetSettings['desktop']> };
/** Keep legacy weather preferences, but display clock/weather as one card. */
export function widgetCardOrder(settings: WidgetSettings): Exclude<WidgetId, 'weather'>[] {
  return [...new Set(settings.order.map(id => id === 'weather' ? 'clock' : id))];
}

export function patchWidgets(current: WidgetSettings, patch: WidgetPatch): WidgetSettings {
  return normalizeWidgets({ ...current, ...patch,
    desktop: { ...current.desktop, ...patch.desktop },
    clock: { ...current.clock, ...patch.clock },
    weather: { ...current.weather, ...patch.weather },
    todos: { ...current.todos, ...patch.todos },
    calendar: { ...current.calendar, ...patch.calendar },
    market: { ...current.market, ...patch.market },
    notes: { ...current.notes, ...patch.notes },
    focus: { ...current.focus, ...patch.focus },
    revisit: { ...current.revisit, ...patch.revisit },
  });
}
