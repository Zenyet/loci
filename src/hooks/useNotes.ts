import { useCallback, useEffect, useRef, useState } from 'react';
import { readLocal, subscribeLocal, withLocalLock, writeLocal } from '../services/localStore';

export const NOTES_KEY = 'loci-notes-v1';
const normalize = (value: unknown) => typeof value === 'string' ? value.slice(0, 5000) : '';
export function useNotes() {
  const [text, setText] = useState('');
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(false);
  const draft = useRef('');
  const dirty = useRef(false);
  const running = useRef(false);
  const revision = useRef(0);
  useEffect(() => {
    alive.current = true;
    let version = 0;
    const reload = async () => {
      const run = ++version;
      try {
        const stored = normalize(await readLocal(NOTES_KEY));
        if (alive.current && run === version && !dirty.current) { draft.current = stored; setText(stored); setReady(true); }
      } catch { if (alive.current) setError('无法读取便签，请刷新后重试。'); }
    };
    const unsubscribe = subscribeLocal(NOTES_KEY, () => void reload());
    void reload();
    return () => { alive.current = false; ++version; unsubscribe(); };
  }, []);
  const flush = useCallback(async () => {
    if (running.current || !dirty.current) return;
    running.current = true;
    if (alive.current) { setSaving(true); setError(null); }
    try {
      while (dirty.current) {
        const run = revision.current;
        const snapshot = draft.current;
        await withLocalLock(NOTES_KEY, () => writeLocal(NOTES_KEY, snapshot));
        if (revision.current === run) dirty.current = false;
      }
    } catch { if (alive.current) setError('便签尚未保存。内容仍在此页，请重试或复制备份。'); }
    finally { running.current = false; if (alive.current) setSaving(false); }
  }, []);
  const edit = useCallback((value: string) => {
    if (!ready) return;
    draft.current = value.slice(0, 5000); revision.current++; dirty.current = true;
    setText(draft.current); void flush();
  }, [ready, flush]);
  return { text, ready, saving, error, edit, retry: flush };
}
