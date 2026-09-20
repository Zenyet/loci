import { useState } from 'react';
import type { WidgetId, WidgetSettings as WidgetPreferences } from '../../types';
import { patchWidgets, widgetCardOrder } from '../../services/widgetSettings';
import { requestWeatherPermission } from '../../services/weather';
import { HOLIDAY_YEARS } from '../../data/holidays';
import { Icon } from '../Icon';
import { PreferenceIcon } from '../PreferenceIcon';
import { SettingGroup, SettingRow, Switch } from '../SettingsControls';
import { CityPicker } from './CityPicker';
import './widgets.css';

const labels = { clock: '时间与天气', todos: '今日待办' };
const descriptions = { clock: '时间、日期和窗外的天气，收在一张小卡片里', todos: '记下接下来要做的几件小事' };

export function WidgetSettings({ value, onChange }: { value: WidgetPreferences; onChange: (next: WidgetPreferences) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [granting, setGranting] = useState(false);
  const cards = widgetCardOrder(value);
  const toggle = async (id: WidgetId, enabled: boolean) => {
    setError(null);
    if (id === 'weather' && enabled) {
      if (granting) return;
      setGranting(true);
      try { if (!await requestWeatherPermission()) { setError('尚未允许连接天气服务，可以再次开启天气重试。'); return; } }
      catch { setError('无法获取天气服务权限，请重试。'); return; }
      finally { setGranting(false); }
    }
    onChange(patchWidgets(value, { [id]: { enabled } }));
  };
  const reorder = (id: Exclude<WidgetId, 'weather'>, direction: number) => {
    const order = [...cards]; const index = order.indexOf(id); const next = index + direction;
    if (next < 0 || next >= order.length) return;
    [order[index], order[next]] = [order[next], order[index]];
    onChange(patchWidgets(value, { order: order.flatMap<WidgetId>(item => item === 'clock' ? ['clock', 'weather'] : [item]) }));
  };
  return <div className="widget-preferences">
    <header className="widget-preferences__heading"><PreferenceIcon name="widgets" /><div><h2>给日常，添一点便利</h2><p>天气、时间，还有今天想完成的事。</p></div></header>
    <p className="widget-note">时间与天气共用一张卡片，可分别开启；日期始终保留。用箭头调整卡片顺序。</p>
    {error && <p role="alert" className="widget-error">{error}</p>}
    {cards.map((id, index) => <section className="widget-option" key={id} aria-label={`${labels[id]}设置`}>
      <div className="widget-option__head"><span className={`widget-option__icon widget-option__icon--${id}`}><Icon name={id === 'todos' ? 'todo' : id} size={21} /></span><div><h3>{labels[id]}</h3><p>{descriptions[id]}</p></div>{id === 'todos' && <Switch label="显示今日待办" checked={value.todos.enabled} onChange={enabled => void toggle(id, enabled)} />}</div>
      {id === 'clock' && <SettingRow title="显示时间"><Switch label="显示时间" checked={value.clock.enabled} onChange={enabled => void toggle('clock', enabled)} /></SettingRow>}
      {id === 'clock' && value.clock.enabled && <SettingRow title="12 小时制"><Switch label="12 小时制" checked={value.clock.hour12} onChange={hour12 => onChange(patchWidgets(value, { clock: { hour12 } }))} /></SettingRow>}
      {id === 'clock' && <>
        <SettingRow title="显示农历与节日" hint="点击卡片的时间区域打开日历"><Switch label="显示农历与节日" checked={value.calendar.showLunar} onChange={showLunar => onChange(patchWidgets(value, { calendar: { showLunar } }))} /></SettingRow>
        <SettingRow title="显示放假与调休" hint={`中国大陆 · 已收录 ${Object.keys(HOLIDAY_YEARS).join('、')} 年安排`}><Switch label="显示放假与调休" checked={value.calendar.showHolidays} onChange={showHolidays => onChange(patchWidgets(value, { calendar: { showHolidays } }))} /></SettingRow>
      </>}
      {id === 'clock' && <SettingRow title="显示天气" hint={granting ? '正在申请天气服务权限…' : undefined}><Switch label="显示天气" checked={value.weather.enabled} onChange={enabled => void toggle('weather', enabled)} /></SettingRow>}
      {id === 'clock' && value.weather.enabled && <div className="widget-option__body">
        {value.weather.city && <div className="widget-city-current"><span>当前城市<strong>{value.weather.city.name}</strong></span><small>{value.weather.city.region} · {value.weather.city.country}</small></div>}
        <CityPicker onSelect={city => onChange(patchWidgets(value, { weather: { city } }))} />
        <SettingRow title="温度单位"><div className="widget-segment" role="group" aria-label="温度单位">{(['celsius', 'fahrenheit'] as const).map(unit => <button type="button" key={unit} aria-pressed={unit === value.weather.unit} onClick={() => onChange(patchWidgets(value, { weather: { unit } }))}>{unit === 'celsius' ? '°C' : '°F'}</button>)}</div></SettingRow>
        <p className="widget-note">查询城市与天气时会连接 Open-Meteo，发送城市关键词或所选城市坐标。</p>
      </div>}
      {id === 'todos' && value.todos.enabled && <p className="widget-option__body widget-note">待办保存在本机，可在多个新标签页之间同步。</p>}
      <footer className="widget-option__footer"><span>{index + 1} / {cards.length}</span><button type="button" disabled={index === 0} aria-label={`上移${labels[id]}`} onClick={() => reorder(id, -1)}>↑</button><button type="button" disabled={index === cards.length - 1} aria-label={`下移${labels[id]}`} onClick={() => reorder(id, 1)}>↓</button></footer>
    </section>)}
    <SettingGroup title="恰到好处"><p className="widget-note widget-option__body">信息收在页面边缘，需要时再展开。关闭小组件会保留它的设置与本地数据。</p></SettingGroup>
  </div>;
}
