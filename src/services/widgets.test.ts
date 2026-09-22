import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type WeatherCity, type WidgetSettings } from '../types';
import { normalizeWidgets, patchWidgets } from './widgetSettings';
import { bookmarkSearchScore } from './bookmarkSearch';
import { loadWeather, parseForecast, refreshWeather, searchCities, weatherKey, weatherStorageKey, WEATHER_FRESH_MS } from './weather';
import { readTodos, mutateTodos, TODOS_KEY } from '../hooks/useTodos';
import { writeLocal } from './localStore';

const city: WeatherCity = { id: 1, name: '测试城市', region: '省份', country: '国家', latitude: 31, longitude: 121 };
const forecast = { timezone: 'Asia/Shanghai', current: { temperature_2m: 20, apparent_temperature: 19, weather_code: 2, is_day: 1 },
  daily: { time: ['2026-09-19', '2026-09-20', '2026-09-21'], weather_code: [2, 3, 0], temperature_2m_max: [24, 23, 25],
    temperature_2m_min: [17, 18, 16], precipitation_probability_max: [10, 20, 0] } };
beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('widget settings migration', () => {
  it('defaults existing installations to opt-in widgets and repairs order without losing city preferences', () => {
    expect(normalizeWidgets(undefined)).toEqual(DEFAULT_SETTINGS.widgets);
    const normalized = normalizeWidgets({ order: ['weather', 'weather', 'invalid'] as never, weather: { enabled: true, city, unit: 'bad' } as never });
    expect(normalized.order).toEqual(['weather', 'clock', 'todos', 'market', 'notes', 'focus', 'revisit']);
    expect(normalized.weather).toEqual({ enabled: true, city, unit: 'celsius' });
    const updated = patchWidgets(normalized, { clock: { enabled: true } });
    expect(updated.weather).toEqual(normalized.weather);
    expect(updated.calendar).toEqual({ showLunar: true, showHolidays: true });
    const calendar = patchWidgets(updated, { calendar: { showLunar: false } });
    expect(calendar.calendar).toEqual({ showLunar: false, showHolidays: true });
    expect(calendar.weather).toEqual(normalized.weather);
    expect(normalizeWidgets({ weather: { city: { ...city, latitude: 900 } } } as WidgetSettings).weather.city).toBeNull();
  });
});

describe('bookmark search ranking', () => {
  it('matches words across title and URL, normalizes full-width text, and ranks title matches first', () => {
    expect(bookmarkSearchScore('react docs', 'React', 'https://docs.example.com')).not.toBeNull();
    expect(bookmarkSearchScore('react missing', 'React', 'https://docs.example.com')).toBeNull();
    expect(bookmarkSearchScore('ＧＩＴ', 'Git')).toBe(100);
    expect(bookmarkSearchScore('git', 'GitHub')!).toBeGreaterThan(bookmarkSearchScore('git', 'Other', 'https://github.com')!);
  });
});

describe('weather request lifecycle', () => {
  it('rejects broken payloads while preserving missing numeric values as unavailable', () => {
    expect(() => parseForecast({}, 'key')).toThrow('天气数据不完整');
    expect(parseForecast({ ...forecast, current: { ...forecast.current, temperature_2m: null } }, 'key').temperature).toBeNull();
  });
  it('reuses fresh persistent cache and coalesces simultaneous requests', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(forecast), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const signal = new AbortController().signal;
    const [first, second] = await Promise.all([refreshWeather(city, 'celsius', signal), refreshWeather(city, 'celsius', signal)]);
    expect(first).toEqual(second); expect(fetcher).toHaveBeenCalledOnce();
    expect(await refreshWeather(city, 'celsius', signal)).toEqual(first);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('separates cities and units and rejects invalid cached values', async () => {
    const key = weatherKey(city, 'celsius');
    await writeLocal(weatherStorageKey(key), parseForecast(forecast, key));
    expect(await loadWeather(weatherKey(city, 'fahrenheit'))).toBeNull();
    await writeLocal(weatherStorageKey(key), { key, fetchedAt: 'invalid' });
    expect(await loadWeather(key)).toBeNull();
  });
  it('retains old weather on service failure and respects a rate-limit cooldown even on manual refresh', async () => {
    const key = weatherKey(city, 'celsius');
    const stale = parseForecast(forecast, key, Date.now() - WEATHER_FRESH_MS - 1000);
    await writeLocal(weatherStorageKey(key), stale);
    const fetcher = vi.fn(async () => new Response('{}', { status: 429, headers: { 'Retry-After': '600' } }));
    vi.stubGlobal('fetch', fetcher);
    const signal = new AbortController().signal;
    await expect(refreshWeather(city, 'celsius', signal)).rejects.toThrow('繁忙');
    await expect(refreshWeather(city, 'celsius', signal, true)).rejects.toThrow('繁忙');
    expect(fetcher).toHaveBeenCalledOnce(); expect(await loadWeather(key)).toEqual(stale);
  });
  it('does not request data without permission or after cancellation', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    vi.stubGlobal('chrome', { permissions: { contains: async () => false } });
    await expect(refreshWeather(city, 'celsius', new AbortController().signal)).rejects.toThrow('允许连接');
    const controller = new AbortController(); controller.abort();
    await expect(refreshWeather(city, 'celsius', controller.signal)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('searches cities using explicit query text and preserves disambiguating regions', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({ results: [{ id: 1, name: '同名城市', latitude: 31, longitude: 121, admin1: '地区一', country: '国家' }] })));
    vi.stubGlobal('fetch', fetcher);
    const result = await searchCities('同名城市', new AbortController().signal);
    expect(result[0].region).toBe('地区一');
    expect(String(fetcher.mock.calls[0][0])).toContain(encodeURIComponent('同名城市'));
  });
});

describe('local todos', () => {
  it('starts empty and serializes concurrent edits without overwriting a different item', async () => {
    expect(await readTodos()).toEqual([]);
    await Promise.all([
      mutateTodos(prev => [...prev, { id: 'a', text: 'First', done: false, tag: 'work' }]),
      mutateTodos(prev => [...prev, { id: 'b', text: 'Second', done: false, tag: 'life' }]),
    ]);
    expect((await readTodos()).map(todo => todo.id)).toEqual(['a', 'b']);
    await Promise.all([
      mutateTodos(prev => prev.map(todo => todo.id === 'a' ? { ...todo, done: true } : todo)),
      mutateTodos(prev => prev.filter(todo => todo.id !== 'b')),
    ]);
    expect(await readTodos()).toEqual([{ id: 'a', text: 'First', done: true, tag: 'work' }]);
    expect(JSON.parse(localStorage.getItem(TODOS_KEY)!)).toHaveLength(1);
  });
});
