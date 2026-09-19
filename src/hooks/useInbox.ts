import { useEffect, useState } from 'react';
import type { ChromeData, Group } from '../types';
import { INBOX_KEY, readInbox } from '../services/capture';
import { subscribeLocal } from '../services/localStore';

export function useInbox(data: ChromeData | null) {
  const [folder, setFolder] = useState<Group | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!data) return;
    let alive = true;
    let version = 0;
    const reload = () => {
      const run = ++version;
      void readInbox(data).then(next => {
        if (alive && run === version) { setFolder(next); setError(null); setReady(true); }
      }).catch(() => { if (alive && run === version) { setError('无法读取收件箱，请刷新后重试。'); setReady(true); } });
    };
    const unsubscribe = subscribeLocal(INBOX_KEY, reload);
    reload();
    return () => { alive = false; unsubscribe(); };
  }, [data]);
  const current = folder ? data?.groups.find(group => group.id === folder.id && !group.readOnly) ?? null : null;
  return { folder: current, ready, error, bookmarks: current ? data?.bookmarks.filter(bookmark => bookmark.parentId === current.id && !bookmark.readOnly) ?? [] : [] };
}
