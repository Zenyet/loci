import { useCallback, useEffect, useRef, useState } from 'react';
import type { Todo } from '../types';
import { readLocal, subscribeLocal, withLocalLock, writeLocal } from '../services/localStore';

export const TODOS_KEY = 'newtab-todos';
export async function readTodos(): Promise<Todo[]> {
  const raw = await readLocal<unknown>(TODOS_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter((todo): todo is Todo => !!todo && typeof todo.id === 'string'
    && typeof todo.text === 'string' && typeof todo.done === 'boolean'
    && (todo.tag === 'work' || todo.tag === 'life'));
}
export async function mutateTodos(change: (todos: Todo[]) => Todo[]): Promise<Todo[]> {
  return withLocalLock('todos', async () => {
    const next = change(await readTodos());
    await writeLocal(TODOS_KEY, next);
    return next;
  });
}

export function useTodos() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [deleted, setDeleted] = useState<Todo | null>(null);
  const alive = useRef(false);
  const busy = useRef(false);

  useEffect(() => {
    alive.current = true;
    let version = 0;
    const reload = async () => {
      const run = ++version;
      try {
        const next = await readTodos();
        if (alive.current && run === version) { setTodos(next); setReady(true); setError(null); }
      } catch { if (alive.current) setError('无法读取待办，请刷新后重试。'); }
    };
    const unsub = subscribeLocal(TODOS_KEY, () => void reload());
    void reload();
    return () => { alive.current = false; ++version; unsub(); };
  }, []);
  useEffect(() => {
    if (!deleted) return;
    const timer = setTimeout(() => setDeleted(null), 10_000);
    return () => clearTimeout(timer);
  }, [deleted]);

  const perform = useCallback(async (change: (prev: Todo[]) => Todo[]) => {
    if (!ready || busy.current) return false;
    busy.current = true; setPending(true); setError(null);
    try {
      const next = await mutateTodos(change);
      if (alive.current) setTodos(next);
      return true;
    } catch { if (alive.current) setError('保存失败，请检查本地存储后重试。'); return false; }
    finally { busy.current = false; if (alive.current) setPending(false); }
  }, [ready]);

  return { todos, ready, pending, error, canUndo: !!deleted,
    add: (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return Promise.resolve(false);
      return perform(prev => [...prev, { id: `t-${crypto.randomUUID()}`, done: false, text: trimmed.slice(0, 500), tag: 'work' }]);
    },
    toggle: (id: string) => perform(prev => prev.map(todo => todo.id === id ? { ...todo, done: !todo.done } : todo)),
    remove: async (id: string) => {
      let snapshot: Todo | undefined;
      const saved = await perform(prev => { snapshot = prev.find(todo => todo.id === id); return prev.filter(todo => todo.id !== id); });
      if (saved && snapshot && alive.current) setDeleted(snapshot);
    },
    undo: async () => {
      const snapshot = deleted;
      if (!snapshot) return;
      if (await perform(prev => prev.some(todo => todo.id === snapshot.id) ? prev : [...prev, snapshot])) setDeleted(null);
    },
  };
}
