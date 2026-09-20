export interface HolidayPeriod {
  name: string;
  start: string;
  end: string;
  workdays: readonly string[];
}

export interface HolidayYear {
  region: '中国大陆';
  year: number;
  version: string;
  publishedAt: string;
  source: string;
  periods: readonly HolidayPeriod[];
}

/** Curated annual arrangements, including compensating workdays. Do not infer
 * missing years from weekends or repeat an earlier year's schedule. */
export const HOLIDAY_YEARS: Readonly<Record<number, HolidayYear | undefined>> = {
  2026: {
    region: '中国大陆', year: 2026, version: '2026.1', publishedAt: '2025-11-04',
    source: 'https://www.beijing.gov.cn/zhengce/zhengcefagui/202511/t20251104_4258873.html',
    periods: [
      { name: '元旦', start: '2026-01-01', end: '2026-01-03', workdays: ['2026-01-04'] },
      { name: '春节', start: '2026-02-15', end: '2026-02-23', workdays: ['2026-02-14', '2026-02-28'] },
      { name: '清明节', start: '2026-04-04', end: '2026-04-06', workdays: [] },
      { name: '劳动节', start: '2026-05-01', end: '2026-05-05', workdays: ['2026-05-09'] },
      { name: '端午节', start: '2026-06-19', end: '2026-06-21', workdays: [] },
      { name: '中秋节', start: '2026-09-25', end: '2026-09-27', workdays: [] },
      { name: '国庆节', start: '2026-10-01', end: '2026-10-07', workdays: ['2026-09-20', '2026-10-10'] },
    ],
  },
};
