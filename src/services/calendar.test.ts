import { describe, expect, it } from 'vitest';
import { HOLIDAY_YEARS } from '../data/holidays';
import { addDays, dayDescription, daysBetween, festivals, holidayOn, localDateKey, lunarDate, monthDays, moveMonth, nextHoliday, weekday } from './calendar';

describe('civil calendar dates', () => {
  it('builds six Monday-first weeks across year and leap-month boundaries', () => {
    const january = monthDays('2027-01-20');
    expect(january).toHaveLength(42);
    expect(january[0]).toBe('2026-12-28');
    expect(january[41]).toBe('2027-02-07');
    expect(weekday(january[0])).toBe(0);
    expect(monthDays('2024-02-01')).toContain('2024-02-29');
    expect(monthDays('2026-02-01')).not.toContain('2026-02-29');
  });
  it('clamps month changes and navigation bounds without skipping short months', () => {
    expect(moveMonth('2024-01-31', 1)).toBe('2024-02-29');
    expect(moveMonth('2026-03-31', -1)).toBe('2026-02-28');
    expect(moveMonth('2026-12-31', 1)).toBe('2027-01-31');
    expect(moveMonth('1901-01-01', -1)).toBe('1901-01-01');
    expect(moveMonth('2100-12-31', 1)).toBe('2100-12-31');
  });
  it('uses local dates for today and whole civil days across DST transitions', () => {
    expect(localDateKey(new Date(2026, 8, 20, 0, 1))).toBe('2026-09-20');
    expect(localDateKey(new Date(2026, 8, 20, 23, 59))).toBe('2026-09-20');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
  });
});

describe('offline lunar calendar', () => {
  it('marks lunar new year and New Year’s Eve even when the final lunar month has 29 days', () => {
    expect(lunarDate('2026-02-17')).toMatchObject({ month: '正月', day: 1, short: '正月', full: '丙午年 正月初一' });
    expect(lunarDate('2026-02-16')).toMatchObject({ month: '腊月', day: 29, short: '廿九' });
    expect(festivals('2026-02-16')).toContain('除夕');
    expect(festivals('2026-02-17')).toContain('春节');
    expect(festivals('2026-09-25')).toContain('中秋节');
  });
  it('preserves leap-month labels and the lunar year across Gregorian new year', () => {
    expect(lunarDate('2025-07-25')).toMatchObject({ month: '闰六月', day: 1, leap: true, short: '闰六月' });
    expect(lunarDate('2025-08-22')).toMatchObject({ month: '闰六月', day: 29, leap: true });
    expect(lunarDate('2026-01-01')?.full).toContain('乙巳年');
  });
  it('does not treat a traditional festival as an official day off', () => {
    expect(festivals('2026-03-03')).toContain('元宵节');
    expect(holidayOn('2026-03-03')).toBeNull();
    expect(dayDescription('2026-03-03')).toBe('工作日');
  });
});

describe('official mainland holiday arrangements', () => {
  it('distinguishes weekends, compensating workdays and holiday periods', () => {
    expect(holidayOn('2026-09-20')).toEqual({ kind: 'work', name: '国庆节' });
    expect(holidayOn('2026-10-10')).toEqual({ kind: 'work', name: '国庆节' });
    expect(holidayOn('2026-09-25')).toEqual({ kind: 'rest', name: '中秋节' });
    expect(holidayOn('2026-09-27')).toEqual({ kind: 'rest', name: '中秋节' });
    expect(holidayOn('2026-09-28')).toBeNull();
    expect(dayDescription('2026-09-19')).toBe('周末');
  });
  it('matches the 2026 notice: 33 days off, 6 compensating workdays, no overlaps', () => {
    const periods = HOLIDAY_YEARS[2026]!.periods;
    const rest = periods.flatMap(period => Array.from({ length: daysBetween(period.start, period.end) + 1 }, (_, i) => addDays(period.start, i)));
    const work = periods.flatMap(period => period.workdays);
    expect(rest).toHaveLength(33); expect(new Set(rest).size).toBe(33);
    expect(work).toHaveLength(6);
    expect(work.some(day => rest.includes(day))).toBe(false);
  });
  it('calculates the next break from today, including a break already in progress', () => {
    expect(nextHoliday('2026-09-20')).toMatchObject({ name: '中秋节', daysUntil: 5, days: 3, ongoing: false });
    expect(nextHoliday('2026-09-27')).toMatchObject({ name: '中秋节', daysUntil: 0, ongoing: true });
    expect(nextHoliday('2026-09-28')?.name).toBe('国庆节');
    expect(nextHoliday('2026-10-08')).toBeNull();
  });
  it('leaves missing years unknown rather than reusing schedules or assuming weekend rest', () => {
    expect(holidayOn('2027-01-01')).toBeNull();
    expect(dayDescription('2027-01-03')).toBe('放假安排待更新');
    expect(nextHoliday('2027-01-01')).toBeNull();
    expect(nextHoliday('2025-12-01')).toBeNull();
  });
});
