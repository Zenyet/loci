import { useState } from 'react';
import type { ChromeData, WidgetSettings, DesktopWidgetId } from '../../types';
import { useClock } from '../../hooks/useClock';
import { useTodos } from '../../hooks/useTodos';
import { useMarket } from '../../hooks/useMarket';
import { useNotes } from '../../hooks/useNotes';
import { useFocus } from '../../hooks/useFocus';
import { marketNumber, marketPercent } from '../../services/market';
import { quoteTone } from './MarketWidget';
import { NotesWidget, FocusWidget, RevisitWidget } from './LocalWidgets';
import { useWeather } from '../../hooks/useWeather';
import { patchWidgets } from '../../services/widgetSettings';
import { displayTemperature, upcomingWeatherHours, weatherDescription, WEATHER_FRESH_MS, WEATHER_OLD_MS } from '../../services/weather';
import { WeatherGlyph } from './WeatherGlyph';
import { Icon } from '../Icon';
import { TextInput } from '../TextInput';
import { DesktopWidgets } from './DesktopWidgets';
import './widgets.css';

interface Props {
  editRequest?: number;
  settings: WidgetSettings;
  chromeData?: ChromeData;
  onChange: (next: WidgetSettings) => void;
  onConfigure: () => void;
  onEditingChange: (open: boolean) => void;
  blocked: boolean;
}

export function WidgetDashboard({ editRequest, settings, chromeData, onChange, onConfigure, onEditingChange, blocked }: Props) {
  const now = useClock();
  const weather = useWeather(settings.weather);
  const todos = useTodos();
  const notes = useNotes();
  const focus = useFocus();
  const market = useMarket(settings.market);
  const [draft, setDraft] = useState('');
  const [showDone, setShowDone] = useState(false);
  const pending = todos.todos.filter(todo => !todo.done);
  const completed = todos.todos.filter(todo => todo.done);
  const data = weather.data;
  const age = data ? now.getTime() - data.fetchedAt : 0;
  const old = age > WEATHER_OLD_MS;
  const stale = age >= WEATHER_FRESH_MS;
  const city = settings.weather.city;
  const hours = data && !old ? upcomingWeatherHours(data, now) : [];
  const renderTile = (id: DesktopWidgetId) => {
    if (id === 'weather') return <div className="weather-tile" data-night={data?.isDay === false || undefined} data-code={data?.code ?? 'empty'}>
      <div className="weather-tile__current"><div><span className="weather-tile__city">{city?.name ?? '天气'}{city?.id && city.id < 0 ? <Icon name="location" size={12} /> : null}</span><strong>{data && !old ? displayTemperature(data.temperature) : '—'}</strong></div>
        <div className="weather-tile__condition"><WeatherGlyph code={data?.code ?? null} isDay={data?.isDay} size={34} /><span>{!weather.permission ? '在设置中连接天气' : !city ? '在设置中选择城市' : old ? '天气待更新' : data ? weatherDescription(data.code) : weather.loading ? '正在更新' : '天气暂不可用'}</span><small>最高 {displayTemperature(data?.days[0]?.high)} · 最低 {displayTemperature(data?.days[0]?.low)}</small></div></div>
      {hours.length ? <div className="weather-tile__hours" aria-label="逐小时预报">{hours.map((hour, index) => <div key={hour.time}><time>{index === 0 ? '现在' : `${Number(hour.time.slice(11, 13))}时`}</time><WeatherGlyph code={hour.code} isDay={hour.isDay} size={27} /><strong>{displayTemperature(hour.temperature)}</strong></div>)}</div>
        : <p className="weather-tile__message">{weather.error ?? (!city ? '把窗外的天气，放在桌面上。' : data ? '逐小时预报等待更新' : '当前天气与逐小时预报')}</p>}
      <span className="tile-footnote">{stale || weather.error ? '数据待更新 · ' : ''}Open-Meteo</span>
    </div>;
    if (id === 'clock') return <div className="clock-tile" data-hour12={settings.clock.hour12 || undefined}><span>{now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</span><strong>{now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: settings.clock.hour12 })}</strong><small>每一刻，都有自己的节奏</small></div>;
    if (id === 'todos') return <div className="tool-tile todos-tile">
      <header><Icon name="todo" size={20} /><span>提醒事项</span><strong>{pending.length}</strong></header>
      <form className="tile-todo-add" onSubmit={async event => { event.preventDefault(); const submitted = draft; if (await todos.add(submitted)) setDraft(current => current === submitted ? '' : current); }}>
        <TextInput aria-label="新待办" placeholder="添加提醒…" value={draft} maxLength={500} disabled={!todos.ready} onChange={setDraft} />
        <button type="submit" aria-label="添加待办" disabled={!draft.trim() || !todos.ready || todos.pending}><Icon name="plus" size={14} /></button>
      </form>
      <div className="tile-todo-scroll">
        <div className="todo-list">{[...pending, ...(showDone ? completed : [])].map(todo => <div key={todo.id} className={`todo-item${todo.done ? ' is-done' : ''}`}>
          <label><input type="checkbox" checked={todo.done} disabled={todos.pending} onChange={() => void todos.toggle(todo.id)} /><span>{todo.text}</span></label>
          <button type="button" aria-label={`删除待办 ${todo.text}`} disabled={todos.pending} onClick={() => void todos.remove(todo.id)}><Icon name="close" size={12} /></button>
        </div>)}</div>
        {!pending.length && !completed.length && todos.ready && <p className="tile-placeholder">还没有待办，记下一件小事。</p>}
        {completed.length > 0 && <button type="button" className="widget-text-button" onClick={() => setShowDone(value => !value)}>{showDone ? '收起' : '查看'}已完成 · {completed.length}</button>}
        {todos.error && <p className="widget-error" role="alert">{todos.error}</p>}
      </div>
      {todos.canUndo && <div className="tile-todo-undo" role="status"><span>已删除待办</span><button type="button" disabled={todos.pending} onClick={() => void todos.undo()}>撤销</button></div>}
    </div>;
    if (id === 'notes') return <div className="tool-tile notes-tile"><header><Icon name="edit" size={18} /><span>便签</span></header><NotesWidget compact notes={notes} todos={todos} /></div>;
    if (id === 'focus') return <div className="tool-tile focus-tile"><header><Icon name="focus" size={20} /><span>{focus.value.mode === 'break' ? '休息一下' : '专注计时'}</span></header><FocusWidget compact focus={focus} todos={todos} minutes={settings.focus.minutes} onMinutes={minutes => onChange(patchWidgets(settings, { focus: { minutes } }))} /></div>;
    if (id === 'market') return <div className="tool-tile market-tile"><header><Icon name="market" size={19} /><span>市场速览</span></header>{market.data?.quotes.length ? market.data.quotes.slice(0, 3).map(quote => <div className="tile-market-row" key={quote.id}><span>{quote.name}</span><strong>{marketNumber(quote.price)}</strong><small className={quoteTone(quote)}>{marketPercent(quote)}</small></div>) : <><strong className="tile-heading">关心的市场<br />一眼可见</strong><span className="tile-footnote">{!settings.market.token ? '在设置中连接 Tushare' : market.loading ? '正在更新行情' : '行情暂不可用'}</span></>}</div>;
    return <div className="tool-tile revisit-tile"><header><Icon name="bookmark" size={18} /><span>收藏回访</span></header><RevisitWidget compact config={settings.revisit} data={chromeData} now={now} onChange={folderId => onChange(patchWidgets(settings, { revisit: { folderId } }))} /></div>;
  };
  return <div className="widget-shell" onKeyDown={event => event.stopPropagation()}>
    <DesktopWidgets editRequest={editRequest} settings={settings} now={now} blocked={blocked} onChange={onChange} onConfigure={onConfigure} onEditing={onEditingChange} render={renderTile} />
  </div>;
}
