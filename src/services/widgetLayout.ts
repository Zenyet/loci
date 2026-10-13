import type { DesktopWidgetId, WidgetPlacement, WidgetSettings, WidgetSize } from '../types';

export const DESKTOP_WIDGETS: DesktopWidgetId[] = ['weather', 'calendar', 'clock', 'todos', 'notes', 'focus', 'revisit', 'market'];
export const WIDGET_SIZES: WidgetSize[] = ['small', 'medium', 'large'];
export const SIZE_LABELS = { small: '小', medium: '中', large: '大' };
export const defaultWidgetSize = (_id: DesktopWidgetId): WidgetSize => 'small';
export function widgetDimensions(id: DesktopWidgetId, size: WidgetSize, viewportWidth: number) {
  const width = Math.min(size === 'small' ? 200 : size === 'medium' ? 304 : 360, Math.max(160, viewportWidth - 32));
  const height = id === 'calendar' ? (size === 'large' ? 300 : 238) : size === 'small' ? 156 : size === 'medium' ? 172 : 248;
  return { width, height };
}
export function constrainPosition(x: number, y: number, width: number, height: number, viewport: { width: number; height: number }) {
  return { left: Math.max(0, Math.min(x, viewport.width - width)), top: Math.max(0, Math.min(y, viewport.height - height)) };
}
export function placementFromPixels(left: number, top: number, width: number, height: number, viewport: { width: number; height: number }, size: WidgetSize): WidgetPlacement {
  const position = constrainPosition(left, top, width, height, viewport);
  return { x: position.left / Math.max(1, viewport.width - width),
    y: position.top / Math.max(1, viewport.height - height), size, coordinateSpace: 'viewport' };
}
export function resolveWidgetLayout(settings: WidgetSettings, viewport: { width: number; height: number }) {
  const margin = 20, gap = 16, start = 84;
  // Default cards occupy the outer edges, never additional columns across the graph.
  // More cards continue below the viewport and remain reachable by scrolling.
  const edgeWidth = Math.max(200, ...DESKTOP_WIDGETS.filter(id => settings[id].enabled).map(id => widgetDimensions(id, settings.desktop.layout[id]?.size ?? defaultWidgetSize(id), viewport.width).width));
  const hasLeftColumn = viewport.width >= edgeWidth * 2 + 480;
  let side: 'right' | 'left' = 'right', y = start, pageTop = start;
  return DESKTOP_WIDGETS.filter(id => settings[id].enabled).map(id => {
    const saved = settings.desktop.layout[id];
    const size = saved?.size ?? defaultWidgetSize(id);
    const dimensions = widgetDimensions(id, size, viewport.width);
    if (y > pageTop && y + dimensions.height > pageTop + viewport.height - start - 20) {
      if (side === 'right' && hasLeftColumn) side = 'left';
      else { side = 'right'; pageTop += Math.max(viewport.height - start, 340); }
      y = pageTop;
    }
    // Legacy positions retain their old inset until the user moves the card.
    const position = saved ? constrainPosition(
      saved.coordinateSpace === 'viewport' ? saved.x * Math.max(0, viewport.width - dimensions.width) : 16 + saved.x * Math.max(0, viewport.width - dimensions.width - 32),
      saved.coordinateSpace === 'viewport' ? saved.y * Math.max(0, viewport.height - dimensions.height) : 76 + saved.y * Math.max(0, viewport.height - dimensions.height - 92), dimensions.width, dimensions.height, viewport)
      : { left: side === 'left' ? margin : Math.max(16, viewport.width - dimensions.width - margin), top: y };
    y += dimensions.height + gap;
    return { id, size, ...dimensions, ...position };
  });
}
