import { useImageSource } from './useImageSource';
import { useBingWallpaper } from './useBingWallpaper';
import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_SETTINGS, type ResolvedTheme, type Settings } from "../types";
import { loadSettings, saveSettings, normalizeSettings } from "../services/chromeApi";
import { subscribeLocal } from '../services/localStore';
import { backgroundImageCssValue } from "../data/backgrounds";

export function useSettings(): {
  settings: Settings;
  resolvedTheme: ResolvedTheme;
  update: (patch: Partial<Settings>) => void;
  ready: boolean;
} {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);
  const [ready, setReady] = useState(false);
  const latest = useRef(settings);
  const revision = useRef(0);
  const pendingWrite = useRef(0);
  const reloadRef = useRef(() => {});
  const bing = useBingWallpaper(ready && settings.bg === "image" && settings.bingWallpaper);

  const image = useImageSource(settings.bingWallpaper && bing.data ? bing.data.imageRef : settings.bgImage);

  useEffect(() => {
    let alive = true;
    let version = 0;
    const reload = () => {
      // Storage notifications for an earlier drag must not overwrite a newer
      // optimistic position while its write is still queued.
      if (pendingWrite.current) return;
      const run = ++version;
      const localRevision = revision.current;
      void loadSettings().then(s => {
        if (alive && run === version && localRevision === revision.current && !pendingWrite.current) {
          latest.current = s; setSettings(s); setReady(true);
        }
      }).catch(() => { if (alive) setReady(true); });
    };
    reloadRef.current = reload;
    const unsubscribe = subscribeLocal('newtab-settings', reload);
    reload();
    return () => { alive = false; reloadRef.current = () => {}; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const updateSystemTheme = (matches: boolean) =>
      setSystemTheme(matches ? "light" : "dark");
    updateSystemTheme(media.matches);

    const onChange = (event: MediaQueryListEvent) => {
      updateSystemTheme(event.matches);
    };
    if (media.addEventListener) {
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    }
    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    const next = normalizeSettings({ ...latest.current, ...patch });
    const write = ++revision.current;
    pendingWrite.current = write;
    latest.current = next;
    setSettings(next);
    // Keep side effects outside React's updater: StrictMode can replay it.
    void saveSettings(next).then(() => {
      if (pendingWrite.current !== write) return;
      pendingWrite.current = 0;
      reloadRef.current();
    }).catch(() => {
      if (pendingWrite.current === write) pendingWrite.current = 0;
    });
  }, []);

  const resolvedTheme =
    settings.theme === "system" ? systemTheme : settings.theme;

  // Apply settings to <html>/<body> whenever they change.
  useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.themePreference = settings.theme;
    document.body.dataset.theme = resolvedTheme;
    document.body.dataset.themePreference = settings.theme;
    document.body.dataset.density = settings.density;
    document.body.dataset.reduceMotion = settings.reduceMotion ? "1" : "";
    document.body.dataset.bg = settings.bg;
    document.documentElement.style.colorScheme = resolvedTheme;
    document.documentElement.style.setProperty(
      "--accent",
      `oklch(${resolvedTheme === "light" ? "0.58" : "0.70"} 0.18 ${settings.accentHue})`,
    );
    document.documentElement.style.setProperty(
      "--accent-soft",
      `oklch(0.64 0.18 ${settings.accentHue} / 0.16)`,
    );
    document.documentElement.style.setProperty("--accent-ink", "#fff");
    // Custom background image: applied as a layered CSS variable which the
    // `[data-bg="image"]` selector in tokens.css paints. The stored value
    // can be a URL/data URL or a gradient string; the normaliser returns
    // a CSS `background-image` expression either way.
    if (settings.bg === "image" && image.url) {
      document.documentElement.style.setProperty(
        "--bg-image",
        backgroundImageCssValue(image.url),
      );
      document.documentElement.style.setProperty(
        "--bg-image-dim",
        String(settings.bgImageDim),
      );
    } else {
      document.documentElement.style.removeProperty("--bg-image");
      document.documentElement.style.removeProperty("--bg-image-dim");
    }
  }, [settings, resolvedTheme, ready, image.url]);

  return { settings, resolvedTheme, update, ready };
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}
