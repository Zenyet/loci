import { useEffect, useState } from 'react';
import { useWidgetRecord } from './useWidgetRecord';
import { FOCUS_KEY, focusRemaining, normalizeFocus } from '../services/focus';

export function useFocus() {
  const record = useWidgetRecord(FOCUS_KEY, normalizeFocus);
  const [now, setNow] = useState(Date.now);
  const endAt = record.value.endAt;
  useEffect(() => {
    setNow(Date.now());
    if (!endAt) return;
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [endAt]);
  return { ...record, now,
    toggle: (minutes: number) => record.update(value => {
      const remaining = focusRemaining(value);
      if (value.endAt && remaining > 0) return { ...value, remaining, endAt: null };
      const duration = value.mode === 'break' ? 5 * 60_000 : minutes * 60_000;
      const next = remaining === 0 || value.remaining === value.duration ? duration : remaining;
      return { ...value, duration, remaining: next, endAt: Date.now() + next };
    }),
    reset: (minutes: number, mode = record.value.mode) => record.update(value => {
      const duration = (mode === 'break' ? 5 : minutes) * 60_000;
      return { ...value, mode, duration, remaining: duration, endAt: null };
    }),
  };
}
