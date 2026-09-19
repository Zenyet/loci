/** Extension storage and a same-origin preview adapter. Errors reach the UI. */
const localEvent = 'loci:local-storage';
const extensionStorage = () => typeof chrome !== 'undefined' && !!chrome.storage?.local;

export async function readLocal<T>(key: string): Promise<T | undefined> {
  if (extensionStorage()) return (await chrome.storage.local.get(key))[key] as T | undefined;
  const raw = localStorage.getItem(key);
  if (!raw) return undefined;
  try { return JSON.parse(raw) as T; } catch { return undefined; }
}

export async function writeLocal<T>(key: string, value: T): Promise<void> {
  if (extensionStorage()) await chrome.storage.local.set({ [key]: value });
  else {
    localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent(localEvent, { detail: key }));
  }
}

export function subscribeLocal(key: string, onChange: () => void): () => void {
  if (extensionStorage() && chrome.storage.onChanged) {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && key in changes) onChange();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }
  const onStorage = (event: StorageEvent) => { if (event.key === key || event.key === null) onChange(); };
  const onLocal = (event: Event) => { if ((event as CustomEvent).detail === key) onChange(); };
  window.addEventListener('storage', onStorage);
  window.addEventListener(localEvent, onLocal);
  return () => { window.removeEventListener('storage', onStorage); window.removeEventListener(localEvent, onLocal); };
}

const queues = new Map<string, Promise<unknown>>();
/** Web Locks serialize read-modify-write across new tabs and release on close. */
export async function withLocalLock<T>(name: string, task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return await navigator.locks.request(`loci:${name}`, { signal }, task);
  }
  const next = (queues.get(name) ?? Promise.resolve()).catch(() => {}).then(() => {
    signal?.throwIfAborted();
    return task();
  });
  queues.set(name, next);
  void next.finally(() => { if (queues.get(name) === next) queues.delete(name); }).catch(() => {});
  return next;
}
