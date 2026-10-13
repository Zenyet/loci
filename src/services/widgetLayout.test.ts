import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../types';
import { normalizeWidgets, patchWidgets } from './widgetSettings';
import { DESKTOP_WIDGETS, placementFromPixels, resolveWidgetLayout, widgetDimensions } from './widgetLayout';

describe('desktop widget layout', () => {
  it('migrates old preferences, retaining cities and disabled widgets while adding the calendar', () => {
    const old = normalizeWidgets({ weather: { enabled: true, city: { id: 1, name: '广州', region: '广东', country: '中国', latitude: 23.1, longitude: 113.3 }, unit: 'celsius' } });
    expect(old.weather.city?.name).toBe('广州'); expect(old.calendar.enabled).toBe(true);
    expect(old.notes.enabled).toBe(false); expect(old.desktop.layout).toEqual({});
  });
  it('repairs corrupt positions, discards unknown widgets and keeps a disabled widget position', () => {
    const settings = normalizeWidgets({ desktop: { appearance: 'bad', layout: { notes: { x: 40, y: -3, size: 'wrong' }, focus: { x: NaN, y: 1 }, unknown: { x: 0, y: 0 } } } } as never);
    expect(settings.desktop).toEqual({ appearance: 'auto', layout: { notes: { x: 1, y: 0, size: 'small' } } });
    const off = patchWidgets(settings, { notes: { enabled: false } });
    expect(off.desktop.layout.notes).toEqual(settings.desktop.layout.notes);
  });
  it('keeps saved cards inside a smaller viewport and round-trips a drag position', () => {
    const viewport = { width: 1280, height: 800 };
    const { width, height } = widgetDimensions('weather', 'medium', viewport.width);
    const saved = placementFromPixels(700, 440, width, height, viewport, 'medium');
    const settings = patchWidgets(DEFAULT_SETTINGS.widgets, { weather: { enabled: true }, desktop: { layout: { weather: saved } } });
    expect(resolveWidgetLayout(settings, viewport)[0]).toMatchObject({ left: 700, top: 440 });
    const frame = resolveWidgetLayout(settings, { width: 390, height: 600 })[0];
    expect(frame.left).toBeGreaterThanOrEqual(0); expect(frame.left + frame.width).toBeLessThanOrEqual(390);
    expect(frame.top + frame.height).toBeLessThanOrEqual(600);
  });
  it('packs unsaved cards without overlaps and keeps narrow-screen cards reachable by scrolling', () => {
    let settings = DEFAULT_SETTINGS.widgets;
    for (const id of DESKTOP_WIDGETS) settings = patchWidgets(settings, { [id]: { enabled: true } });
    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 640 }]) {
      const frames = resolveWidgetLayout(settings, viewport);
      expect(frames).toHaveLength(8);
      for (let i = 0; i < frames.length; i++) for (const b of frames.slice(i + 1)) {
        const a = frames[i];
        expect(a.left + a.width <= b.left || b.left + b.width <= a.left || a.top + a.height <= b.top || b.top + b.height <= a.top).toBe(true);
      }
    }
  });
  it('keeps all default widgets outside the central bookmark area on a desktop', () => {
    let settings = DEFAULT_SETTINGS.widgets;
    for (const id of DESKTOP_WIDGETS) settings = patchWidgets(settings, { [id]: { enabled: true } });
    const frames = resolveWidgetLayout(settings, { width: 1280, height: 720 });
    for (const frame of frames) {
      expect(frame.width).toBeLessThanOrEqual(200);
      expect(frame.left + frame.width <= 240 || frame.left >= 1040).toBe(true);
    }
    expect(frames[0]).toMatchObject({ id: 'weather', width: 200, height: 156 });
    expect(frames[1]).toMatchObject({ id: 'calendar', width: 200, height: 238 });
  });
});

it('round-trips each viewport corner, while preserving legacy inset positions', () => {
  const viewport = { width: 1280, height: 800 };
  for (const [left, top] of [[0, 0], [1080, 0], [0, 562], [1080, 562]]) {
    const placement = placementFromPixels(left, top, 200, 238, viewport, 'small');
    const settings = patchWidgets(DEFAULT_SETTINGS.widgets, { desktop: { layout: { calendar: placement } } });
    const frame = resolveWidgetLayout(settings, viewport).find(frame => frame.id === 'calendar')!;
    expect(frame.left).toBe(left); expect(frame.top).toBe(top);
  }
  const legacy = patchWidgets(DEFAULT_SETTINGS.widgets, { desktop: { layout: { calendar: { x: 0, y: 0, size: 'small' } } } });
  expect(resolveWidgetLayout(legacy, viewport).find(frame => frame.id === 'calendar')).toMatchObject({ left: 16, top: 76 });
});
