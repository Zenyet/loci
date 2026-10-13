import { useState } from 'react';
import type { ChromeData, DesktopWidgetId, WidgetSettings as WidgetPreferences } from '../../types';
import { patchWidgets } from '../../services/widgetSettings';
import { defaultWidgetSize, DESKTOP_WIDGETS, placementFromPixels, resolveWidgetLayout, SIZE_LABELS, widgetDimensions, WIDGET_SIZES } from '../../services/widgetLayout';
import { requestWeatherPermission } from '../../services/weather';
import { HOLIDAY_YEARS } from '../../data/holidays';
import { Icon } from '../Icon';
import { SettingNotice, SettingRow, Switch } from '../SettingsControls';
import { CityPicker } from './CityPicker';
import { WIDGET_CATALOG } from './catalog';
import { Select } from '../Select';
import { MarketConnection, MarketWidget } from './MarketWidget';
import { WeatherGlyph } from './WeatherGlyph';
import { NotesWidget, FocusWidget, RevisitWidget } from './LocalWidgets';
import { useNotes } from '../../hooks/useNotes';
import { useTodos } from '../../hooks/useTodos';
import { useFocus } from '../../hooks/useFocus';
import { useClock } from '../../hooks/useClock';
import { useMarket } from '../../hooks/useMarket';
import './widgets.css';
import './desktop-widgets.css';

export function WidgetSettings({ value, data, onChange, onArrange }: { data?: ChromeData; value: WidgetPreferences; onChange: (next: WidgetPreferences) => void; onArrange?: () => void }) {
  const [selected, setSelected] = useState<DesktopWidgetId>('weather');
  const [error, setError] = useState<string | null>(null);
  const [granting, setGranting] = useState(false);
  const catalog = WIDGET_CATALOG[selected];
  const size = value.desktop.layout[selected]?.size ?? defaultWidgetSize(selected);
  const toggle = async (id: DesktopWidgetId, enabled: boolean) => {
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
  return <div className="widget-gallery" data-appearance={value.desktop.appearance}>
    <header className="widget-gallery-heading"><h2>让桌面，更像你。</h2><p>挑选喜欢的小组件，再把它们放到顺手的位置。</p>{onArrange && <button type="button" onClick={onArrange}><Icon name="grip" size={15} />在桌面摆放</button>}</header>
    <SettingRow title="小组件外观"><Select label="小组件外观" value={value.desktop.appearance} options={[{ value: 'auto', label: '跟随系统外观' }, { value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }, { value: 'tinted', label: '染色' }]} onChange={appearance => onChange(patchWidgets(value, { desktop: { appearance: appearance as WidgetPreferences['desktop']['appearance'] } }))} /></SettingRow>
    <div className="widget-gallery-grid" role="group" aria-label="小组件资源库">{DESKTOP_WIDGETS.map(id => <button key={id} type="button" className="widget-gallery-item" aria-label={`配置${WIDGET_CATALOG[id].title}`} aria-pressed={selected === id} onClick={() => setSelected(id)}>
      <div className={`widget-gallery-preview widget-gallery-preview--${id}`} aria-hidden="true">
        {id === 'weather' ? <><span>天气</span><strong>—°</strong><WeatherGlyph code={0} isDay={false} size={34} /><div className="gallery-weather-hours">现在　　1时　　2时　　3时</div></>
          : id === 'calendar' ? <><b>{new Date().getMonth() + 1}月</b><div className="gallery-mini-calendar">{Array.from({ length: 21 }, (_, i) => <span key={i}>{i + 1}</span>)}</div></>
          : id === 'clock' ? <><Icon name="clock" size={35} /><strong className="gallery-clock">{new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</strong></>
          : id === 'focus' ? <><Icon name="focus" size={24} /><strong>25:00</strong></>
          : id === 'notes' ? <><span>备忘与灵感</span><i /><i /><i /></>
          : id === 'todos' ? <><Icon name="todo" size={24} /><i /><i /><i /></>
          : <><Icon name={WIDGET_CATALOG[id].icon} size={28} /><span>{WIDGET_CATALOG[id].title}</span></>}
      </div><span className="widget-gallery-label">{WIDGET_CATALOG[id].title}{value[id].enabled && <Icon name="check" size={13} />}</span>
    </button>)}</div>
    <section className="widget-gallery-detail" aria-label={`${catalog.title}设置`}>
      <header><div><h3>{catalog.title}</h3><p>{catalog.description}</p></div><Switch label={`显示${catalog.title}`} checked={value[selected].enabled} onChange={enabled => void toggle(selected, enabled)} /></header>
      <SettingRow title="小组件尺寸"><div className="widget-segment" role="group" aria-label="小组件尺寸">{WIDGET_SIZES.map(nextSize => <button key={nextSize} type="button" aria-pressed={size === nextSize} onClick={() => {
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        const frame = resolveWidgetLayout(patchWidgets(value, { [selected]: { enabled: true } }), viewport).find(item => item.id === selected)!;
        const dimensions = widgetDimensions(selected, nextSize, viewport.width);
        onChange(patchWidgets(value, { desktop: { layout: { ...value.desktop.layout,
          [selected]: placementFromPixels(frame.left, frame.top, dimensions.width, dimensions.height, viewport, nextSize) } } }));
      }}>{SIZE_LABELS[nextSize]}</button>)}</div></SettingRow>
      {selected === 'clock' && <SettingRow title="12 小时制"><Switch label="12 小时制" checked={value.clock.hour12} onChange={hour12 => onChange(patchWidgets(value, { clock: { hour12 } }))} /></SettingRow>}
      {selected === 'calendar' && <>
        <SettingRow title="农历与传统节日"><Switch label="显示农历与节日" checked={value.calendar.showLunar} onChange={showLunar => onChange(patchWidgets(value, { calendar: { showLunar } }))} /></SettingRow>
        <SettingRow title="放假与调休" hint={`中国大陆 · 已收录 ${Object.keys(HOLIDAY_YEARS).join('、')} 年安排`}><Switch label="显示放假与调休" checked={value.calendar.showHolidays} onChange={showHolidays => onChange(patchWidgets(value, { calendar: { showHolidays } }))} /></SettingRow>
      </>}
      {selected === 'weather' && <>
        {granting && <p className="widget-note">正在申请天气服务权限…</p>}
        {value.weather.enabled && <><CityPicker onSelect={city => onChange(patchWidgets(value, { weather: { city } }))} />
          {value.weather.city && <p className="widget-note">当前城市：{value.weather.city.name} · {value.weather.city.region}</p>}
          <SettingRow title="温度单位"><Select label="温度单位" value={value.weather.unit} options={[{ value: 'celsius', label: '摄氏度 °C' }, { value: 'fahrenheit', label: '华氏度 °F' }]} onChange={unit => onChange(patchWidgets(value, { weather: { unit: unit as 'celsius' | 'fahrenheit' } }))} /></SettingRow>
          <p className="widget-note">天气与逐小时预报来自 <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a>（CC BY 4.0）；定位仅在点击“使用当前位置”时进行。</p></>}
      </>}
      {selected === 'market' && <><MarketConnection value={value.market} onChange={market => onChange(patchWidgets(value, { market }))} /><SettingRow title="涨跌颜色"><Select label="涨跌颜色" value={value.market.colors} onChange={colors => onChange(patchWidgets(value, { market: { colors: colors as typeof value.market.colors } }))} options={[{ value: 'red-up', label: '红涨绿跌' }, { value: 'green-up', label: '绿涨红跌' }, { value: 'mono', label: '单色' }]} /></SettingRow></>}
      {selected === 'market' && value.market.token && <MarketPreferences value={value} onChange={onChange} />}
      {(selected === 'notes' || selected === 'focus' || selected === 'revisit') && <LocalWidgetPreferences selected={selected} value={value} data={data} onChange={onChange} />}
      {selected === 'todos' && <p className="widget-note">直接在桌面卡片内添加或完成待办，多个新标签页共享本机数据。</p>}
    </section>
    {error && <SettingNotice tone="error" role="alert">{error}</SettingNotice>}
    <p className="widget-gallery-footer">从右上角进入编辑模式，自由拖动与调整大小。移除小组件会保留它的本机数据。</p>
  </div>;
}

function MarketPreferences({ value, onChange }: { value: WidgetPreferences; onChange: (next: WidgetPreferences) => void }) {
  const market = useMarket(value.market);
  const now = useClock();
  return market.permission ? <MarketWidget config={value.market} market={market} now={now} onChange={next => onChange(patchWidgets(value, { market: next }))} /> : null;
}

function LocalWidgetPreferences({ selected, value, data, onChange }: { selected: 'notes' | 'focus' | 'revisit'; value: WidgetPreferences; data?: ChromeData; onChange: (next: WidgetPreferences) => void }) {
  const notes = useNotes();
  const todos = useTodos();
  const focus = useFocus();
  const now = useClock();
  if (selected === 'notes') return <NotesWidget notes={notes} todos={todos} />;
  if (selected === 'focus') return <FocusWidget focus={focus} todos={todos} minutes={value.focus.minutes} onMinutes={minutes => onChange(patchWidgets(value, { focus: { minutes } }))} />;
  return <RevisitWidget config={value.revisit} data={data} now={now} onChange={folderId => onChange(patchWidgets(value, { revisit: { folderId } }))} />;
}
