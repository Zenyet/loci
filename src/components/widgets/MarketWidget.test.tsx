import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MarketWidget } from './MarketWidget';
import { DEFAULT_SETTINGS, type WidgetSettings } from '../../types';
import { patchWidgets, MARKET_INDICES } from '../../services/widgetSettings';
import { parseMarketQuotes } from '../../services/market';

let container: HTMLDivElement, root: Root;
let config: WidgetSettings['market'];
const quotes = parseMarketQuotes({ fields: ['ts_code', 'name', 'close', 'pre_close'], items: MARKET_INDICES.map(item => [item.code, item.name, 100, 99]) }, MARKET_INDICES);
function Harness({ date = '2026-09-22' }: { date?: string }) {
  const [value, setValue] = useState(config); config = value;
  return <section role="dialog"><MarketWidget config={value} now={new Date('2026-09-22T02:00:00Z')} onChange={next => setValue(current => ({ ...current, ...next }))} market={{ data: { quotes, errors: {}, tradingDate: date, isTradingDay: true }, error: null, permission: true, loading: false, refresh: () => {}, recheck: () => {} }} /></section>;
}
beforeEach(async () => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); config = patchWidgets(DEFAULT_SETTINGS.widgets, { market: { enabled: true, token: 'test-only' } }).market; container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function click(label: string) { const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.getAttribute('aria-label') === label || b.textContent === label); expect(button).toBeTruthy(); await act(async () => button!.click()); }
async function input(value: string) { const element = container.querySelector<HTMLInputElement>('[aria-label="六位股票代码"]')!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); }); }
it('validates exchange-specific codes, prevents duplicate watch entries and supports remove/undo', async () => {
  await act(async () => root.render(<Harness />)); await click('我的自选');
  await input('000001'); await click('添加'); expect(container.textContent).toContain('所选交易所'); expect(config.watchlist).toHaveLength(0);
  const trigger = container.querySelector('[aria-label="股票交易所"]')!;
  for (const key of ['ArrowDown', 'End', 'Enter']) await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
  await click('添加'); expect(config.watchlist[0].code).toBe('000001.SZ'); expect(container.querySelector('.market-price')!.textContent).toBe('—');
  await input('000001'); await click('添加'); expect(container.textContent).toContain('已在自选'); expect(config.watchlist).toHaveLength(1);
  await click('移除000001.SZ'); expect(config.watchlist).toHaveLength(0); await click('撤销'); expect(config.watchlist).toHaveLength(1);
  await click('设为首页关注项'); expect(config.summary).toBe('stock:000001.SZ');
});
it('does not infer today’s trading state from yesterday’s calendar or manufacture a quote timestamp', async () => {
  await act(async () => root.render(<Harness date="2026-09-21" />));
  expect(container.textContent).toContain('交易状态待确认'); expect(container.textContent).toContain('数据源尚未提供完整行情时间');
  expect(container.querySelectorAll('.market-indices .market-quote-button')).toHaveLength(3);
});
