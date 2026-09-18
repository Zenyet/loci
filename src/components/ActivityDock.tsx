import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Bookmark, HistoryItem } from '../types';
import { Favicon } from './Favicon';
import { Icon } from './Icon';
import './ActivityDock.css';

interface Props {
  bookmarks: Bookmark[];
  recents: HistoryItem[];
  openInNewTab: boolean;
  now: Date;
  blocked?: boolean;
}

export function activityUrl(url: string): string {
  return /^[a-z][a-z\d+.-]*:/i.test(url) ? url : `https://${url}`;
}

function hostOf(url: string): string {
  try { return new URL(activityUrl(url)).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

export function frequentBookmarks(bookmarks: Bookmark[]): Bookmark[] {
  const seen = new Set<string>();
  return [...bookmarks].sort((a, b) => b.visits - a.visits).filter(bookmark => {
    const url = activityUrl(bookmark.url);
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  }).slice(0, 8);
}

export function visitLabel(item: HistoryItem, now: Date): { day: string; time: string; full: string } {
  if (!item.lastVisitTime) return { day: '最近', time: item.at, full: item.at };
  const date = new Date(item.lastVisitTime);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const minutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60_000));
  const clock = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return {
    day: date >= today ? '今天' : date >= yesterday ? '昨天' : date.toLocaleDateString('zh-CN', { ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}), month: 'long', day: 'numeric' }),
    time: minutes < 1 ? '刚刚' : minutes < 60 ? `${minutes} 分钟前` : clock,
    full: date.toLocaleString('zh-CN', { hour12: false }),
  };
}

type ActivityView = 'frequent' | 'recent';

function historyFavicon(item: HistoryItem, bookmarks: Bookmark[]): Pick<Bookmark, 'name' | 'url' | 'color' | 'letter'> {
  const host = hostOf(item.url);
  const bookmark = bookmarks.find(candidate => hostOf(candidate.url) === host);
  return { name: item.title, url: item.url, color: 'transparent', letter: bookmark?.letter ?? host.slice(0, 2).toUpperCase() };
}

export function ActivityDock({ bookmarks, recents, openInNewTab, now, blocked = false }: Props) {
  const [view, setView] = useState<ActivityView | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const frequentTrigger = useRef<HTMLButtonElement>(null);
  const recentTrigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const frequent = useMemo(() => frequentBookmarks(bookmarks), [bookmarks]);
  const orderedRecents = useMemo(() => [...recents].sort((a, b) => b.lastVisitTime - a.lastVisitTime), [recents]);
  const match = (title: string, url: string) => `${title} ${hostOf(url)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const visibleFrequent = frequent.filter(item => match(item.name, item.url));
  const visibleRecents = orderedRecents.filter(item => match(item.title, item.url));
  const sections = new Map<string, HistoryItem[]>();
  for (const item of visibleRecents) {
    const day = visitLabel(item, now).day;
    sections.set(day, [...(sections.get(day) ?? []), item]);
  }
  const title = view === 'frequent' ? '常用' : '最近访问';
  const count = view === 'frequent' ? visibleFrequent.length : visibleRecents.length;
  const linkProps = { target: openInNewTab ? '_blank' : undefined, rel: 'noopener noreferrer' };
  const triggerFor = (next: ActivityView) => next === 'frequent' ? frequentTrigger : recentTrigger;
  const close = () => {
    if (view) triggerFor(view).current?.focus();
    setView(null);
  };
  const switchView = (next: ActivityView) => { setQuery(''); setSearching(false); setView(next); };

  useEffect(() => {
    setQuery('');
    setSearching(false);
    if (!view) return;
    panelRef.current?.focus();
    const onOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setView(null);
    };
    document.addEventListener('pointerdown', onOutside);
    return () => document.removeEventListener('pointerdown', onOutside);
  }, [view]);
  useEffect(() => { if (blocked) setView(null); }, [blocked]);

  const entryIcon = (bookmark: Pick<Bookmark, 'name' | 'url' | 'color' | 'letter'>) => <span className="activity-panel__favicon" aria-hidden="true"><Favicon bookmark={bookmark} size={22} fontSize={10} radius={4} style={{ background: 'transparent', color: 'var(--fg-2)' }} /></span>;

  return <aside className="activity-dock" aria-label="常用与最近访问" ref={rootRef}
    onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setView(null); }}
    onKeyDown={event => {
      if (!view) return;
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); close(); }
    }}>
    <button ref={frequentTrigger} className="activity-dock__trigger" type="button" aria-label="常用" aria-expanded={view === 'frequent'} aria-controls={view === 'frequent' ? panelId : undefined} aria-haspopup="dialog"
      onClick={() => view === 'frequent' ? close() : switchView('frequent')}>
      <Icon name="bookmark" size={15} /><span>常用</span>
    </button>
    <span className="activity-dock__divider" aria-hidden="true" />
    <button ref={recentTrigger} className="activity-dock__trigger" type="button" aria-label="最近访问" aria-expanded={view === 'recent'} aria-controls={view === 'recent' ? panelId : undefined} aria-haspopup="dialog"
      onClick={() => view === 'recent' ? close() : switchView('recent')}>
      <Icon name="history" size={16} /><span>最近访问</span>
    </button>

    {view && <section ref={panelRef} id={panelId} className="activity-panel" role="dialog" aria-label={title} tabIndex={-1} onKeyDown={event => {
      if (event.target === panelRef.current && event.key === 'ArrowDown') {
        event.preventDefault();
        panelRef.current?.querySelector<HTMLAnchorElement>('a')?.focus();
      }
    }}>
      <header className="activity-panel__header">
        <div className="activity-panel__tabs" aria-label="浏览记录分类">
          <button type="button" aria-pressed={view === 'frequent'} onClick={() => switchView('frequent')}>常用</button>
          <button type="button" aria-pressed={view === 'recent'} onClick={() => switchView('recent')}>最近访问</button>
        </div>
        <button type="button" className="activity-panel__action" aria-label={`搜索${title}`} aria-expanded={searching} onClick={() => { setQuery(''); setSearching(previous => !previous); }}><Icon name="search" size={15} /></button>
        <button type="button" className="activity-panel__action" onClick={close} aria-label={`关闭${title}`}><Icon name="close" size={15} /></button>
      </header>
      {searching && <div className="activity-panel__search"><Icon name="search" size={14} /><input autoFocus aria-label={`查找${title}`} placeholder="搜索标题或网站" value={query} onChange={event => setQuery(event.target.value)} /></div>}
      <div className="activity-panel__list" onKeyDown={event => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        const links = [...event.currentTarget.querySelectorAll<HTMLAnchorElement>('a')];
        const index = links.indexOf(document.activeElement as HTMLAnchorElement);
        if (index < 0) return;
        event.preventDefault();
        links[Math.max(0, Math.min(links.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
      }}>
        {view === 'frequent' ? visibleFrequent.map(bookmark => <a className="activity-panel__item activity-panel__item--frequent" key={bookmark.id} href={activityUrl(bookmark.url)} {...linkProps}
          onClick={() => setView(null)} aria-label={`打开 ${bookmark.name}`} title={`${bookmark.name}\n${hostOf(bookmark.url)}`}>
          {entryIcon(bookmark)}
          <span className="activity-panel__body"><span className="activity-panel__title">{bookmark.name}</span><span className="activity-panel__host">{hostOf(bookmark.url)}</span></span>
          <Icon className="activity-panel__open" name="external" size={13} />
        </a>) : [...sections].map(([day, items]) => <section className="activity-panel__day" key={day} aria-label={day}>
          {day !== '最近' && <h3>{day}</h3>}
          {items.map((item, index) => {
            const label = visitLabel(item, now);
            return <a className="activity-panel__item" key={`${item.url}-${index}`} href={activityUrl(item.url)} {...linkProps} onClick={() => setView(null)}
              title={`${item.title}\n${item.url}\n${label.full}`}>
              {entryIcon(historyFavicon(item, bookmarks))}
              <span className="activity-panel__body"><span className="activity-panel__title">{item.title || hostOf(item.url)}</span><span className="activity-panel__host">{hostOf(item.url)}</span></span>
              <time className="activity-panel__time" dateTime={item.lastVisitTime ? new Date(item.lastVisitTime).toISOString() : undefined}>{label.time}</time>
            </a>;
          })}
        </section>)}
        {!count && <div className="activity-panel__empty"><span>{query ? '没有找到相关页面' : view === 'frequent' ? '收藏的网站会出现在这里' : '还没有最近访问'}</span>{query && <button type="button" onClick={() => setQuery('')}>清除搜索</button>}</div>}
      </div>
    </section>}
  </aside>;
}
