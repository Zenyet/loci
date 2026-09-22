import { useCallback, useEffect, useRef, useState } from 'react';
import type { WidgetSettings } from '../types';
import { hasMarketPermission, refreshMarket, type MarketSnapshot } from '../services/market';

export function useMarket(config: WidgetSettings['market']) {
  const [snapshot, setSnapshot] = useState<{ key: string; data: MarketSnapshot } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState(true);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const refreshRef = useRef<(force?: boolean) => void>(() => {});
  const key = `${config.token}:${config.watchlist.map(item => item.code).sort().join(',')}`;
  useEffect(() => {
    setSnapshot(null); setError(null); setLoading(false);
    if (!config.enabled || !config.token) return;
    let alive = true;
    let request: AbortController | null = null;
    const load = async (force = false) => {
      if (request || document.visibilityState === 'hidden') return;
      const controller = new AbortController(); request = controller;
      try {
        const allowed = await hasMarketPermission();
        if (!alive || controller.signal.aborted) return;
        setPermission(allowed);
        if (!allowed) return;
        setLoading(true);
        const data = await refreshMarket(config, controller.signal, force);
        if (alive && !controller.signal.aborted) { setSnapshot({ key, data }); setError(null); }
      } catch (failure) {
        if (alive && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : '暂时无法获取行情。');
      } finally { request = null; if (alive) setLoading(false); }
    };
    refreshRef.current = (force = true) => void load(force);
    void load();
    const interval = setInterval(() => void load(), 30_000);
    const visible = () => { if (document.visibilityState === 'hidden') request?.abort(); else void load(); };
    const permissionsChanged = () => { request?.abort(); if (alive) setRevision(v => v + 1); };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', visible);
    type PermissionEvent = { addListener: (listener: () => void) => void; removeListener: (listener: () => void) => void };
    const permissions = (typeof chrome !== 'undefined' ? chrome.permissions : undefined) as unknown as { onRemoved?: PermissionEvent; onAdded?: PermissionEvent } | undefined;
    permissions?.onRemoved?.addListener(permissionsChanged);
    permissions?.onAdded?.addListener(permissionsChanged);
    return () => {
      alive = false; request?.abort(); clearInterval(interval); refreshRef.current = () => {};
      document.removeEventListener('visibilitychange', visible); window.removeEventListener('online', visible);
      permissions?.onRemoved?.removeListener(permissionsChanged); permissions?.onAdded?.removeListener(permissionsChanged);
    };
  }, [config.enabled, key, revision]);
  return { data: config.enabled && snapshot?.key === key ? snapshot.data : null, error, permission, loading,
    refresh: useCallback(() => refreshRef.current(true), []), recheck: useCallback(() => setRevision(v => v + 1), []) };
}
