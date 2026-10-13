import { useCallback, useEffect, useRef, useState } from 'react';
import { BING_CACHE_KEY, BingWallpaperError, loadBingWallpaper, refreshBingWallpaper, type BingFailure, type BingWallpaper } from '../services/bingWallpaper';
import { subscribeLocal } from '../services/localStore';

export function useBingWallpaper(enabled: boolean) {
  const [data, setData] = useState<BingWallpaper | null>(null);
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const [errorCode, setErrorCode] = useState<BingFailure | null>(null);
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    let alive = true; let request: AbortController | null = null;
    const read = async () => { try { const saved = await loadBingWallpaper(); if (alive) setData(saved); } catch { /* keep the last visible image */ } };
    void read(); const unsubscribe = subscribeLocal(BING_CACHE_KEY, () => void read());
    const load = async (force = false) => {
      if (!enabled || request || (!force && document.visibilityState === 'hidden')) return;
      const controller = new AbortController(); request = controller; setLoading(true); setError(''); setErrorCode(null);
      try { const next = await refreshBingWallpaper(controller.signal, force); if (alive) { setData(next); setError(''); setErrorCode(null); } }
      catch (failure) { if (alive && !controller.signal.aborted) { setError(failure instanceof Error ? failure.message : '无法更新壁纸。'); setErrorCode(failure instanceof BingWallpaperError ? failure.code : 'network'); } }
      finally { request = null; if (alive) setLoading(false); }
    };
    refreshRef.current = () => void load(true); if (enabled) void load();
    const visible = () => { if (document.visibilityState !== 'hidden') void load(); };
    const timer = enabled ? setInterval(visible, 60 * 60_000) : undefined;
    document.addEventListener('visibilitychange', visible); window.addEventListener('online', visible);
    const permissionsChanged = () => {
      request?.abort();
      if (enabled) { setErrorCode('permission'); setError('访问权限已变更，请点击“授权并重试”。'); }
    };
    const removed = (typeof chrome !== 'undefined' ? chrome.permissions?.onRemoved : undefined) as unknown as { addListener: (fn: () => void) => void; removeListener: (fn: () => void) => void } | undefined;
    removed?.addListener(permissionsChanged);
    return () => { alive = false; request?.abort(); refreshRef.current = () => {}; unsubscribe(); clearInterval(timer); document.removeEventListener('visibilitychange', visible); window.removeEventListener('online', visible); removed?.removeListener(permissionsChanged); };
  }, [enabled]);
  return { data, error, errorCode, loading, refresh: useCallback(() => refreshRef.current(), []) };
}
