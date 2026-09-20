import { DEFAULT_SETTINGS, type WeatherCity, type WidgetId, type WidgetSettings } from '../types';

export function validCity(value: unknown): value is WeatherCity {
  if (!value || typeof value !== 'object') return false;
  const city = value as WeatherCity;
  return Number.isFinite(city.id) && typeof city.name === 'string' && !!city.name.trim()
    && typeof city.region === 'string' && typeof city.country === 'string'
    && Number.isFinite(city.latitude) && Math.abs(city.latitude) <= 90
    && Number.isFinite(city.longitude) && Math.abs(city.longitude) <= 180;
}

export function normalizeWidgets(raw: Partial<WidgetSettings> | undefined): WidgetSettings {
  const defaults = DEFAULT_SETTINGS.widgets;
  const order = Array.isArray(raw?.order) ? raw.order : [];
  return {
    version: 1,
    order: [...new Set([...order.filter((id): id is WidgetId => defaults.order.includes(id)), ...defaults.order])],
    clock: { enabled: raw?.clock?.enabled === true, hour12: raw?.clock?.hour12 === true },
    weather: {
      enabled: raw?.weather?.enabled === true,
      city: validCity(raw?.weather?.city) ? raw.weather.city : null,
      unit: raw?.weather?.unit === 'fahrenheit' ? 'fahrenheit' : 'celsius',
    },
    todos: { enabled: raw?.todos?.enabled === true },
    calendar: {
      showLunar: raw?.calendar?.showLunar !== false,
      showHolidays: raw?.calendar?.showHolidays !== false,
    },
  };
}

type WidgetPatch = { [K in WidgetId | 'calendar']?: Partial<WidgetSettings[K]> } & { order?: WidgetId[] };
/** Keep legacy weather preferences, but display clock/weather as one card. */
export function widgetCardOrder(settings: WidgetSettings): Exclude<WidgetId, 'weather'>[] {
  return [...new Set(settings.order.map(id => id === 'weather' ? 'clock' : id))];
}

export function patchWidgets(current: WidgetSettings, patch: WidgetPatch): WidgetSettings {
  return normalizeWidgets({ ...current, ...patch,
    clock: { ...current.clock, ...patch.clock },
    weather: { ...current.weather, ...patch.weather },
    todos: { ...current.todos, ...patch.todos },
    calendar: { ...current.calendar, ...patch.calendar },
  });
}
