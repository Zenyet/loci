import { useCallback, useEffect, useRef, useState } from 'react';
import { readLocal, subscribeLocal, withLocalLock, writeLocal } from '../services/localStore';

/** Functional mutations run against the latest record, including changes from other tabs. */
export function useWidgetRecord<T>(key: string, normalize: (raw: unknown) => T) {
  const [value, setValue] = useState<T>(() => normalize(undefined));
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(false);
  const busy = useRef(false);
  useEffect(() => {
    alive.current = true;
    let version = 0;
    const reload = async () => {
      const run = ++version;
      try { const next = normalize(await readLocal(key)); if (alive.current && run === version) { setValue(next); setReady(true); } }
      catch { if (alive.current) setError('无法读取本地数据，请刷新后重试。'); }
    };
    void reload();
    const unsubscribe = subscribeLocal(key, () => void reload());
    return () => { alive.current = false; ++version; unsubscribe(); };
  }, [key, normalize]);
  const update = useCallback(async (change: (current: T) => T) => {
    if (!ready || busy.current) return false;
    busy.current = true; setPending(true); setError(null);
    try {
      const next = await withLocalLock(key, async () => {
        const value = normalize(change(normalize(await readLocal(key))));
        await writeLocal(key, value); return value;
      });
      if (alive.current) setValue(next);
      return true;
    } catch { if (alive.current) setError('保存失败，请检查本地存储后重试。'); return false; }
    finally { busy.current = false; if (alive.current) setPending(false); }
  }, [key, normalize, ready]);
  return { value, ready, pending, error, update };
}
