import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { DEFAULT_SETTINGS, type ChromeData, type Settings } from './types';
import { GroupingError } from './services/grouping/errors';

const mocks = vi.hoisted(() => ({
  chrome: {} as { data: ChromeData; loading: boolean; error: null; refresh: ReturnType<typeof vi.fn> },
  settings: {} as Settings, update: vi.fn(), group: vi.fn(), apply: vi.fn(), undo: vi.fn(), loadUndo: vi.fn(),
}));
vi.mock('./hooks/useChromeData', () => ({ useChromeData: () => mocks.chrome }));
vi.mock('./hooks/useSettings', () => ({ useSettings: () => ({ settings: mocks.settings, resolvedTheme: 'light', ready: true, update: mocks.update }) }));
vi.mock('./designs/Graph/Graph', () => ({ Graph: () => <div>Graph</div> }));
vi.mock('./services/ai/grouping', () => ({ makeGrouper: () => ({ group: mocks.group }) }));
vi.mock('./services/grouping/apply', () => ({ applyGrouping: (...args: unknown[]) => mocks.apply(...args), undoLastGrouping: () => mocks.undo() }));
vi.mock('./services/grouping/store', () => ({ loadUndo: () => mocks.loadUndo() }));
vi.mock('./services/userBackgrounds', () => ({ loadUserBackgrounds: async () => [], subscribeUserBackgrounds: () => () => {}, MAX_USER_BACKGROUNDS: 12 }));

let root: Root, container: HTMLDivElement;
const bookmark = (id: string) => ({ id, parentId: 'bar', name: id === 'a' ? 'GitHub' : 'MDN', url: `https://${id}.example`, group: '', color: '', letter: '', visits: 0, last: '' });
const raw = { groups: [{ name: '开发', memberIds: ['a', 'b'] }], unassigned: [] };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function render() { await act(async () => root.render(<App />)); }
async function click(name: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === name || b.getAttribute('aria-label') === name);
  if (!button) throw new Error(`Missing button ${name}`);
  await act(async () => button.click());
}
async function openOrganizer() { await render(); await click('设置'); await click('智能整理'); }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.settings = { ...DEFAULT_SETTINGS, ai: { provider: 'custom', apiKey: 'test-key', model: 'test-model', baseUrl: 'https://example.com/v1' } };
  mocks.chrome = { data: { bookmarks: [bookmark('a'), bookmark('b')], groups: [], recents: [], barId: 'bar', source: 'fallback' }, loading: false, error: null, refresh: vi.fn() };
  mocks.group.mockReset().mockResolvedValue(raw);
  mocks.apply.mockReset().mockResolvedValue({ movedBookmarks: 2, newFolders: 1 });
  mocks.undo.mockReset().mockResolvedValue(true);
  mocks.loadUndo.mockReset().mockResolvedValue(null);
  mocks.update.mockReset();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('continuous AI organizing workspace', () => {
  it('keeps one settings window through generation, preview, apply, refresh, and undo', async () => {
    const pending = deferred<typeof raw>(); mocks.group.mockReturnValue(pending.promise);
    await openOrganizer();
    const dialog = container.querySelector('[role="dialog"]');
    await click('生成整理方案');
    expect(container.textContent).toContain('正在梳理 2 个书签');
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(container.querySelector('[role="dialog"]')).toBe(dialog);
    expect(mocks.apply).not.toHaveBeenCalled();
    await act(async () => pending.resolve(raw));
    expect(container.textContent).toContain('为你整理出 1 个分组');
    expect(container.querySelector('select')).toBeNull();
    await click('应用整理');
    expect(mocks.apply).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('收藏，整理好了');
    mocks.chrome.loading = true; await render();
    expect(container.querySelector('[role="dialog"]')).toBe(dialog);
    expect(container.querySelectorAll('.settings-nav button')).toHaveLength(5);
    await click('撤销本次整理');
    expect(mocks.undo).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('已撤销上次整理');
  });

  it('cancels the actual request and ignores a late response', async () => {
    const pending = deferred<typeof raw>(); mocks.group.mockReturnValue(pending.promise);
    await openOrganizer(); await click('生成整理方案');
    const signal = mocks.group.mock.calls[0][2].signal as AbortSignal;
    await click('停止生成');
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(raw));
    expect(container.textContent).toContain('已停止生成');
    expect(container.textContent).not.toContain('为你整理出');
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('keeps a pending generation when settings close and resumes in the same section', async () => {
    const pending = deferred<typeof raw>(); mocks.group.mockReturnValue(pending.promise);
    await openOrganizer(); await click('生成整理方案'); await click('关闭设置');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => pending.resolve(raw));
    await click('设置');
    expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('设置 · 智能整理');
    expect(container.textContent).toContain('为你整理出 1 个分组');
    expect(mocks.group).toHaveBeenCalledOnce();
  });

  it('preserves the previous draft when regeneration fails, and makes no bookmark changes', async () => {
    await openOrganizer(); await click('生成整理方案');
    await click('重命名 开发');
    const input = container.querySelector<HTMLInputElement>('.ai-proposal-name input')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(input, '我的开发工具'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    mocks.group.mockRejectedValueOnce(new GroupingError('auth', 'secret upstream text'));
    await click('重新生成');
    expect(container.textContent).toContain('我的开发工具');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('密钥');
    expect(container.textContent).not.toContain('secret upstream text');
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('keeps errors inline and supports retrying generation and apply', async () => {
    mocks.group.mockRejectedValueOnce(new GroupingError('network', 'network failure'));
    await openOrganizer(); await click('生成整理方案');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await click('生成整理方案');
    mocks.apply.mockRejectedValueOnce(new GroupingError('apply', 'failed move'));
    await click('应用整理');
    expect(container.textContent).toContain('已尝试恢复原位置');
    expect(container.textContent).toContain('开发');
    await click('应用整理');
    expect(container.textContent).toContain('收藏，整理好了');
  });

  it('prevents duplicate apply while writing bookmarks', async () => {
    const pending = deferred<{ movedBookmarks: number; newFolders: number }>(); mocks.apply.mockReturnValue(pending.promise);
    await openOrganizer(); await click('生成整理方案'); await click('应用整理'); await click('正在应用…');
    expect(mocks.apply).toHaveBeenCalledOnce();
    expect(container.querySelector<HTMLFieldSetElement>('fieldset')?.disabled).toBe(true);
    await act(async () => pending.resolve({ movedBookmarks: 2, newFolders: 1 }));
  });

  it('disables generation for an empty scope before contacting the model', async () => {
    mocks.chrome.data.bookmarks.forEach(bookmark => { bookmark.parentId = 'folder'; });
    await openOrganizer(); await click('生成整理方案');
    expect(container.textContent).toContain('选择「全部书签」');
    expect(mocks.group).not.toHaveBeenCalled();
  });

  it('times out a stalled model request while leaving a retryable workspace', async () => {
    vi.useFakeTimers();
    mocks.group.mockImplementation((_inputs, _groups, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    await openOrganizer(); await click('生成整理方案');
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('模型响应超时');
    expect(container.textContent).toContain('生成整理方案');
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('reports failed undo without hiding the retry action', async () => {
    await openOrganizer(); await click('生成整理方案'); await click('应用整理');
    mocks.undo.mockRejectedValueOnce(new Error('partial undo'));
    await click('撤销本次整理');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('撤销未完成');
    await click('撤销本次整理');
    expect(mocks.undo).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('已撤销上次整理');
  });
});
