import { useEffect, useState } from 'react';
import { clearFaviconCache, DEFAULT_FAVICON_PREFERENCES, faviconCacheStats, hasFaviconPermission, readFaviconPreferences, requestFaviconPermission, saveFaviconPreferences, subscribeFaviconPreferences, type FaviconPreferences } from '../services/faviconStorage';
import { Select } from './Select';
import { SettingGroup, SettingNotice, SettingRow, Switch } from './SettingsControls';
const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
export function FaviconSettings() {
  const [value, setValue] = useState(DEFAULT_FAVICON_PREFERENCES);
  const [stats, setStats] = useState({ count: 0, bytes: 0 });
  const [permission, setPermission] = useState(true);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true; let revision = 0;
    const read = async () => {
      const run = ++revision;
      try {
        const [next, granted, usage] = await Promise.all([readFaviconPreferences(), hasFaviconPermission(), faviconCacheStats()]);
        if (alive && run === revision) { setValue(next); setPermission(granted); setStats(usage); setReady(true); }
      } catch { if (alive && run === revision) { setReady(true); setError('无法读取图标缓存，请刷新后重试。'); } }
    };
    void read(); const unsubscribe = subscribeFaviconPreferences(() => void read());
    const timer = setInterval(() => void read(), 3000);
    return () => { alive = false; clearInterval(timer); unsubscribe(); };
  }, []);
  const save = async (patch: Partial<FaviconPreferences>) => {
    if (busy || !ready) return;
    setBusy(true); setError(''); setMessage('');
    try {
      // Permission is requested before the first await to preserve the user gesture.
      if (patch.enabled && !await requestFaviconPermission()) { setError('未获得图标服务访问权限，仍可在线显示图标。'); return; }
      const next = { ...value, ...patch }; await saveFaviconPreferences(next);
      setValue(next); setPermission(await hasFaviconPermission()); setStats(await faviconCacheStats());
    } catch (cause) { setError(cause instanceof Error ? cause.message : '图标缓存设置未保存，请重试。'); }
    finally { setBusy(false); }
  };
  return <SettingGroup title="网站图标缓存" note="图标来自 gstatic.cn，仅缓存到本机。关闭后使用在线图标，已缓存图片可单独清空。">
    <SettingRow title="缓存网站图标" hint="再次打开时优先读取本机图片，减少重复请求"><Switch label="缓存网站图标" checked={value.enabled} disabled={!ready || busy} onChange={enabled => void save({ enabled })} /></SettingRow>
    {value.enabled && <>
      <SettingRow title="更新间隔" hint="超过间隔后重新获取；连接失败保留旧图标"><Select label="图标缓存更新间隔" disabled={busy} value={String(value.days)} options={[{ value: '7', label: '7 天' }, { value: '30', label: '30 天' }, { value: '90', label: '90 天' }]} onChange={days => void save({ days: Number(days) })} /></SettingRow>
      <SettingRow title="缓存容量" hint="达到上限时自动清理较少使用的图标"><Select label="图标缓存容量" disabled={busy} value={String(value.maxMB)} options={[{ value: '5', label: '5 MB' }, { value: '20', label: '20 MB' }, { value: '50', label: '50 MB' }]} onChange={maxMB => void save({ maxMB: Number(maxMB) })} /></SettingRow>
      {!permission && <SettingRow title="图标服务尚未授权" hint="已有缓存仍可读取，授权后恢复更新"><button type="button" className="settings-button" disabled={busy} onClick={() => void save({ enabled: true })}>授权图标缓存</button></SettingRow>}
    </>}
    <SettingRow title="本机缓存" hint={`${stats.count} 个网站 · 图片占用 ${formatBytes(stats.bytes)}`}><button type="button" className="settings-button" disabled={busy || !ready || !stats.count} onClick={async () => {
      setBusy(true); setError(''); setMessage('');
      try { await clearFaviconCache(); setStats(await faviconCacheStats()); setMessage('图标缓存已清空，已显示的图标会保留到本页关闭。'); }
      catch { setError('清理失败，请重试。'); } finally { setBusy(false); }
    }}>清空图标缓存</button></SettingRow>
    {(error || message) && <SettingNotice tone={error ? 'error' : 'neutral'}>{error || message}</SettingNotice>}
  </SettingGroup>;
}
