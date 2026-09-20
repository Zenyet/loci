import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { WidgetSettings } from '../../types';
import { addDays, CALENDAR_MAX, CALENDAR_MIN, clampDate, dayDescription, festivals, formatCalendarDate,
  holidayOn, holidayYear, localDateKey, lunarDate, monthDays, moveMonth, nextHoliday, weekday } from '../../services/calendar';
import { Icon } from '../Icon';
import './calendar.css';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

export function CalendarWidget({ now, settings }: { now: Date; settings: WidgetSettings['calendar'] }) {
  const today = localDateKey(now);
  const [selected, setSelected] = useState(() => clampDate(today));
  const month = selected.slice(0, 7);
  const grid = useRef<HTMLTableElement>(null);
  const focusDate = useRef(false);
  const { showLunar, showHolidays } = settings;
  const days = useMemo(() => monthDays(`${month}-01`).map(key => {
    const lunar = showLunar ? lunarDate(key) : null;
    const names = showLunar ? festivals(key, lunar) : [];
    return { key, lunar, names, holiday: showHolidays ? holidayOn(key) : null };
  }), [month, showLunar, showHolidays]);
  const selectedLunar = showLunar ? lunarDate(selected) : null;
  const selectedFestivals = showLunar ? festivals(selected, selectedLunar) : [];
  const selectedHoliday = showHolidays ? holidayOn(selected) : null;
  const schedule = holidayYear(selected);
  const upcoming = showHolidays ? nextHoliday(today) : null;
  const monthLabel = formatCalendarDate(selected, { year: 'numeric', month: 'long' });

  useLayoutEffect(() => {
    if (!focusDate.current) return;
    grid.current?.querySelector<HTMLButtonElement>(`[data-date="${selected}"]`)?.focus();
    focusDate.current = false;
  }, [selected]);

  const move = (key: string, focus = false) => {
    const next = clampDate(key);
    if (next === selected) {
      if (focus) grid.current?.querySelector<HTMLButtonElement>(`[data-date="${next}"]`)?.focus();
      return;
    }
    focusDate.current = focus;
    setSelected(next);
  };
  const onDateKey = (event: KeyboardEvent<HTMLButtonElement>, key: string) => {
    let next: string;
    switch (event.key) {
      case 'ArrowLeft': next = addDays(key, -1); break;
      case 'ArrowRight': next = addDays(key, 1); break;
      case 'ArrowUp': next = addDays(key, -7); break;
      case 'ArrowDown': next = addDays(key, 7); break;
      case 'Home': next = addDays(key, -weekday(key)); break;
      case 'End': next = addDays(key, 6 - weekday(key)); break;
      case 'PageUp': next = moveMonth(key, event.shiftKey ? -12 : -1); break;
      case 'PageDown': next = moveMonth(key, event.shiftKey ? 12 : 1); break;
      default: return;
    }
    event.preventDefault(); event.stopPropagation(); move(next, true);
  };

  return <div className="calendar-widget">
    <div className="calendar-heading">
      <h2 id="calendar-month" aria-live="polite">{monthLabel}</h2>
      <nav className="calendar-nav" aria-label="切换月份">
        <button type="button" aria-label="上个月" disabled={month === CALENDAR_MIN.slice(0, 7)} onClick={() => move(moveMonth(selected, -1))}><Icon name="chevron-left" size={15} /></button>
        <button type="button" className="calendar-today" onClick={() => move(today)}>今天</button>
        <button type="button" aria-label="下个月" disabled={month === CALENDAR_MAX.slice(0, 7)} onClick={() => move(moveMonth(selected, 1))}><Icon name="chevron-left" size={15} className="calendar-next" /></button>
      </nav>
    </div>
    <table ref={grid} className="calendar-grid" role="grid" aria-labelledby="calendar-month" aria-describedby="calendar-keyboard-help">
      <thead><tr>{WEEKDAYS.map(day => <th key={day} scope="col" abbr={`星期${day}`}>{day}</th>)}</tr></thead>
      <tbody>{Array.from({ length: 6 }, (_, week) => <tr key={week}>
        {days.slice(week * 7, week * 7 + 7).map(({ key, lunar, names, holiday }) => {
          const outside = !key.startsWith(month), active = key === selected, isToday = key === today;
          const subtitle = names[0] || lunar?.short;
          const label = [formatCalendarDate(key, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }),
            isToday ? '今天' : '', showLunar ? lunar?.full : '', ...names,
            showHolidays ? dayDescription(key) : ''].filter(Boolean).join('，');
          return <td key={key} role="gridcell" aria-selected={active}>
            <button type="button" className="calendar-day" data-date={key} data-outside={outside || undefined}
              data-selected={active || undefined} data-today={isToday || undefined}
              disabled={key < CALENDAR_MIN || key > CALENDAR_MAX} tabIndex={active ? 0 : -1}
              aria-label={label} aria-current={isToday ? 'date' : undefined}
              onClick={() => move(key, true)} onKeyDown={event => onDateKey(event, key)}>
              <span className="calendar-day__number">{Number(key.slice(8))}</span>
              {subtitle && <span className="calendar-day__lunar" data-festival={names.length > 0 || undefined}>{subtitle}</span>}
              {holiday && <span className="calendar-day__badge" data-kind={holiday.kind} aria-hidden="true">{holiday.kind === 'rest' ? '休' : '班'}</span>}
            </button>
          </td>;
        })}
      </tr>)}</tbody>
    </table>
    <p id="calendar-keyboard-help" className="calendar-sr-only">方向键选择日期，Home 和 End 跳至周首或周末，Page Up 和 Page Down 切换月份，按住 Shift 切换年份。</p>
    <div className="calendar-selection" aria-live="polite" aria-atomic="true">
      <div className="calendar-selection__date"><strong>{formatCalendarDate(selected, { month: 'long', day: 'numeric', weekday: 'long' })}</strong>
        {showHolidays && <span className="calendar-selection__status" data-kind={selectedHoliday?.kind}>{dayDescription(selected)}</span>}
      </div>
      {showLunar && <p>{selectedLunar ? `农历 ${selectedLunar.full}` : '此浏览器暂不支持农历'}{selectedFestivals.length > 0 && <span> · {selectedFestivals.join(' · ')}</span>}</p>}
    </div>
    {showHolidays && <>
      <div className="calendar-upcoming">
        {upcoming ? <><span>{upcoming.ongoing ? '正在放假' : '下一段假期'}<strong>{upcoming.name}</strong></span><span>{upcoming.ongoing ? '假期中' : `距今 ${upcoming.daysUntil} 天`}<small>共 {upcoming.days} 天</small></span></>
          : <p>后续放假安排待更新</p>}
      </div>
      <footer className="calendar-source">
        <div className="calendar-legend"><span><i data-kind="rest">休</i> 放假</span><span><i data-kind="work">班</i> 补班</span><span>中国大陆</span></div>
        {schedule ? <a href={schedule.source} target="_blank" rel="noreferrer">{schedule.year} 年安排 · 国务院办公厅 ↗</a>
          : <span>{selected.slice(0, 4)} 年放假安排待更新</span>}
      </footer>
    </>}
  </div>;
}
