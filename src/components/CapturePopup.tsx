import { useEffect, useRef, useState } from 'react';
import type { Bookmark } from '../types';
import { useSettings } from '../hooks/useSettings';
import { hasChromeApi, loadBookmarkData, subscribeBookmarkChanges } from '../services/chromeApi';
import { captureUrl, currentCapturePage, folderPath, INBOX_DESTINATION, matchingBookmarks, openLociInbox, saveCapture, type BookmarkData } from '../services/capture';
import { FolderSelect } from './FolderSelect';
import { Icon } from './Icon';
import './CapturePopup.css';

export function CapturePopup() {
  useSettings();
  const [data, setData] = useState<BookmarkData | null>(null);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [destination, setDestination] = useState(INBOX_DESTINATION);
  const [duplicates, setDuplicates] = useState<Bookmark[]>([]);
  const [allowCopy, setAllowCopy] = useState(false);
  const [pageReady, setPageReady] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<{ title: string; location: string; kept?: boolean } | null>(null);
  const busy = useRef(false);
  const requestId = useRef(crypto.randomUUID());

  useEffect(() => {
    let alive = true;
    let revision = 0;
    const reload = () => {
      const run = ++revision;
      void loadBookmarkData().then(next => { if (alive && run === revision) setData(next); })
        .catch(() => { if (alive) setError('无法读取收藏，请关闭面板后重试。'); });
    };
    const unsubscribe = subscribeBookmarkChanges(reload);
    reload();
    void currentCapturePage().then(page => {
      if (alive && page) { setTitle(page.title); setUrl(page.url); }
    }).catch(failure => { if (alive) setPageError(failure instanceof Error ? failure.message : '无法读取当前页面。'); })
      .finally(() => { if (alive) setPageReady(true); });
    return () => { alive = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!data || !url) { setDuplicates([]); return; }
    try { setDuplicates(matchingBookmarks(data, url)); } catch { setDuplicates([]); }
  }, [data, url]);
  useEffect(() => { setAllowCopy(false); }, [url]);

  const save = async () => {
    if (busy.current || success || !data || !pageReady || pageError) return;
    busy.current = true; setSaving(true); setError(null);
    try {
      const result = await saveCapture({ title, url, destinationId: destination, allowDuplicate: allowCopy, requestId: requestId.current });
      if (result.status === 'duplicate') { setDuplicates(result.matches); setAllowCopy(false); }
      else {
        const fresh = await loadBookmarkData().catch(() => data);
        setSuccess({ title: result.title, location: folderPath(fresh, result.parentId) });
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : '保存失败，请稍后重试。'); }
    finally { busy.current = false; setSaving(false); }
  };
  let host = '';
  try { host = new URL(captureUrl(url)).hostname; } catch { /* editable dev form or restricted page */ }

  return <main className="capture-popup">
    <header className="capture-toolbar"><span className="capture-eyebrow">QUICK CAPTURE</span><button type="button" className="capture-inbox" aria-label="打开 Loci 收件箱" onClick={openLociInbox}>收件箱<Icon name="external" size={14} /></button></header>
    {success ? <section className="capture-success" role="status">
      <span className="capture-success__mark"><Icon name="check" size={28} /></span>
      <h1>{success.kept ? '已保留原来的收藏' : '好内容，留下了。'}</h1>
      <p>{success.title}</p><small>{success.location}</small>
      <button type="button" className="capture-primary" onClick={openLociInbox}>去收件箱整理<Icon name="arrow" size={15} /></button>
    </section> : <>
      <div className="capture-heading"><h1>先收藏，慢慢整理。</h1><p>放进收件箱，或直接为它找到归属。</p></div>
      {!pageReady ? <p className="capture-note" role="status">正在读取当前页面…</p> : pageError ? <div className="capture-feedback" role="alert"><Icon name="bookmark" size={24} /><p>{pageError}</p></div> : <form onSubmit={event => { event.preventDefault(); void save(); }}>
        {!hasChromeApi && <p className="capture-preview-note">开发预览：输入网页地址，体验收藏流程。</p>}
        <label className="capture-field"><span>收藏标题</span><input value={title} maxLength={500} placeholder="给这份收藏起个名字" disabled={saving} onChange={event => setTitle(event.target.value)} /></label>
        <label className="capture-field capture-url"><span>网页地址{host && <small>{host}</small>}</span><input value={url} type="url" required readOnly={hasChromeApi} disabled={saving} placeholder="https://…" onChange={event => setUrl(event.target.value)} /></label>
        <label className="capture-field"><span>保存到</span><FolderSelect label="保存到" data={data}
          value={destination} disabled={saving} onChange={setDestination} includeInbox /></label>
        {!!duplicates.length && <section className="capture-duplicates" aria-label="已有收藏">
          <h2><Icon name="check" size={15} />这个网页已经收藏过</h2>
          <ul>{duplicates.map(bookmark => <li key={bookmark.id}><strong>{bookmark.name}</strong><span>{data ? folderPath(data, bookmark.parentId) : ''}</span></li>)}</ul>
          <label><input type="checkbox" checked={allowCopy} disabled={saving} onChange={event => setAllowCopy(event.target.checked)} />仍在目标位置另存一份</label>
        </section>}
        {error && <p className="capture-error" role="alert">{error}</p>}
        {!!duplicates.length && !allowCopy ? <button className="capture-primary" type="button" onClick={() => {
          const first = duplicates[0]!;
          setSuccess({ title: first.name, location: data ? folderPath(data, first.parentId) : '', kept: true });
        }}>保留已有收藏<Icon name="check" size={16} /></button> : <button className="capture-primary" type="submit" disabled={saving || !data || !title.trim() || !url.trim()}>{saving ? '正在保存…' : allowCopy ? '另存一份' : '保存收藏'}<Icon name="plus" size={16} /></button>}
      </form>}
      <footer className="capture-footer"><Icon name="folder" size={13} /><span>{hasChromeApi ? '保存在你的 Chrome 书签中' : '预览数据仅保存在当前浏览器，不会写入 Chrome 书签'}</span></footer>
    </>}
  </main>;
}
