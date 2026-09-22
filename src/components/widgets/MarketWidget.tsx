import { useEffect, useState } from 'react';
import type { MarketInstrument, WidgetSettings } from '../../types';
import type { useMarket } from '../../hooks/useMarket';
import { instrumentId, MARKET_INDICES, validStockCode } from '../../services/widgetSettings';
import { marketNumber, marketPercent, marketPhase, quoteChange, requestMarketPermission, shanghaiTime, type MarketQuote } from '../../services/market';
import { Select } from '../Select';
import { TextInput } from '../TextInput';
import { Icon } from '../Icon';

type Config = WidgetSettings['market'];
export function MarketConnection({ value, onChange, onConnected }: { value: Config; onChange: (patch: Partial<Config>) => void; onConnected?: () => void }) {
  const [token, setToken] = useState(value.token);
  const [connecting, setConnecting] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => setToken(value.token), [value.token]);
  return <form className="market-connection" onSubmit={async event => {
    event.preventDefault();
    if (!token.trim() || connecting) return;
    setConnecting(true); setMessage('');
    try {
      if (!await requestMarketPermission()) { setMessage('未获得行情连接权限，可以再次尝试。'); return; }
      onChange({ token: token.trim() }); onConnected?.(); setMessage('已保存连接信息，报价将按接口权限加载。');
    } catch { setMessage('无法获取连接权限，请重试。'); }
    finally { setConnecting(false); }
  }}>
    <p className="widget-note">使用自己的 Tushare Token 连接指数和个股快照；这两类实时接口需要分别开通权限。Token 仅保存在本机，请求时发送给 Tushare。</p>
    <TextInput type="password" aria-label="Tushare Token" value={token} onChange={setToken} placeholder="填写 Tushare Token" autoComplete="off" maxLength={512} disabled={connecting} />
    <div className="widget-actions"><button type="submit" className="widget-primary" disabled={!token.trim() || connecting}>{connecting ? '正在连接…' : '保存并连接'}</button>{value.token && <button type="button" className="widget-text-button" disabled={connecting} onClick={() => { onChange({ token: '' }); setMessage('已断开行情连接。'); }}>断开连接</button>}</div>
    {message && <p className="widget-note" role="status">{message}</p>}
    <a className="widget-source-link" href="https://tushare.pro/document/1?doc_id=108" target="_blank" rel="noreferrer">查看 Tushare 权限说明 ↗</a>
  </form>;
}
export function MarketWidget({ config, market, onChange, now }: {
  config: Config; market: ReturnType<typeof useMarket>; onChange: (patch: Partial<Config>) => void; now: Date;
}) {
  const [tab, setTab] = useState<'indices' | 'watchlist'>('indices');
  const [selected, setSelected] = useState(config.summary);
  const [code, setCode] = useState('');
  const [exchange, setExchange] = useState('SH');
  const [error, setError] = useState('');
  const [removed, setRemoved] = useState<{ item: MarketInstrument; index: number } | null>(null);
  const instruments = tab === 'indices' ? MARKET_INDICES : config.watchlist;
  const item = instruments.find(i => instrumentId(i) === selected) ?? instruments[0];
  const quote = market.data?.quotes.find(q => q.id === (item && instrumentId(item)));
  const unavailable = item ? market.data?.errors[instrumentId(item)] : undefined;
  const change = quoteChange(quote);
  useEffect(() => { if (!removed) return; const timer = setTimeout(() => setRemoved(null), 10_000); return () => clearTimeout(timer); }, [removed]);
  if (!config.token || !market.permission) return <div className="market-widget"><h2>连接你关心的市场</h2><MarketConnection value={config} onChange={onChange} onConnected={market.recheck} /></div>;
  const chooseTab = (next: typeof tab) => { setTab(next); setError(''); };
  return <div className="market-widget" data-market-colors={config.colors}>
    <div className="market-toolbar"><div className="widget-segment" role="group" aria-label="行情视图"><button type="button" aria-pressed={tab === 'indices'} onClick={() => chooseTab('indices')}>A 股大盘</button><button type="button" aria-pressed={tab === 'watchlist'} onClick={() => chooseTab('watchlist')}>我的自选</button></div><span className="widget-note">{marketPhase(market.data?.tradingDate === shanghaiTime(now).date ? market.data.isTradingDay : null, now)}</span></div>
    <div className={tab === 'indices' ? 'market-indices' : 'market-watchlist'} aria-label={tab === 'indices' ? '指数列表' : '自选列表'}>
      {instruments.map((instrument, index) => {
        const id = instrumentId(instrument);
        const data = market.data?.quotes.find(q => q.id === id);
        const issue = market.data?.errors[id];
        return <div key={id} className="market-instrument">
          <button type="button" className="market-quote-button" aria-pressed={item && instrumentId(item) === id} onClick={() => setSelected(id)}>
            <span>{data?.name || instrument.name || instrument.code}</span><small className="market-code">{instrument.code}</small>
            <strong>{marketNumber(data?.price)}</strong><span className={quoteTone(data)}>{marketPercent(data)}{issue && <small> · 待更新</small>}</span>
          </button>
          {tab === 'watchlist' && <div className="market-row-actions"><button type="button" aria-label={`上移${instrument.code}`} disabled={index === 0} onClick={() => {
            const list = [...config.watchlist]; [list[index - 1], list[index]] = [list[index], list[index - 1]]; onChange({ watchlist: list });
          }}>↑</button><button type="button" aria-label={`下移${instrument.code}`} disabled={index === config.watchlist.length - 1} onClick={() => {
            const list = [...config.watchlist]; [list[index + 1], list[index]] = [list[index], list[index + 1]]; onChange({ watchlist: list });
          }}>↓</button><button type="button" aria-label={`移除${instrument.code}`} onClick={() => { setRemoved({ item: instrument, index }); onChange({ watchlist: config.watchlist.filter(i => instrumentId(i) !== id) }); }}><Icon name="trash" size={13} /></button></div>}
        </div>;
      })}
    </div>
    {tab === 'watchlist' && <>
      {!instruments.length && <p className="widget-empty">还没有自选，从自己关心的一只股票开始。</p>}
      <form className="market-add-form" onSubmit={event => {
        event.preventDefault(); const symbol = `${code.trim()}.${exchange}`;
        if (!validStockCode(symbol)) { setError('请输入所选交易所的 6 位沪深 A 股代码。'); return; }
        if (config.watchlist.some(stock => stock.code === symbol)) { setError('这只股票已在自选中。'); return; }
        if (config.watchlist.length >= 10) { setError('最多关注 10 只股票。'); return; }
        onChange({ watchlist: [...config.watchlist, { code: symbol, kind: 'stock', name: symbol }] }); setSelected(`stock:${symbol}`); setCode(''); setError('');
      }}>
        <TextInput aria-label="六位股票代码" value={code} onChange={setCode} placeholder="股票代码，如 600036" inputMode="numeric" maxLength={6} disabled={config.watchlist.length >= 10} />
        <Select label="股票交易所" value={exchange} onChange={setExchange} options={[{ value: 'SH', label: '沪市' }, { value: 'SZ', label: '深市' }]} />
        <button type="submit" className="widget-primary" disabled={code.trim().length !== 6 || config.watchlist.length >= 10}>添加</button>
      </form>
      {error && <p className="widget-error" role="alert">{error}</p>}
      {removed && <div className="todo-undo" role="status"><span>已移除 {removed.item.name}</span><button type="button" disabled={config.watchlist.length >= 10} onClick={() => {
        if (!config.watchlist.some(item => item.code === removed.item.code)) { const list = [...config.watchlist]; list.splice(removed.index, 0, removed.item); onChange({ watchlist: list }); }
        setRemoved(null);
      }}>撤销</button></div>}
    </>}
    {item && <section className="market-detail" aria-label="选定标的详情">
      <div className="market-detail__heading"><div><h2>{quote?.name || item.name}</h2><small>{item.code} · {item.kind === 'index' ? '指数点' : '人民币元'}</small></div><button type="button" className="widget-text-button" disabled={config.summary === instrumentId(item)} onClick={() => onChange({ summary: instrumentId(item) })}>{config.summary === instrumentId(item) ? '首页关注项' : '设为首页关注项'}</button></div>
      <div className="market-price">{marketNumber(quote?.price)}</div><p className={quoteTone(quote)}>{change ? `${change.amount > 0 ? '+' : ''}${marketNumber(change.amount)} · ${marketPercent(quote)}` : '涨跌数据待更新'}</p>
      <div className="market-stats"><span>昨收<strong>{marketNumber(quote?.previous)}</strong></span><span>今开<strong>{marketNumber(quote?.open)}</strong></span><span>最高<strong>{marketNumber(quote?.high)}</strong></span><span>最低<strong>{marketNumber(quote?.low)}</strong></span></div>
      {unavailable && <p className="widget-error" role="status">{quote ? '上次记录 · ' : ''}{unavailable}</p>}
      <p className="widget-note">{quote?.quoteTime ? `行情时间 ${new Date(quote.quoteTime).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}（北京时间）` : '数据源尚未提供完整行情时间'} · 时效未确认</p>
    </section>}
    {market.error && <p className="widget-error" role="alert">{market.error}</p>}
    <footer className="weather-footer"><a className="widget-source-link" href="https://tushare.pro/" target="_blank" rel="noreferrer">数据源 Tushare</a><button type="button" disabled={market.loading} onClick={market.refresh}>{market.loading ? '更新中…' : '刷新行情'}</button></footer>
    <p className="widget-note">展示行情快照，暂不提供分时。交易日历不可用时降低刷新频率，可手动更新。</p>
  </div>;
}
export function quoteTone(quote: MarketQuote | undefined) {
  const change = quoteChange(quote);
  return change ? change.amount > 0 ? 'market-up' : change.amount < 0 ? 'market-down' : '' : '';
}
