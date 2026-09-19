import { useCallback, useEffect, useRef, useState } from 'react';
import type { WidgetSettings } from '../types';
import { subscribeLocal } from '../services/localStore';
import { hasWeatherPermission, loadWeather, refreshWeather, weatherKey, weatherStorageKey, type WeatherData } from '../services/weather';

export function useWeather(config: WidgetSettings['weather']) {
  const [data, setData] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState(true);
  const [revision, setRevision] = useState(0);
  const refresh = useRef<(force?: boolean) => void>(() => {});
  const key = config.city ? weatherKey(config.city, config.unit) : '';

  useEffect(() => {
    setData(null); setError(null); setLoading(false);
    if (!config.enabled) return;
    let alive = true;
    let request: AbortController | null = null;
    const load = async (force = false) => {
      if (request || document.visibilityState === 'hidden') return;
      const controller = new AbortController(); request = controller;
      try {
        const allowed = await hasWeatherPermission();
        if (!alive) return;
        setPermission(allowed);
        if (!allowed || !config.city) return;
        const cached = await loadWeather(key);
        if (!alive) return;
        setData(cached); setLoading(true);
        const next = await refreshWeather(config.city, config.unit, controller.signal, force);
        if (alive) { setData(next); setError(null); }
      } catch (failure) {
        if (alive && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : '暂时无法获取天气。');
      } finally { request = null; if (alive) setLoading(false); }
    };
    refresh.current = (force = true) => void load(force);
    void load();
    const interval = setInterval(() => void load(), 60_000);
    const visible = () => { if (document.visibilityState !== 'hidden') void load(); };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', visible);
    const unsubscribe = key ? subscribeLocal(weatherStorageKey(key), () => {
      void loadWeather(key).then(next => { if (alive) setData(next); }).catch(() => {});
    }) : () => {};
    const permissionsChanged = () => {
      request?.abort();
      if (alive) setRevision(value => value + 1);
    };
    type PermissionEvent = { addListener: (listener: () => void) => void; removeListener: (listener: () => void) => void };
    const permissions = (typeof chrome !== 'undefined' ? chrome.permissions : undefined) as unknown as
      { onRemoved?: PermissionEvent; onAdded?: PermissionEvent } | undefined;
    permissions?.onRemoved?.addListener(permissionsChanged);
    permissions?.onAdded?.addListener(permissionsChanged);
    return () => {
      alive = false; request?.abort(); refresh.current = () => {}; clearInterval(interval); unsubscribe();
      document.removeEventListener('visibilitychange', visible); window.removeEventListener('online', visible);
      permissions?.onRemoved?.removeListener(permissionsChanged); permissions?.onAdded?.removeListener(permissionsChanged);
    };
  }, [config.enabled, key, revision]); // key includes the coordinates and unit; city labels don't affect requests.

  return { data: data?.key === key && config.enabled ? data : null, loading, error, permission,
    refresh: useCallback(() => refresh.current(), []), recheck: () => setRevision(value => value + 1) };
}
