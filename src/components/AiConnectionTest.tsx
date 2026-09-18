import { useEffect, useRef, useState } from 'react';
import type { AiSettings } from '../types';
import { testAiConnection, type ConnectionTestResult } from '../services/ai/connection';

export function AiConnectionTest({ ai }: { ai: AiSettings }) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ConnectionTestResult | null>(null);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    setPending(false);
    setResult(null);
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [ai.provider, ai.apiKey, ai.baseUrl, ai.model]);

  const test = async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setResult(null);
    try {
      const next = await testAiConnection(ai, { signal: controller.signal });
      if (!controller.signal.aborted) setResult(next);
    } catch {
      if (!controller.signal.aborted) setResult({ ok: false, message: '测试未完成，请重试。' });
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  };

  const state = pending ? 'pending' : result ? result.ok ? 'success' : 'error' : 'idle';
  return (
    <div className="settings-row settings-connection" data-status={state}>
      <div className="settings-row-copy">
        <span>连接检查</span>
        <small role="status" aria-live="polite" aria-atomic="true">
          {pending ? '正在验证密钥和模型…' : result ? result.message : '仅发送固定测试示例，验证服务是否可用'}
          {result?.ok && result.latencyMs !== undefined && (
            <span className="settings-connection-time"> · {(result.latencyMs / 1000).toFixed(1)} 秒</span>
          )}
        </small>
      </div>
      <div className="settings-row-control">
        <button type="button" className="settings-button" disabled={pending} onClick={test} aria-busy={pending}>
          {pending && <span className="settings-connection-spinner" aria-hidden="true" />}
          {pending ? '测试中…' : '测试连接'}
        </button>
      </div>
    </div>
  );
}
