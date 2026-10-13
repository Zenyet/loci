import { useImageSource } from '../hooks/useImageSource';
import { useState } from 'react';
import type { Settings } from '../types';
import { useBingWallpaper } from '../hooks/useBingWallpaper';
import { requestBingPermission } from '../services/bingWallpaper';
import { SettingNotice, SettingRow, Switch } from './SettingsControls';
import { Icon } from './Icon';
export function BingWallpaperSettings({ settings, onChange }: { settings: Settings; onChange: (patch: Partial<Settings>) => void }) {
  const bing = useBingWallpaper(settings.bingWallpaper && settings.bg === 'image');
  const image = useImageSource(bing.data?.imageRef);
  const [error, setError] = useState(''); const [granting, setGranting] = useState(false);
  const retry = async () => {
    if (granting) return;
    setGranting(true); setError('');
    try {
      if (!await requestBingPermission()) { setError('尚未允许连接必应，请授权后重试。'); return; }
      bing.refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : '无法申请必应访问权限。'); }
    finally { setGranting(false); }
  };
  return <section className="settings-group bing-wallpaper-settings" aria-label="Bing 每日壁纸">
    <h3>Bing 每日壁纸 <span>每天，一处新风景</span></h3>
    <div className="bing-wallpaper-preview" style={image.url ? { backgroundImage: `url("${image.url}")` } : undefined}>
      {!bing.data && <Icon name="wallpaper" size={34} />}<span>{bing.data?.title || '把世界的风景，带到你的桌面'}</span>
    </div>
    <SettingRow title="每日自动更新" hint="选择其他壁纸后，自动更新会关闭"><Switch label="Bing 每日壁纸" checked={settings.bingWallpaper} onChange={async enabled => {
      if (!enabled) { onChange({ bingWallpaper: false }); return; }
      if (granting) return; setGranting(true); setError('');
      try { if (!await requestBingPermission()) { setError('尚未允许连接必应，可以再次开启。'); return; } onChange({ bingWallpaper: true, bg: 'image' }); }
      catch (failure) { setError(failure instanceof Error ? failure.message : '无法申请必应访问权限。'); } finally { setGranting(false); }
    }} /></SettingRow>
    <div className="bing-wallpaper-meta"><span>{granting ? '正在申请连接权限…' : bing.loading ? '正在更新今日壁纸…' : bing.data?.copyright || '首次开启时下载图片，本机保留最近一张。'}</span>
      {settings.bingWallpaper && <button type="button" disabled={bing.loading || granting} onClick={() => void retry()}>{bing.errorCode === 'permission' ? '授权并重试' : bing.error || error ? '重试' : '刷新'}</button>}
      {bing.data && <a href={bing.data.source} target="_blank" rel="noreferrer">图片故事 ↗</a>}
    </div>{(error || (settings.bingWallpaper && bing.error)) && <SettingNotice tone="error">{error || bing.error}</SettingNotice>}
  </section>;
}
