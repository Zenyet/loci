import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChromeData } from '../types';
import { loadChromeData, subscribeBookmarkChanges } from '../services/chromeApi';

export function useChromeData(): {
  data: ChromeData | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [data, setData] = useState<ChromeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(false);
  const revision = useRef(0);

  const refresh = useCallback(() => {
    const run = ++revision.current;
    setLoading(true); setError(null);
    void loadChromeData().then(next => {
      if (alive.current && run === revision.current) setData(next);
    }).catch((failure: unknown) => {
      if (alive.current && run === revision.current) setError(failure instanceof Error ? failure.message : '无法读取 Chrome 数据');
    }).finally(() => {
      if (alive.current && run === revision.current) setLoading(false);
    });
  }, []);

  useEffect(() => {
    alive.current = true;
    const unsubscribe = subscribeBookmarkChanges(refresh);
    refresh();
    return () => { alive.current = false; revision.current++; unsubscribe(); };
  }, [refresh]);

  return { data, loading, error, refresh };
}
