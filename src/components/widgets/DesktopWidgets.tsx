import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { DesktopWidgetId, WidgetPlacement, WidgetSettings } from '../../types';
import { patchWidgets } from '../../services/widgetSettings';
import { constrainPosition, placementFromPixels, resolveWidgetLayout, SIZE_LABELS, widgetDimensions, WIDGET_SIZES } from '../../services/widgetLayout';
import { WIDGET_CATALOG } from './catalog';
import { CalendarWidget } from './CalendarWidget';
import { Icon } from '../Icon';
import './desktop-widgets.css';

type Frame = ReturnType<typeof resolveWidgetLayout>[number];
type Layout = WidgetSettings['desktop']['layout'];
interface Moving { id: DesktopWidgetId; left: number; top: number; origin: Frame; fixed: boolean }
interface DragSession {
  frame: Frame;
  pointerId: number;
  target: HTMLButtonElement;
  card: HTMLElement;
  x: number; y: number;
  left: number; top: number;
  tilt: number;
  viewport: { width: number; height: number };
}
interface Props {
  editRequest?: number;
  settings: WidgetSettings; now: Date; blocked: boolean;
  onChange: (next: WidgetSettings) => void; onConfigure: () => void;
  render: (id: DesktopWidgetId) => ReactNode;
  onEditing: (editing: boolean) => void;
}
const samePlacement = (a: WidgetPlacement | undefined, b: WidgetPlacement) => a?.x === b.x && a.y === b.y && a.size === b.size && a.coordinateSpace === b.coordinateSpace;

export function DesktopWidgets({ editRequest, settings, now, blocked, onChange, onConfigure, render, onEditing }: Props) {
  const [editing, setEditing] = useState(false);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const [moving, setMoving] = useState<Moving | null>(null);
  const [settling, setSettling] = useState<DesktopWidgetId | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [pendingLayout, setPendingLayout] = useState<Layout>({});
  const pendingRef = useRef<Layout>({});
  const drag = useRef<DragSession | null>(null);
  const paintRequest = useRef<number | null>(null);
  const layer = useRef<HTMLDivElement>(null);
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const editButton = useRef<HTMLButtonElement>(null);
  const layout = { ...settings.desktop.layout, ...pendingLayout };
  const frames = resolveWidgetLayout({ ...settings, desktop: { ...settings.desktop, layout } }, viewport);

  // Keep the exact dropped frame until the parent acknowledges that placement.
  // A delayed controlled update must not expose the previous layout for a paint.
  useLayoutEffect(() => {
    const next = { ...pendingRef.current }; let changed = false;
    for (const id of Object.keys(next) as DesktopWidgetId[]) {
      if (samePlacement(settings.desktop.layout[id], next[id]!)) { delete next[id]; changed = true; }
    }
    if (changed) { pendingRef.current = next; setPendingLayout(next); }
  }, [settings.desktop.layout]);

  const releaseDrag = useCallback(() => {
    const current = drag.current; drag.current = null;
    if (paintRequest.current !== null) cancelAnimationFrame(paintRequest.current);
    paintRequest.current = null;
    if (layer.current) delete layer.current.dataset.dragEdges;
    if (current) {
      for (const key of ['--widget-drag-x', '--widget-drag-y', '--widget-tilt']) current.card.style.removeProperty(key);
      if (current.target.hasPointerCapture(current.pointerId)) current.target.releasePointerCapture(current.pointerId);
    }
    return current;
  }, []);
  const cancelDrag = useCallback(() => {
    const current = releaseDrag(); if (!current) return;
    setMoving(null); setSettling(null); setAnnouncement(`${WIDGET_CATALOG[current.frame.id].title}已取消移动`);
  }, [releaseDrag]);
  useEffect(() => {
    const resize = () => { cancelDrag(); setViewport({ width: window.innerWidth, height: window.innerHeight }); };
    window.addEventListener('resize', resize); window.addEventListener('blur', cancelDrag);
    return () => { window.removeEventListener('resize', resize); window.removeEventListener('blur', cancelDrag); releaseDrag(); };
  }, [cancelDrag, releaseDrag]);
  useEffect(() => {
    if (!settling) return;
    const timer = window.setTimeout(() => setSettling(null), 460);
    return () => window.clearTimeout(timer);
  }, [settling]);
  useEffect(() => { if (editRequest) setEditing(true); }, [editRequest]);
  useEffect(() => { onEditing(editing); return () => onEditing(false); }, [editing, onEditing]);
  useEffect(() => {
    if (layer.current) layer.current.inert = blocked;
    if (blocked) { releaseDrag(); setEditing(false); setMoving(null); setSettling(null); }
  }, [blocked, releaseDrag]);

  const currentSettings = () => ({ ...settingsRef.current, desktop: { ...settingsRef.current.desktop, layout: { ...settingsRef.current.desktop.layout, ...pendingRef.current } } });
  const save = (frame: Frame, left: number, top: number) => {
    const placement = placementFromPixels(left, top, frame.width, frame.height, viewport, frame.size);
    pendingRef.current = { ...pendingRef.current, [frame.id]: placement };
    setPendingLayout(pendingRef.current);
    onChange(currentSettings());
  };
  const positionAt = (current: DragSession, x: number, y: number) => {
    const position = constrainPosition(current.frame.left + x - current.x, current.frame.top + y - current.y,
      current.frame.width, current.frame.height, current.viewport);
    const right = Math.max(0, current.viewport.width - current.frame.width), bottom = Math.max(0, current.viewport.height - current.frame.height);
    // A small magnetic zone has the same preview and committed coordinates.
    return { left: position.left < 8 ? 0 : right - position.left < 8 ? right : position.left,
      top: position.top < 8 ? 0 : bottom - position.top < 8 ? bottom : position.top };
  };
  const paintDrag = () => {
    paintRequest.current = null;
    const current = drag.current; if (!current) return;
    current.card.style.setProperty('--widget-drag-x', `${current.left - current.frame.left}px`);
    current.card.style.setProperty('--widget-drag-y', `${current.top - current.frame.top}px`);
    current.card.style.setProperty('--widget-tilt', `${current.tilt}deg`);
    if (layer.current) layer.current.dataset.dragEdges = [
      current.left === 0 && 'left', current.top === 0 && 'top',
      current.left === current.viewport.width - current.frame.width && 'right',
      current.top === current.viewport.height - current.frame.height && 'bottom',
    ].filter(Boolean).join(' ');
  };
  const finishEditing = () => { cancelDrag(); setEditing(false); setSettling(null); editButton.current?.focus(); };
  return <>
    <div ref={layer} className="desktop-widgets" aria-label="桌面小组件" data-appearance={settings.desktop.appearance} data-editing={editing || undefined}
      data-dragging={!!moving || undefined} onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape' && editing) { event.preventDefault(); if (drag.current) cancelDrag(); else finishEditing(); }
      }}>
      {moving && <>
        <div className="widget-drag-origin" aria-hidden="true" style={{ position: moving.fixed ? 'fixed' : 'absolute', left: moving.origin.left, top: moving.origin.top, width: moving.origin.width, height: moving.origin.height }} />
        <div className="widget-edge-guides" aria-hidden="true"><i data-edge="left" /><i data-edge="top" /><i data-edge="right" /><i data-edge="bottom" /></div>
      </>}
      {frames.map(frame => <article key={frame.id} className={`desktop-widget desktop-widget--${frame.id}`} data-size={frame.size}
        data-moving={moving?.id === frame.id || undefined} data-settling={settling === frame.id || undefined} aria-label={`${WIDGET_CATALOG[frame.id].title}小组件`}
        style={{ position: moving?.id === frame.id || layout[frame.id] ? 'fixed' : 'absolute', width: frame.width, height: frame.height,
          left: moving?.id === frame.id ? moving.left : frame.left, top: moving?.id === frame.id ? moving.top : frame.top }}>
        <div className="desktop-widget__content" ref={element => { if (element) element.inert = editing; }}>
          {frame.id === 'calendar' ? <CalendarWidget compact now={now} settings={settings.calendar} /> : render(frame.id)}
        </div>
        {editing && <>
          <button type="button" className="widget-move-surface" aria-label={`移动${WIDGET_CATALOG[frame.id].title}`} aria-describedby="widget-move-help"
            onPointerDown={event => {
              if (event.button !== 0 || event.isPrimary === false || drag.current) return;
              event.preventDefault(); event.stopPropagation(); event.currentTarget.focus({ preventScroll: true });
              event.currentTarget.setPointerCapture(event.pointerId);
              const fixed = !!layout[frame.id];
              // Default cards scroll; placed cards and the lifted card use viewport coordinates.
              const start = { ...frame, left: frame.left - (fixed ? 0 : layer.current?.scrollLeft ?? 0), top: frame.top - (fixed ? 0 : layer.current?.scrollTop ?? 0) };
              drag.current = { frame: start, x: event.clientX, y: event.clientY, pointerId: event.pointerId, target: event.currentTarget,
                card: event.currentTarget.closest('article')!, left: start.left, top: start.top, tilt: 0, viewport };
              setSettling(null); setAnnouncement(`正在移动${WIDGET_CATALOG[frame.id].title}，松手放置，Escape 取消`);
              setMoving({ id: frame.id, left: start.left, top: start.top, origin: frame, fixed });
            }} onPointerMove={event => {
              const current = drag.current; if (!current || current.pointerId !== event.pointerId) return;
              const position = positionAt(current, event.clientX, event.clientY);
              current.tilt = Math.max(-1.8, Math.min(1.8, (position.left - current.left) * 0.06));
              current.left = position.left; current.top = position.top;
              if (paintRequest.current === null) paintRequest.current = requestAnimationFrame(paintDrag);
            }} onPointerUp={event => {
              const current = drag.current; if (!current || current.pointerId !== event.pointerId) return;
              const position = positionAt(current, event.clientX, event.clientY);
              releaseDrag();
              if (event.clientX !== current.x || event.clientY !== current.y) {
                save(current.frame, position.left, position.top); setSettling(frame.id);
                setAnnouncement(`${WIDGET_CATALOG[frame.id].title}位置已更新`);
              }
              setMoving(null);
            }} onPointerCancel={event => { if (drag.current?.pointerId === event.pointerId) cancelDrag(); }}
            onLostPointerCapture={event => { if (drag.current?.pointerId === event.pointerId) cancelDrag(); }}
            onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
              event.preventDefault(); if (drag.current) return;
              const step = event.shiftKey ? 1 : 12;
              const fixed = !!layout[frame.id];
              save(frame, frame.left - (fixed ? 0 : layer.current?.scrollLeft ?? 0) + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
                frame.top - (fixed ? 0 : layer.current?.scrollTop ?? 0) + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0));
              setAnnouncement(`${WIDGET_CATALOG[frame.id].title}位置已更新`);
            }}><span aria-hidden="true"><Icon name="grip" size={20} /></span></button>
          <button type="button" className="widget-remove" aria-label={`移除${WIDGET_CATALOG[frame.id].title}`} onClick={() => onChange(patchWidgets(currentSettings(), { [frame.id]: { enabled: false } }))}>−</button>
          <div className="widget-card-sizes" role="group" aria-label={`${WIDGET_CATALOG[frame.id].title}尺寸`}>{WIDGET_SIZES.map(size => <button type="button" key={size} aria-pressed={frame.size === size} onClick={() => {
            const dimensions = widgetDimensions(frame.id, size, viewport.width);
            const fixed = !!layout[frame.id];
            const left = frame.left - (fixed ? 0 : layer.current?.scrollLeft ?? 0), top = frame.top - (fixed ? 0 : layer.current?.scrollTop ?? 0);
            // Resizing an edge-aligned card keeps that edge attached.
            save({ ...frame, ...dimensions, size }, left + frame.width >= viewport.width - 1 ? viewport.width - dimensions.width : left,
              top + frame.height >= viewport.height - 1 ? viewport.height - dimensions.height : top);
          }}>{SIZE_LABELS[size]}</button>)}</div>
        </>}
      </article>)}
    </div>
    <span className="widget-drag-announcement" role="status" aria-atomic="true">{announcement}</span>
    <button ref={editButton} type="button" className="widget-add" aria-label={editing ? '完成编辑小组件' : '编辑小组件'} title="编辑小组件" disabled={blocked} aria-pressed={editing} onClick={() => { if (editing) finishEditing(); else setEditing(true); }}><Icon name={editing ? 'check' : 'widgets'} size={18} /></button>
    {editing && !blocked && <div className="widget-edit-toolbar" role="toolbar" aria-label="编辑小组件">
      <span id="widget-move-help">自由摆放 · 靠近边缘自动吸附<small>方向键微调 · Shift 精细移动 · Esc 取消</small></span><button type="button" onClick={onConfigure}><Icon name="plus" size={14} />添加小组件</button>
      <button type="button" onClick={() => { cancelDrag(); pendingRef.current = {}; setPendingLayout({}); setSettling(null); onChange(patchWidgets(settingsRef.current, { desktop: { layout: {} } })); }}>重置布局</button>
      <button type="button" className="widget-edit-done" onClick={finishEditing}>完成</button>
    </div>}
  </>;
}
