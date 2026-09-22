import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChromeData, WidgetSettings, WidgetToolId } from '../../types';
import { useClock } from '../../hooks/useClock';
import { useTodos } from '../../hooks/useTodos';
import { useMarket } from '../../hooks/useMarket';
import { useNotes } from '../../hooks/useNotes';
import { useFocus } from '../../hooks/useFocus';
import { focusLabel } from '../../services/focus';
import { marketNumber, marketPercent } from '../../services/market';
import { MarketWidget, quoteTone } from './MarketWidget';
import { NotesWidget, FocusWidget, RevisitWidget } from './LocalWidgets';
import { WIDGET_CATALOG } from './catalog';
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
  chromeData?: ChromeData;
  onChange: (next: WidgetSettings) => void;
  onConfigure: () => void;
  onPanelChange: (open: boolean) => void;
  blocked: boolean;
}

export function WidgetDashboard({ settings, chromeData, onChange, onConfigure, onPanelChange, blocked }: Props) {
  const now = useClock();
  const weather = useWeather(settings.weather);
  const todos = useTodos();
  const notes = useNotes();
  const focus = useFocus();
  const market = useMarket(settings.market);
  const [open, setOpen] = useState<'calendar' | 'weather' | 'more' | WidgetToolId | null>(null);
  const [choosingCity, setChoosingCity] = useState(false);
  const [draft, setDraft] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const moreTrigger = useRef<HTMLButtonElement>(null);
  const bar = useRef<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = useState(() => window.innerWidth <= 900);
  const [position, setPosition] = useState({ top: 112, left: 28, maxHeight: 'calc(100dvh - 140px)' });
  const toolOrder = widgetCardOrder(settings).filter((id): id is WidgetToolId => id !== 'clock' && settings[id].enabled);
  const pinned = toolOrder.filter(id => settings.pinned.includes(id)).slice(0, narrow ? 1 : 3);
  const overflow = toolOrder.filter(id => !pinned.includes(id));
  const marketSummary = market.data?.quotes.find(quote => quote.id === settings.market.summary);
  useEffect(() => { const resize = () => setNarrow(window.innerWidth <= 900); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const bounds = bar.current?.getBoundingClientRect();
      const anchor = trigger.current?.getBoundingClientRect();
      const width = panel.current?.getBoundingClientRect().width || 370;
      const top = Math.max(16, Math.min((bounds?.bottom || 100) + 12, window.innerHeight - 180));
      setPosition({ top, left: Math.max(16, Math.min(anchor?.left || 28, window.innerWidth - width - 16)), maxHeight: `${Math.max(140, window.innerHeight - top - 16)}px` });
    };
    place(); window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, narrow, pinned.length]);
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
    if (open && open !== 'calendar' && open !== 'more' && !settings[open].enabled) setOpen(null);
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

  const renderTool = (id: WidgetToolId, insideMore = false) => {
    const catalog = WIDGET_CATALOG[id];
    return <button key={id} type="button" className={insideMore ? 'widget-more-item' : 'widget-summary'} data-market-colors={id === 'market' ? settings.market.colors : undefined}
      aria-label={`查看${catalog.title}`} aria-expanded={open === id} aria-controls={open === id ? 'daily-widget-panel' : undefined} aria-haspopup="dialog" onClick={event => {
        trigger.current = insideMore ? moreTrigger.current : event.currentTarget;
        setChoosingCity(false); setOpen(current => current === id ? null : id);
      }}>
      <Icon name={catalog.icon} size={18} />
      {id === 'todos' ? <><span className="widget-todo-summary">{pending[0]?.text ?? '今日待办'}</span><strong className="widget-count">{pending.length}</strong></>
        : id === 'notes' ? <span className="widget-todo-summary">{notes.text.split('\n').find(line => line.trim()) || '便签'}</span>
        : id === 'focus' ? <><span>专注</span><strong>{focusLabel(focus.value, focus.now)}</strong></>
        : id === 'market' ? <><span className="widget-todo-summary">{marketSummary?.name || '市场速览'}</span>{marketSummary ? <><strong>{marketNumber(marketSummary.price)}</strong><span className={quoteTone(marketSummary)}>{marketPercent(marketSummary)}</span>{(market.error || market.data?.errors[marketSummary.id]) && <span className="widget-stale-dot" title="行情待更新" />}</> : <small>{!settings.market.token ? '未连接' : market.loading ? '更新中' : '待更新'}</small>}</>
        : <span>{catalog.title}</span>}
      {insideMore && <Icon name="arrow" size={13} />}
    </button>;
  };
  return <div className="widget-shell" ref={root} onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape' && open) { event.preventDefault(); close(true); }
  }} onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) close();
  }}>
    <div className="widget-bar" aria-label="日常小组件" ref={element => { bar.current = element; if (element) element.inert = blocked; }}>
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
        return pinned.includes(id) ? renderTool(id) : null;
      })}
      {overflow.length > 0 && <button ref={moreTrigger} type="button" className="widget-summary" aria-label="更多小组件" aria-expanded={open === 'more'} aria-haspopup="dialog" onClick={event => { trigger.current = event.currentTarget; setOpen(value => value === 'more' ? null : 'more'); }}><Icon name="more" size={18} /><span>更多</span><strong className="widget-count">{overflow.length}</strong></button>}
    </div>
    <button type="button" className="widget-add" aria-label="添加小组件" title="添加小组件" disabled={blocked} onClick={onConfigure}><Icon name="widgets" size={18} /></button>

    {open && !blocked && <section ref={panel} tabIndex={-1} className={`widget-panel widget-panel--${open}`} style={position} id="daily-widget-panel" role="dialog" aria-label={open === 'calendar' ? '日历' : open === 'weather' ? '天气详情' : open === 'more' ? '更多小组件' : WIDGET_CATALOG[open].title}>
      <header className="widget-panel__header"><span className="widget-eyebrow">{open === 'calendar' ? '日历 · 中国大陆' : open === 'weather' ? '窗外的天气' : open === 'more' ? '需要时，再展开' : WIDGET_CATALOG[open].title}</span><CloseButton label="关闭小组件" onClick={() => close(true)} /></header>
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
      </> : open === 'todos' ? <>
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
      </> : open === 'market' ? <MarketWidget config={settings.market} market={market} now={now} onChange={next => onChange(patchWidgets(settings, { market: next }))} />
      : open === 'notes' ? <NotesWidget notes={notes} todos={todos} />
      : open === 'focus' ? <FocusWidget focus={focus} todos={todos} minutes={settings.focus.minutes} onMinutes={minutes => onChange(patchWidgets(settings, { focus: { minutes } }))} />
      : open === 'revisit' ? <RevisitWidget config={settings.revisit} data={chromeData} now={now} onChange={folderId => onChange(patchWidgets(settings, { revisit: { folderId } }))} />
      : <div className="widget-more-list">{overflow.map(id => renderTool(id, true))}<button type="button" className="widget-text-button" onClick={onConfigure}>管理小组件</button></div>}
    </section>}
  </div>;
}
