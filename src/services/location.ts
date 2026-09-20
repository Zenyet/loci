import { z } from 'zod';
import type { WeatherCity } from '../types';

export const LOCATION_ORIGIN = 'https://api.bigdatacloud.net/*';

/** Call directly from the locate button. Geolocation itself must be a required
 * Chrome manifest permission; only the reverse-geocoding host is optional. */
export async function requestLocationServicePermission(): Promise<boolean> {
  return typeof chrome === 'undefined' || !chrome.permissions
    ? true : chrome.permissions.request({ origins: [LOCATION_ORIGIN] });
}

function currentPosition(signal: AbortSignal): Promise<GeolocationPosition> {
  signal.throwIfAborted();
  if (!navigator.geolocation) return Promise.reject(new Error('此环境不支持定位，请手动搜索城市。'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      callback();
    };
    const abort = () => finish(() => reject(signal.reason ?? new DOMException('Aborted', 'AbortError')));
    const timeout = setTimeout(() => finish(() => reject(new Error('定位超时，请重试或手动搜索城市。'))), 15_000);
    signal.addEventListener('abort', abort, { once: true });
    try {
      navigator.geolocation.getCurrentPosition(
        position => finish(() => resolve(position)),
        error => finish(() => reject(new Error(error.code === 1
          ? '未获得定位权限。请检查浏览器或系统定位设置，也可以手动搜索城市。'
          : error.code === 3 ? '定位超时，请重试或手动搜索城市。'
            : '暂时无法获取位置，请重试或手动搜索城市。'))),
        { enableHighAccuracy: false, timeout: 12_000, maximumAge: 0 },
      );
    } catch { finish(() => reject(new Error('无法使用定位，请手动搜索城市。'))); }
  });
}

const citySchema = z.object({
  city: z.string().optional(), locality: z.string().optional(),
  principalSubdivision: z.string().optional(), countryName: z.string().optional(),
});

/** Uses only a fresh, consented device position. No IP fallback or tracking.
 * Provider policy: https://www.bigdatacloud.com/free-api/free-reverse-geocode-to-city-api
 * Precise coordinates are sent once for city lookup, never stored by Loci. */
export async function locateWeatherCity(signal: AbortSignal): Promise<WeatherCity> {
  signal.throwIfAborted();
  if (typeof chrome !== 'undefined' && chrome.permissions
    && !await chrome.permissions.contains({ origins: [LOCATION_ORIGIN] })) {
    throw new Error('请先允许连接城市定位服务，或手动搜索城市。');
  }
  const position = await currentPosition(signal);
  signal.throwIfAborted();
  const { latitude, longitude } = position.coords;
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    throw new Error('定位结果无效，请手动搜索城市。');
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const url = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client');
    url.search = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude), localityLanguage: 'zh' }).toString();
    const response = await fetch(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error();
    const parsed = citySchema.safeParse(await response.json());
    signal.throwIfAborted();
    if (!parsed.success) throw new Error();
    const name = parsed.data.city?.trim() || parsed.data.locality?.trim();
    if (!name) throw new Error();
    const lat = Math.round(latitude * 100) / 100, lon = Math.round(longitude * 100) / 100;
    return {
      id: -1 - (Math.round((lat + 90) * 100) * 36001 + Math.round((lon + 180) * 100)),
      name, region: parsed.data.principalSubdivision ?? '', country: parsed.data.countryName ?? '',
      latitude: lat, longitude: lon,
    };
  } catch {
    signal.throwIfAborted();
    throw new Error('无法识别所在城市，请检查网络后重试，或手动搜索城市。');
  } finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); }
}
