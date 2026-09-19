import { useEffect, useRef, useState } from 'react';
import type { Bookmark, ChromeData, Group, Settings } from '../types';
import type { GroupingSelection } from '../hooks/useGrouping';
import { useSurfaceDismiss } from '../hooks/useSurfaceDismiss';
import { archiveInboxBookmark, folderPath, inboxDescendants } from '../services/capture';
import { openUrl } from '../services/chromeApi';
import { FolderSelect } from './FolderSelect';
import { CloseButton } from './CloseButton';
import { Icon } from './Icon';
import './InboxPanel.css';

interface Props {
  open: boolean;
  data: ChromeData;
  folder: Group | null;
  bookmarks: Bookmark[];
  ready: boolean;
  error: string | null;
  settings: Settings;
  organizing: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onOrganize: (selection: GroupingSelection) => void;
}

export function InboxPanel({ open, data, folder, bookmarks, ready, error: loadError, settings, organizing, onClose, onRefresh, onOrganize }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [destinations, setDestinations] = useState<Record<string, string>>({});
  const [moving, setMoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dialog = useRef<HTMLElement>(null);
  const busy = useRef(false);
  const excluded = inboxDescendants(data.groups, folder?.id ?? null);
  const selectedIds = bookmarks.filter(bookmark => selected.has(bookmark.id)).map(bookmark => bookmark.id);
  useSurfaceDismiss('inbox', open, onClose);

  useEffect(() => {
    const valid = new Set(bookmarks.map(bookmark => bookmark.id));
    setSelected(previous => [...previous].every(id => valid.has(id)) ? previous : new Set([...previous].filter(id => valid.has(id))));
  }, [bookmarks]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const element = dialog.current;
    return () => {
      // Let the next surface take focus if one is opening at the same time.
      if (document.activeElement === document.body || element?.contains(document.activeElement)) previous?.focus();
    };
  }, [open]);

  const archive = async (bookmark: Bookmark) => {
    const destination = destinations[bookmark.id];
    if (busy.current || !folder || !destination) return;
    busy.current = true; setMoving(bookmark.id); setError(null); setNotice(null);
    try {
      await archiveInboxBookmark(bookmark.id, folder.id, destination);
      setNotice(`「${bookmark.name}」已归档到 ${folderPath(data, destination)}。`);
      setSelected(previous => { const next = new Set(previous); next.delete(bookmark.id); return next; });
      onRefresh();
      dialog.current?.focus();
    } catch (failure) { setError(failure instanceof Error ? failure.message : '移动失败，请重试。'); onRefresh(); }
    finally { busy.current = false; setMoving(null); }
  };

  if (!open) return null;
  return <div className="inbox-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className="inbox-panel" role="dialog" aria-modal="true" aria-label="收件箱" tabIndex={-1} onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'Tab') {
        const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]') ?? [])];
        const first = focusable[0], last = focusable.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
      }
    }}>
      <header className="inbox-heading"><span className="inbox-heading__mark"><Icon name="inbox" size={25} /></span><div><span className="inbox-eyebrow">COLLECT NOW · SORT LATER</span><h1>收件箱 <span>{bookmarks.length}</span></h1></div><CloseButton label="关闭收件箱" onClick={onClose} /></header>
      <p className="inbox-intro">先留住灵感，再给它一个位置。</p>
      <div className="inbox-location"><Icon name="folder" size={14} /><span>{folder ? folderPath(data, folder.id) : '首次收藏时，将创建「Loci 收件箱」文件夹'}</span></div>
      {data.source === 'fallback' && <aside className="inbox-preview" aria-label="网页预览说明">
        <div><strong>当前为网页预览</strong><p>工具栏收藏需安装 Chrome 扩展。这里可以手动输入网址，体验收藏流程。</p></div>
        <a href="./popup.html" target="_blank" rel="noopener noreferrer">体验收藏<Icon name="external" size={13} /></a>
      </aside>}
      {(loadError || error) && <div className="inbox-feedback inbox-feedback--error" role="alert">{loadError || error}<button type="button" onClick={onRefresh}>刷新</button></div>}
      {notice && <p className="inbox-feedback" role="status">{notice}</p>}
      {!ready ? <p className="inbox-empty" role="status">正在读取收件箱…</p> : !bookmarks.length ? <div className="inbox-empty"><div className="inbox-empty__illustration"><Icon name="bookmark" size={28} /><Icon name="inbox" size={68} /></div><h2>{folder ? '留一点空白给下一次发现' : '把来不及整理的，先放在这里'}</h2>
        {data.source === 'fallback' ? <><p>点击「体验收藏」，将网页保存到收件箱，<br />之后再慢慢归档。</p><small>预览数据仅保存在当前浏览器，不会写入 Chrome 书签。</small></> : <><p>在普通网页上点击浏览器工具栏中的 Loci 图标，<br />将收藏保存到收件箱，之后再慢慢归档。</p><small>在 Chrome 的扩展菜单中固定 Loci，方便随时收藏。</small></>}
      </div> : <>
        <div className="inbox-toolbar"><label><input type="checkbox" aria-label="选择全部收件箱书签" checked={selectedIds.length === bookmarks.length} disabled={!!moving} onChange={event => setSelected(new Set(event.target.checked ? bookmarks.map(bookmark => bookmark.id) : []))} /><span>{selectedIds.length ? `已选择 ${selectedIds.length} 项` : `${bookmarks.length} 项待整理`}</span></label><button type="button" className="inbox-ai-button" disabled={!selectedIds.length || !!moving || organizing} onClick={() => { if (folder) onOrganize({ ids: selectedIds, inboxId: folder.id }); }}><Icon name="ai" size={15} />整理所选</button></div>
        <div className="inbox-list">{bookmarks.map(bookmark => <article key={bookmark.id} className="inbox-item" data-selected={selected.has(bookmark.id) || undefined}>
          <div className="inbox-item__main"><input type="checkbox" aria-label={`选择 ${bookmark.name}`} checked={selected.has(bookmark.id)} disabled={!!moving} onChange={event => setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(bookmark.id); else next.delete(bookmark.id); return next; })} /><span className="inbox-item__letter" aria-hidden>{bookmark.name.slice(0, 1).toUpperCase()}</span><button type="button" className="inbox-item__title" onClick={() => openUrl(bookmark.url, settings.openInNewTab)} title={bookmark.url}><strong>{bookmark.name}</strong><small>{bookmark.url}</small></button><Icon name="external" size={13} /></div>
          <div className="inbox-item__destination"><label><span>归档到</span><FolderSelect label={`移动 ${bookmark.name} 到`} value={destinations[bookmark.id] ?? ''} data={data} exclude={excluded} disabled={!!moving}
            onChange={value => setDestinations(previous => ({ ...previous, [bookmark.id]: value }))} /></label><button type="button" disabled={!!moving || !destinations[bookmark.id]} onClick={() => void archive(bookmark)}>{moving === bookmark.id ? '移动中…' : '移动'}<Icon name="arrow" size={12} /></button></div>
        </article>)}</div>
        <footer className="inbox-footer"><span>逐条移动即可归档，不需要配置 AI。</span><span>选择多条，可先预览智能整理方案。</span></footer>
      </>}
    </section>
  </div>;
}
