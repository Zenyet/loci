export const FOCUS_KEY = 'loci-focus-v1';
export interface FocusRecord {
  mode: 'focus' | 'break';
  duration: number;
  remaining: number;
  endAt: number | null;
  taskId: string;
}
export function normalizeFocus(raw: unknown): FocusRecord {
  const value = raw && typeof raw === 'object' ? raw as Partial<FocusRecord> : {};
  const duration = typeof value.duration === 'number' && Number.isFinite(value.duration) && value.duration >= 60_000 && value.duration <= 180 * 60_000 ? value.duration : 25 * 60_000;
  return { mode: value.mode === 'break' ? 'break' : 'focus', duration,
    remaining: typeof value.remaining === 'number' && Number.isFinite(value.remaining) ? Math.min(duration, Math.max(0, value.remaining)) : duration,
    endAt: typeof value.endAt === 'number' && Number.isFinite(value.endAt) && value.endAt > 0 ? value.endAt : null,
    taskId: typeof value.taskId === 'string' ? value.taskId : '' };
}
export const focusRemaining = (value: FocusRecord, now = Date.now()) => value.endAt === null ? value.remaining : Math.max(0, Math.min(value.duration, value.endAt - now));
export function focusLabel(value: FocusRecord, now = Date.now()) {
  const seconds = Math.ceil(focusRemaining(value, now) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
