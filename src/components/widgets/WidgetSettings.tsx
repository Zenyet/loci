import { useState } from 'react';
import type { WidgetId, WidgetToolId, WidgetSettings as WidgetPreferences } from '../../types';
import { patchWidgets, widgetCardOrder } from '../../services/widgetSettings';
import { requestWeatherPermission } from '../../services/weather';
import { HOLIDAY_YEARS } from '../../data/holidays';
import { Icon } from '../Icon';
import { SettingGroup, SettingRow, Switch } from '../SettingsControls';
import { CityPicker } from './CityPicker';
import { WIDGET_CATALOG } from './catalog';
import { Select } from '../Select';
import { MarketConnection } from './MarketWidget';
import './widgets.css';

const labels = Object.fromEntries(Object.entries(WIDGET_CATALOG).map(([id, item]) => [id, item.title]));

export function WidgetSettings({ value, onChange }: { value: WidgetPreferences; onChange: (next: WidgetPreferences) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [granting, setGranting] = useState(false);
  const cards = widgetCardOrder(value);
  const visibleCards = cards.filter(id => id === 'clock' || id === 'todos' || value[id].enabled);
  const toggle = async (id: WidgetId, enabled: boolean) => {
    setError(null);
    if (id === 'weather' && enabled) {
      if (granting) return;
      setGranting(true);
      try { if (!await requestWeatherPermission()) { setError('尚未允许连接天气服务，可以再次开启天气重试。'); return; } }
      catch { setError('无法获取天气服务权限，请重试。'); return; }
      finally { setGranting(false); }
    }
    const pinned = id !== 'clock' && id !== 'weather' && enabled ? [...new Set([...value.pinned.filter(item => value[item].enabled), id])].slice(0, 3) as WidgetToolId[] : value.pinned;
    onChange(patchWidgets(value, { [id]: { enabled }, pinned }));
  };
  const reorder = (id: Exclude<WidgetId, 'weather'>, direction: number) => {
    const order = [...cards]; const index = visibleCards.indexOf(id); const next = index + direction;
    if (next < 0 || next >= visibleCards.length) return;
    const from = order.indexOf(id); const to = order.indexOf(visibleCards[next]);
    [order[from], order[to]] = [order[to], order[from]];
    onChange(patchWidgets(value, { order: order.flatMap<WidgetId>(item => item === 'clock' ? ['clock', 'weather'] : [item]) }));
  };
  return <div className="widget-preferences">
    <div className="widget-library-heading"><h2>给日常，添一点顺手</h2><p className="widget-note">按需添加，关闭时保留数据。首页最多固定 3 个工具，其余收进「更多」。</p></div>
    <div className="widget-catalog" aria-label="添加新小组件">{(['market', 'notes', 'focus', 'revisit'] as const).map(id => <article className="widget-catalog-card" key={id}>
      <div><Icon name={WIDGET_CATALOG[id].icon} size={23} /><small>{WIDGET_CATALOG[id].category}</small></div><h3>{labels[id]}</h3><p>{WIDGET_CATALOG[id].description}</p>
      <button type="button" className="widget-catalog-add" disabled={value[id].enabled} onClick={() => void toggle(id, true)}>{value[id].enabled ? '已添加' : '＋ 添加'}</button>
    </article>)}</div>
    <p className="widget-note">时间与天气共用一张卡片，日期始终保留。用箭头调整组件顺序。</p>
    {error && <p role="alert" className="widget-error">{error}</p>}
    {visibleCards.map((id, index) => { return <section className="widget-option" key={id} aria-label={`${labels[id]}设置`}>
      <div className="widget-option__head"><span className={`widget-option__icon widget-option__icon--${id}`}><Icon name={WIDGET_CATALOG[id].icon} size={21} /></span><div><h3>{labels[id]}</h3><p>{WIDGET_CATALOG[id].description}</p></div>{id !== 'clock' && <Switch label={`显示${labels[id]}`} checked={value[id].enabled} onChange={enabled => void toggle(id, enabled)} />}</div>
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
      {id !== 'clock' && value[id].enabled && <SettingRow title="固定到首页" hint="窄屏仅显示第一个固定工具，其余可在更多中打开"><Switch label={`将${labels[id]}固定到首页`} checked={value.pinned.includes(id)} onChange={pinned => {
        if (pinned && value.pinned.filter(item => value[item].enabled).length >= 3) { setError('首页最多固定 3 个工具，请先取消其他工具的固定。'); return; }
        setError(null); onChange(patchWidgets(value, { pinned: pinned ? [...value.pinned.filter(item => value[item].enabled), id] : value.pinned.filter(item => item !== id) }));
      }} /></SettingRow>}
      {id === 'market' && <div className="widget-option__body"><MarketConnection value={value.market} onChange={market => onChange(patchWidgets(value, { market }))} /><SettingRow title="涨跌颜色"><Select label="涨跌颜色" value={value.market.colors} onChange={colors => onChange(patchWidgets(value, { market: { colors: colors as typeof value.market.colors } }))} options={[{ value: 'red-up', label: '红涨绿跌' }, { value: 'green-up', label: '绿涨红跌' }, { value: 'mono', label: '单色' }]} /></SettingRow></div>}
      {id === 'notes' && <p className="widget-option__body widget-note">自动保存到本机，可复制内容或把一行转为待办。</p>}
      {id === 'focus' && <p className="widget-option__body widget-note">当前专注时长 {value.focus.minutes} 分钟。可在组件内调整时长、关联待办，刷新后恢复计时。</p>}
      {id === 'revisit' && <p className="widget-option__body widget-note">打开组件选择回访文件夹，每天发现一条收藏。</p>}
      <footer className="widget-option__footer"><span>{index + 1} / {visibleCards.length}</span><button type="button" disabled={index === 0} aria-label={`上移${labels[id]}`} onClick={() => reorder(id, -1)}>↑</button><button type="button" disabled={index === visibleCards.length - 1} aria-label={`下移${labels[id]}`} onClick={() => reorder(id, 1)}>↓</button></footer>
    </section>; })}
    <SettingGroup title="恰到好处"><p className="widget-note widget-option__body">信息收在页面边缘，需要时再展开。关闭小组件会保留它的设置与本地数据。</p></SettingGroup>
  </div>;
}
