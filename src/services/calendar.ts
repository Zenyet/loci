import { HOLIDAY_YEARS } from '../data/holidays';

export const CALENDAR_MIN = '1901-01-01';
export const CALENDAR_MAX = '2100-12-31';
const DAY_MS = 86_400_000;

/** A device-local calendar date, not the UTC date of the current instant. */
export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Civil dates use UTC only for arithmetic/formatting, never timezone conversion.
 * This keeps month cells and lunar dates stable across DST and device zones. */
function civilDate(key: string): Date { return new Date(`${key}T12:00:00Z`); }
function civilKey(date: Date): string { return date.toISOString().slice(0, 10); }
export function addDays(key: string, days: number): string {
  return civilKey(new Date(civilDate(key).getTime() + days * DAY_MS));
}
export function daysBetween(start: string, end: string): number {
  return Math.round((civilDate(end).getTime() - civilDate(start).getTime()) / DAY_MS);
}
export function weekday(key: string): number { return (civilDate(key).getUTCDay() + 6) % 7; }
export function clampDate(key: string): string { return key < CALENDAR_MIN ? CALENDAR_MIN : key > CALENDAR_MAX ? CALENDAR_MAX : key; }
export function moveMonth(key: string, amount: number): string {
  const date = civilDate(key), day = date.getUTCDate();
  date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + amount);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return clampDate(civilKey(date));
}
export function monthDays(key: string): string[] {
  const first = `${key.slice(0, 7)}-01`;
  const start = addDays(first, -weekday(first));
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}
export function formatCalendarDate(key: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('zh-CN', { ...options, timeZone: 'UTC' }).format(civilDate(key));
}

const lunarFormatter = (() => {
  try {
    const formatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
    return formatter.resolvedOptions().calendar === 'chinese' ? formatter : null;
  } catch { return null; }
})();
const DAY_NAMES = ['初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'];
export interface LunarDate { month: string; day: number; leap: boolean; short: string; full: string }
export function lunarDate(key: string): LunarDate | null {
  if (!lunarFormatter) return null;
  const parts = lunarFormatter.formatToParts(civilDate(key));
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
  const month = part('month'), day = Number(part('day')), name = DAY_NAMES[day - 1];
  if (!month || !name) return null;
  return { month, day, leap: month.startsWith('闰'), short: day === 1 ? month : name,
    full: `${part('yearName') || part('relatedYear')}年 ${month}${name}` };
}

const LUNAR_FESTIVALS: Readonly<Record<string, string>> = {
  '正月-1': '春节', '正月-15': '元宵节', '五月-5': '端午节', '七月-7': '七夕',
  '八月-15': '中秋节', '九月-9': '重阳节', '腊月-8': '腊八节',
};
const SOLAR_FESTIVALS: Readonly<Record<string, string>> = { '01-01': '元旦', '05-01': '劳动节', '10-01': '国庆节' };
/** Festival names do not imply days off; leap months do not repeat festivals. */
export function festivals(key: string, lunar = lunarDate(key)): string[] {
  const names = [SOLAR_FESTIVALS[key.slice(5)]];
  if (lunar && !lunar.leap) {
    names.push(LUNAR_FESTIVALS[`${lunar.month}-${lunar.day}`]);
    if (lunar.month === '腊月' && lunar.day >= 29) {
      const next = lunarDate(addDays(key, 1));
      if (next?.month === '正月' && next.day === 1) names.push('除夕');
    }
  }
  return names.filter((name): name is string => !!name);
}

export function holidayYear(key: string) { return HOLIDAY_YEARS[Number(key.slice(0, 4))]; }
export function holidayOn(key: string): { kind: 'rest' | 'work'; name: string } | null {
  for (const period of holidayYear(key)?.periods ?? []) {
    if (period.workdays.includes(key)) return { kind: 'work', name: period.name };
    if (key >= period.start && key <= period.end) return { kind: 'rest', name: period.name };
  }
  return null;
}
export function dayDescription(key: string): string {
  const holiday = holidayOn(key);
  if (holiday) return `${holiday.name}${holiday.kind === 'work' ? '调休 · 补班' : '假期 · 休息'}`;
  if (!holidayYear(key)) return '放假安排待更新';
  return weekday(key) >= 5 ? '周末' : '工作日';
}
export function nextHoliday(today: string) {
  // Do not skip over an unknown year and imply that a later holiday is next.
  for (let year = Number(today.slice(0, 4)); ; year++) {
    const schedule = HOLIDAY_YEARS[year];
    if (!schedule) return null;
    const period = schedule.periods.find(item => item.end >= today);
    if (period) return { ...period, daysUntil: Math.max(0, daysBetween(today, period.start)),
      days: daysBetween(period.start, period.end) + 1, ongoing: today >= period.start };
  }
}
