import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { locateWeatherCity, LOCATION_ORIGIN, requestLocationServicePermission } from './location';

const position = { coords: { latitude: 31.230416, longitude: 121.473701 } } as GeolocationPosition;
const getCurrentPosition = vi.fn();
beforeEach(() => {
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ city: '上海', principalSubdivision: '上海市', countryName: '中国' }))));
  getCurrentPosition.mockReset().mockImplementation(success => success(position));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('requests only the optional reverse-geocoding host from the user action', async () => {
  const request = vi.fn(async () => true);
  vi.stubGlobal('chrome', { permissions: { request } });
  expect(await requestLocationServicePermission()).toBe(true);
  expect(request).toHaveBeenCalledWith({ origins: [LOCATION_ORIGIN] });
  expect(getCurrentPosition).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it('uses a fresh device position once and retains only approximate coordinates', async () => {
  const city = await locateWeatherCity(new AbortController().signal);
  expect(getCurrentPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), expect.objectContaining({ maximumAge: 0, enableHighAccuracy: false }));
  expect(city).toMatchObject({ name: '上海', latitude: 31.23, longitude: 121.47 });
  const url = new URL(String(vi.mocked(fetch).mock.calls[0]![0]));
  expect(url.hostname).toBe('api.bigdatacloud.net');
  expect(url.searchParams.get('latitude')).toBe('31.230416');
  expect(url.searchParams.get('longitude')).toBe('121.473701');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('does not get a device position before the service permission is granted', async () => {
  vi.stubGlobal('chrome', { permissions: { contains: async () => false } });
  await expect(locateWeatherCity(new AbortController().signal)).rejects.toThrow('允许连接');
  expect(getCurrentPosition).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});

it.each([1, 2, 3])('keeps manual search available on location error %i without IP fallback', async code => {
  getCurrentPosition.mockImplementation((_success, failure) => failure({ code }));
  await expect(locateWeatherCity(new AbortController().signal)).rejects.toThrow('手动搜索');
  expect(fetch).not.toHaveBeenCalled();
});

it('ignores a late location callback after the picker has been closed', async () => {
  let success!: PositionCallback;
  getCurrentPosition.mockImplementation(callback => { success = callback; });
  const controller = new AbortController();
  const result = locateWeatherCity(controller.signal);
  controller.abort();
  success(position);
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetch).not.toHaveBeenCalled();
});

it('times out even if the browser never finishes the permission prompt', async () => {
  vi.useFakeTimers(); getCurrentPosition.mockImplementation(() => {});
  const result = expect(locateWeatherCity(new AbortController().signal)).rejects.toThrow('定位超时');
  await vi.advanceTimersByTimeAsync(15_000); await result;
  expect(fetch).not.toHaveBeenCalled();
});

it('rejects failed reverse geocoding without inventing a default city', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ city: '' })));
  await expect(locateWeatherCity(new AbortController().signal)).rejects.toThrow('无法识别');
});
