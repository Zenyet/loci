import { hasChromeApi } from '../chromeApi';
import type { GroupingUndo } from '../../types';

const UNDO_KEY = 'newtab-grouping-undo';

export async function loadUndo(): Promise<GroupingUndo | null> {
  if (hasChromeApi && chrome.storage?.local) {
    const obj = await chrome.storage.local.get(UNDO_KEY);
    return (obj[UNDO_KEY] as GroupingUndo) ?? null;
  }
  try {
    const raw = localStorage.getItem(UNDO_KEY);
    return raw ? (JSON.parse(raw) as GroupingUndo) : null;
  } catch {
    return null;
  }
}

export async function saveUndo(u: GroupingUndo): Promise<void> {
  if (hasChromeApi && chrome.storage?.local) {
    await chrome.storage.local.set({ [UNDO_KEY]: u });
    return;
  }
  localStorage.setItem(UNDO_KEY, JSON.stringify(u));
}

export async function clearUndo(): Promise<void> {
  if (hasChromeApi && chrome.storage?.local) {
    await chrome.storage.local.remove(UNDO_KEY);
    return;
  }
  try {
    localStorage.removeItem(UNDO_KEY);
  } catch {
    /* noop */
  }
}
