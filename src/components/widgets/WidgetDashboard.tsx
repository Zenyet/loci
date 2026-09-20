import { useEffect, useRef, useState } from 'react';
import type { WidgetSettings } from '../../types';
import { useClock } from '../../hooks/useClock';
import { useTodos } from '../../hooks/useTodos';
import { useWeather } from '../../hooks/useWeather';
import { useSurfaceDismiss } from '../../hooks/useSurfaceDismiss';
import { patchWidgets, widgetCardOrder } from '../../services/widgetSettings';
import { displayTemperature, requestWeatherPermission, weatherDescription, WEATHER_FRESH_MS, WEATHER_OLD_MS } from '../../services/weather';
import { CityPicker } from './CityPicker';
import { WeatherGlyph } from './WeatherGlyph';
import { Icon } from '../Icon';
import { CloseButton } from '../CloseButton';
import { CalendarWidget } from './CalendarWidget';
import './widgets.css';

interface Props {
  settings: WidgetSettings;
  onChange: (next: WidgetSettings) => void;
  onConfigure: () => void;
  onPanelChange: (open: boolean) => void;
  blocked: boolean;
}

export function WidgetDashboard({ settings, onChange, onConfigure, onPanelChange, blocked }: Props) {
  const now = useClock();
  const weather = useWeather(settings.weather);
  const todos = useTodos();
  const [open, setOpen] = useState<'calendar' | 'weather' | 'todos' | null>(null);
  const [choosingCity, setChoosingCity] = useState(false);
  const [draft, setDraft] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const pending = todos.todos.filter(todo => !todo.done);
  const completed = todos.todos.filter(todo => todo.done);
  const data = weather.data;
  const age = data ? now.getTime() - data.fetchedAt : 0;
  const old = age > WEATHER_OLD_MS;
  const stale = age >= WEATHER_FRESH_MS;
  const city = settings.weather.city;
  const close = (restore = false) => { setOpen(null); if (restore) trigger.current?.focus(); };
  useSurfaceDismiss('widgets', !!open, () => close());

  useEffect(() => { if (blocked) setOpen(null); }, [blocked]);
  useEffect(() => {
    if (open && open !== 'calendar' && !settings[open].enabled) setOpen(null);
  }, [settings, open]);
  useEffect(() => { onPanelChange(!!open); return () => onPanelChange(false); }, [open, onPanelChange]);
  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(null); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const allowWeather = async () => {
    setPermissionError(null);
    try {
      if (await requestWeatherPermission()) weather.recheck();
      else setPermissionError('未获得权限，稍后仍可重试。');
    } catch { setPermissionError('无法连接天气服务，请稍后重试。'); }
  };

  return <div className="widget-shell" ref={root} onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape' && open) { event.preventDefault(); close(true); }
  }} onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) close();
  }}>
    <div className="widget-bar" aria-label="日常小组件" ref={element => { if (element) element.inert = blocked; }}>
      {widgetCardOrder(settings).map(id => {
        if (id === 'clock') return <div className="widget-daily" key={id} role="group" aria-label="时间与天气" data-weather={settings.weather.enabled || undefined}>
          <button type="button" className="widget-daily__clock" aria-label="查看日历" aria-expanded={open === 'calendar'} aria-controls={open === 'calendar' ? 'daily-widget-panel' : undefined} aria-haspopup="dialog" onClick={event => {
            trigger.current = event.currentTarget; setOpen(current => current === 'calendar' ? null : 'calendar');
          }}>
            {settings.clock.enabled && <time className="widget-daily__time" dateTime={now.toISOString()}>{now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: settings.clock.hour12 })}</time>}
            <time className="widget-daily__date" dateTime={now.toISOString()}>{now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</time>
          </button>
          {settings.weather.enabled && <button type="button" className="widget-daily__weather" aria-label="查看天气" aria-expanded={open === 'weather'} aria-controls={open === 'weather' ? 'daily-widget-panel' : undefined} aria-haspopup="dialog" onClick={event => {
            trigger.current = event.currentTarget; setChoosingCity(false); setOpen(current => current === 'weather' ? null : 'weather');
          }}>
            <span className="widget-daily__forecast"><WeatherGlyph code={data?.code ?? null} isDay={data?.isDay} size={30} /><strong>{data && !old ? displayTemperature(data.temperature) : '—'}</strong>{(stale || !!weather.error) && <span className="widget-stale-dot" title="天气待更新" />}</span>
            <span className="widget-daily__city">{city?.name ?? '设置城市'}{data && !old ? ` · ${weatherDescription(data.code)}` : ''}</span>
          </button>}
        </div>;
        if (!settings[id].enabled) return null;
        return <button key={id} type="button" className="widget-summary" aria-label="查看今日待办" aria-expanded={open === id} aria-controls={open === id ? 'daily-widget-panel' : undefined} aria-haspopup="dialog" onClick={event => {
          trigger.current = event.currentTarget; setChoosingCity(false); setOpen(current => current === id ? null : id);
        }}>
          <Icon name="todo" size={18} /><span className="widget-todo-summary">{pending[0]?.text ?? '今日待办'}</span><strong className="widget-count">{pending.length}</strong>
        </button>;
      })}
    </div>
    <button type="button" className="widget-add" aria-label="添加小组件" title="添加小组件" disabled={blocked} onClick={onConfigure}><Icon name="widgets" size={18} /></button>

    {open && !blocked && <section ref={panel} tabIndex={-1} className={`widget-panel widget-panel--${open}`} id="daily-widget-panel" role="dialog" aria-label={open === 'calendar' ? '日历' : open === 'weather' ? '天气详情' : '今日待办'}>
      <header className="widget-panel__header"><span className="widget-eyebrow">{open === 'calendar' ? '日历 · 中国大陆' : open === 'weather' ? '窗外的天气' : '留给今天的事'}</span><CloseButton label="关闭小组件" onClick={() => close(true)} /></header>
      {open === 'calendar' ? <CalendarWidget now={now} settings={settings.calendar} /> : open === 'weather' ? <>
        {!weather.permission ? <div className="widget-empty"><Icon name="weather" size={40} /><h2>连接天气服务</h2><p>允许连接 Open-Meteo，查看所选城市的天气。</p><button type="button" className="widget-primary" onClick={() => void allowWeather()}>允许连接</button>{permissionError && <p className="widget-error" role="alert">{permissionError}</p>}</div>
        : !city || choosingCity ? <div className="widget-city-setup"><h2>{city ? '换一座城市' : '你想看哪里的天气？'}</h2><CityPicker onSelect={next => { onChange(patchWidgets(settings, { weather: { city: next } })); setChoosingCity(false); }} />{city && <button type="button" className="widget-text-button" onClick={() => setChoosingCity(false)}>返回 {city.name}</button>}</div>
        : <>
          <div className="weather-heading"><div><h2>{city.name}</h2><p>{[city.region, city.country].filter(Boolean).join(' · ')}</p></div><button type="button" className="widget-text-button" onClick={() => setChoosingCity(true)}>切换城市</button></div>
          {data ? <>
            <div className="weather-current"><div><span className="weather-current__label">{old ? '上次记录' : '当前温度'}</span><div className="weather-temperature">{displayTemperature(data.temperature)}<span>{settings.weather.unit === 'celsius' ? 'C' : 'F'}</span></div><p>{weatherDescription(data.code)}<span> · 体感 {displayTemperature(data.apparent)}</span></p></div><WeatherGlyph code={data.code} isDay={data.isDay} size={88} /></div>
            <div className="weather-stats"><span>最高 <strong>{displayTemperature(data.days[0]?.high)}</strong></span><span>最低 <strong>{displayTemperature(data.days[0]?.low)}</strong></span><span>降水概率 <strong>{data.days[0]?.rain == null ? '—' : `${Math.round(data.days[0].rain)}%`}</strong></span></div>
            <div className="weather-days" aria-label="三日预报">{data.days.map(day => <div key={day.date}><time dateTime={day.date}>{new Date(`${day.date}T12:00:00Z`).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', timeZone: 'UTC' })}</time><WeatherGlyph code={day.code} size={24} /><span>{weatherDescription(day.code)}</span><strong>{displayTemperature(day.high)} <small>{displayTemperature(day.low)}</small></strong></div>)}</div>
          </> : <div className="widget-empty"><WeatherGlyph code={null} size={64} /><p>{weather.loading ? '正在看看窗外…' : '暂时没有天气数据'}</p></div>}
          {weather.error && <p className="widget-error" role="status">{weather.error}</p>}
          <footer className="weather-footer"><span>{data ? `${stale ? '数据较旧 · ' : ''}${new Date(data.fetchedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 更新` : '等待更新'}</span><button type="button" disabled={weather.loading} onClick={weather.refresh}>{weather.loading ? '更新中…' : '刷新'}</button></footer>
        </>}
        <a className="weather-attribution" href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather data by Open-Meteo · CC BY 4.0</a>
      </> : <>
        <div className="todo-heading"><h2>今日待办<span>{pending.length}</span></h2><p>{pending.length ? '一件一件来，按自己的节奏。' : '给今天留一点方向。'}</p></div>
        <form className="todo-add-form" onSubmit={async event => { event.preventDefault(); const submitted = draft; if (await todos.add(submitted)) setDraft(current => current === submitted ? '' : current); }}>
          <input aria-label="新待办" placeholder="接下来想做什么？" value={draft} maxLength={500} disabled={!todos.ready} onChange={event => setDraft(event.target.value)} />
          <button type="submit" aria-label="添加待办" disabled={!draft.trim() || !todos.ready || todos.pending}><Icon name="plus" size={18} /></button>
        </form>
        {todos.error && <p className="widget-error" role="alert">{todos.error}</p>}
        <div className="todo-list">{[...pending, ...(showDone ? completed : [])].map(todo => <div key={todo.id} className={`todo-item${todo.done ? ' is-done' : ''}`}>
          <label><input type="checkbox" checked={todo.done} disabled={todos.pending} onChange={() => void todos.toggle(todo.id)} /><span>{todo.text}</span></label>
          <button type="button" aria-label={`删除待办 ${todo.text}`} disabled={todos.pending} onClick={() => void todos.remove(todo.id)}><Icon name="close" size={13} /></button>
        </div>)}</div>
        {!pending.length && !completed.length && todos.ready && <div className="todo-empty"><span><Icon name="check" size={24} /></span><p>还没有待办，从一件小事开始。</p></div>}
        <footer className="todo-footer"><button type="button" className="widget-text-button" onClick={() => setShowDone(value => !value)}>{showDone ? '收起' : '查看'}已完成 · {completed.length}</button><small>保存在本机</small></footer>
        {todos.canUndo && <div className="todo-undo" role="status"><span>已删除待办</span><button type="button" disabled={todos.pending} onClick={() => void todos.undo()}>撤销</button></div>}
      </>}
    </section>}
  </div>;
}
