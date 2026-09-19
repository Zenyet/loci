import { z } from 'zod';
import type { WeatherCity, WidgetSettings } from '../types';
import { readLocal, withLocalLock, writeLocal } from './localStore';

export const WEATHER_ORIGINS = ['https://api.open-meteo.com/*', 'https://geocoding-api.open-meteo.com/*'];
export const WEATHER_FRESH_MS = 60 * 60_000;
export const WEATHER_OLD_MS = 6 * WEATHER_FRESH_MS;
export type TemperatureUnit = WidgetSettings['weather']['unit'];
const finite = z.number().finite();
const optionalNumber = finite.nullable();
const weatherSchema = z.object({
  key: z.string(), fetchedAt: finite, timezone: z.string(), temperature: optionalNumber,
  apparent: optionalNumber, code: optionalNumber, isDay: z.boolean(),
  days: z.array(z.object({ date: z.string(), code: optionalNumber, high: optionalNumber, low: optionalNumber, rain: optionalNumber })),
});
export type WeatherData = z.infer<typeof weatherSchema>;
export const weatherKey = (city: WeatherCity, unit: TemperatureUnit) => `${city.latitude},${city.longitude}:${unit}`;
export const weatherStorageKey = (key: string) => `loci-weather-v1:${key}`;

export async function hasWeatherPermission(): Promise<boolean> {
  return typeof chrome === 'undefined' || !chrome.permissions
    ? true : chrome.permissions.contains({ origins: WEATHER_ORIGINS });
}
/** Must be called directly from a user gesture. */
export async function requestWeatherPermission(): Promise<boolean> {
  return typeof chrome === 'undefined' || !chrome.permissions
    ? true : chrome.permissions.request({ origins: WEATHER_ORIGINS });
}

export class WeatherError extends Error {
  constructor(message: string, public retryAfter = 60_000) { super(message); }
}

async function requestJson(url: URL, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 10_000);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (response.status === 429) {
      const retry = response.headers.get('Retry-After');
      const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - Date.now() : 900_000;
      throw new WeatherError('天气服务繁忙，请稍后重试。', Number.isFinite(delay) ? Math.max(60_000, delay) : 900_000);
    }
    if (!response.ok) throw new WeatherError('天气服务暂时不可用，请稍后重试。');
    return await response.json();
  } catch (error) {
    if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    if (error instanceof WeatherError) throw error;
    throw new WeatherError(timedOut ? '天气请求超时，请检查网络后重试。' : '无法连接天气服务，请检查网络。');
  } finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); }
}

const cityResponseSchema = z.object({ results: z.array(z.object({
  id: finite, name: z.string(), latitude: finite.min(-90).max(90), longitude: finite.min(-180).max(180),
  admin1: z.string().optional(), country: z.string().optional(),
})).optional() });

export async function searchCities(query: string, signal: AbortSignal): Promise<WeatherCity[]> {
  if (!query.trim()) return [];
  if (!await hasWeatherPermission()) throw new WeatherError('请先允许连接天气服务。');
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.search = new URLSearchParams({ name: query.trim(), count: '6', language: 'zh', format: 'json' }).toString();
  const parsed = cityResponseSchema.safeParse(await requestJson(url, signal));
  if (!parsed.success) throw new WeatherError('城市搜索返回的数据不完整，请稍后重试。');
  return (parsed.data.results ?? []).map(city => ({ id: city.id, name: city.name, region: city.admin1 ?? '',
    country: city.country ?? '', latitude: city.latitude, longitude: city.longitude }));
}

const forecastSchema = z.object({
  timezone: z.string(),
  current: z.object({ temperature_2m: optionalNumber, apparent_temperature: optionalNumber, weather_code: optionalNumber, is_day: optionalNumber }),
  daily: z.object({ time: z.array(z.string()), weather_code: z.array(optionalNumber), temperature_2m_max: z.array(optionalNumber),
    temperature_2m_min: z.array(optionalNumber), precipitation_probability_max: z.array(optionalNumber) }),
});

export function parseForecast(raw: unknown, key: string, now = Date.now()): WeatherData {
  const parsed = forecastSchema.safeParse(raw);
  if (!parsed.success || parsed.data.daily.time.length < 3) throw new WeatherError('天气数据不完整，请稍后重试。');
  const { current, daily, timezone } = parsed.data;
  return { key, fetchedAt: now, timezone, temperature: current.temperature_2m, apparent: current.apparent_temperature,
    code: current.weather_code, isDay: current.is_day === 1,
    days: daily.time.slice(0, 3).map((date, i) => ({ date, code: daily.weather_code[i] ?? null,
      high: daily.temperature_2m_max[i] ?? null, low: daily.temperature_2m_min[i] ?? null, rain: daily.precipitation_probability_max[i] ?? null })) };
}

export async function loadWeather(key: string): Promise<WeatherData | null> {
  const parsed = weatherSchema.safeParse(await readLocal(weatherStorageKey(key)));
  if (!parsed.success || parsed.data.key !== key || parsed.data.fetchedAt > Date.now() + 60_000) return null;
  return parsed.data;
}

export async function refreshWeather(city: WeatherCity, unit: TemperatureUnit, signal: AbortSignal, force = false): Promise<WeatherData> {
  const key = weatherKey(city, unit);
  return withLocalLock(`weather:${key}`, async () => {
    signal.throwIfAborted();
    if (!await hasWeatherPermission()) throw new WeatherError('请先允许连接天气服务。');
    const cached = await loadWeather(key);
    if (cached && Date.now() - cached.fetchedAt < (force ? 30_000 : WEATHER_FRESH_MS)) return cached;
    const retryKey = `loci-weather-retry:${key}`;
    const retry = await readLocal<{ at: number; message: string }>(retryKey);
    if (retry && retry.at > Date.now()) throw new WeatherError(retry.message, retry.at - Date.now());
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.search = new URLSearchParams({ latitude: String(city.latitude), longitude: String(city.longitude),
      current: 'temperature_2m,apparent_temperature,weather_code,is_day',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      timezone: 'auto', forecast_days: '3', temperature_unit: unit }).toString();
    try {
      const result = parseForecast(await requestJson(url, signal), key);
      signal.throwIfAborted();
      await writeLocal(weatherStorageKey(key), result);
      return result;
    } catch (error) {
      if (!signal.aborted) {
        const failure = error instanceof WeatherError ? error : new WeatherError('无法保存天气数据，请检查本地存储。');
        await writeLocal(retryKey, { at: Date.now() + failure.retryAfter, message: failure.message }).catch(() => {});
        throw failure;
      }
      throw error;
    }
  }, signal);
}

export function weatherDescription(code: number | null): string {
  if (code === 0) return '晴';
  if (code === 1) return '晴间多云';
  if (code === 2) return '多云';
  if (code === 3) return '阴';
  if (code === 45 || code === 48) return '雾';
  if (code !== null && code >= 51 && code <= 57) return '毛毛雨';
  if (code !== null && code >= 61 && code <= 67) return '雨';
  if (code !== null && code >= 71 && code <= 77) return '雪';
  if (code !== null && code >= 80 && code <= 82) return '阵雨';
  if (code === 85 || code === 86) return '阵雪';
  if (code !== null && code >= 95 && code <= 99) return '雷雨';
  return '天气未知';
}
export const displayTemperature = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)}°` : '—';
