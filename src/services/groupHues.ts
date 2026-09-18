/**
 * Per-folder color overrides (numeric legacy hues or exact sRGB hex).
 *
 * By default each folder gets a deterministic hue derived from its id (see
 * `folderHue`). This service layers user-picked overrides on top so that
 * people can recolour any group without losing the nice auto-palette for
 * groups they haven't touched.
 *
 * Storage: chrome.storage.local in the extension, localStorage in the dev
 * browser. The original storage key and numeric entries remain compatible.
 */

import { hasChromeApi } from './chromeApi';
import type { GroupColor, GroupColors } from '../types';
import { normalizeHex } from './color';

const KEY = 'newtab-group-hues';

type HueMap = GroupColors;

const listeners = new Set<(map: HueMap) => void>();
let cache: HueMap | null = null;
let loading: Promise<HueMap> | null = null;
let writing = Promise.resolve();

function sanitize(value: unknown): HueMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: HueMap = {};
  for (const [id, color] of Object.entries(value)) {
    if (typeof color === 'number' && Number.isFinite(color)) result[id] = ((color % 360) + 360) % 360;
    else if (typeof color === 'string') {
      const hex = normalizeHex(color);
      if (hex) result[id] = hex;
    }
  }
  return result;
}

async function read(): Promise<HueMap> {
  if (hasChromeApi && chrome.storage?.local) {
    const obj = await chrome.storage.local.get(KEY);
    return sanitize(obj[KEY]);
  }
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitize(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

async function write(map: HueMap): Promise<void> {
  if (hasChromeApi && chrome.storage?.local) {
    await chrome.storage.local.set({ [KEY]: map });
    return;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* noop */
  }
}

function emit(map: HueMap) {
  listeners.forEach((fn) => {
    try {
      fn(map);
    } catch {
      /* swallow listener errors */
    }
  });
}

export async function loadGroupHues(): Promise<HueMap> {
  if (cache) return cache;
  loading ??= read();
  cache = await loading;
  return cache;
}

async function update(change: (map: HueMap) => void): Promise<HueMap> {
  if (!cache) await loadGroupHues();
  const map = { ...cache };
  change(map);
  cache = map;
  // Publish immediately while serializing writes so quick drags cannot save stale colors.
  emit(map);
  writing = writing.catch(() => {}).then(() => write(map));
  await writing;
  return map;
}

export async function setGroupHue(id: string, color: GroupColor): Promise<HueMap> {
  const normalized = typeof color === 'number'
    ? (Number.isFinite(color) ? ((color % 360) + 360) % 360 : null)
    : normalizeHex(color);
  if (normalized === null) throw new Error('Invalid group color');
  return update(map => { map[id] = normalized; });
}

export async function clearGroupHue(id: string): Promise<HueMap> {
  return update(map => { delete map[id]; });
}

export function subscribeGroupHues(cb: (map: HueMap) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
