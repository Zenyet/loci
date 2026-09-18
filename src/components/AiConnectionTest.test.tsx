import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { AiConnectionTest } from './AiConnectionTest';
import { testAiConnection, type ConnectionTestResult } from '../services/ai/connection';
import type { AiSettings } from '../types';

vi.mock('../services/ai/connection', () => ({ testAiConnection: vi.fn() }));
const ai: AiSettings = { provider: 'custom', apiKey: 'test-key', model: 'm', baseUrl: 'https://example.com/v1' };
let root: Root;
let container: HTMLDivElement;
const render = async (settings = ai) => { await act(async () => root.render(<AiConnectionTest ai={settings} />)); };
const click = async () => { await act(async () => container.querySelector('button')!.click()); };

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(testAiConnection).mockReset();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe('connection test control', () => {
  it('runs only on click, prevents duplicate tests, and announces success', async () => {
    let resolve!: (result: ConnectionTestResult) => void;
    vi.mocked(testAiConnection).mockReturnValue(new Promise(done => { resolve = done; }));
    await render();
    expect(testAiConnection).not.toHaveBeenCalled();
    await click(); await click();
    expect(testAiConnection).toHaveBeenCalledOnce();
    expect(container.querySelector('button')!.disabled).toBe(true);
    expect(container.textContent).toContain('测试中');
    await act(async () => resolve({ ok: true, message: '连接成功', latencyMs: 1250 }));
    expect(container.querySelector('[role="status"]')!.textContent).toContain('连接成功 · 1.3 秒');
    expect(container.querySelector('button')!.disabled).toBe(false);
  });

  it('shows failures and allows a retry', async () => {
    vi.mocked(testAiConnection).mockResolvedValue({ ok: false, message: '请先填写 API 密钥。' });
    await render({ ...ai, apiKey: '' }); await click();
    expect(container.textContent).toContain('请先填写 API 密钥');
    expect(container.querySelector('[data-status="error"]')).not.toBeNull();
    await click(); expect(testAiConnection).toHaveBeenCalledTimes(2);
  });

  it('cancels and discards an obsolete result when the configuration changes', async () => {
    let resolve!: (result: ConnectionTestResult) => void;
    vi.mocked(testAiConnection).mockReturnValue(new Promise(done => { resolve = done; }));
    await render(); await click();
    const signal = vi.mocked(testAiConnection).mock.calls[0][1]!.signal!;
    await render({ ...ai, model: 'new-model' });
    expect(signal.aborted).toBe(true);
    await act(async () => resolve({ ok: true, message: 'old result', latencyMs: 12 }));
    expect(container.textContent).not.toContain('old result');
    expect(container.querySelector('button')!.disabled).toBe(false);
  });

  it('cancels when leaving the settings section', async () => {
    vi.mocked(testAiConnection).mockReturnValue(new Promise(() => {}));
    await render(); await click();
    const signal = vi.mocked(testAiConnection).mock.calls[0][1]!.signal!;
    await act(async () => root.render(null));
    expect(signal.aborted).toBe(true);
  });
});
