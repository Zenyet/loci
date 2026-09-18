import { colorCss, mixHex } from '../../services/color';
import type { Camera, GroupColor, GraphEdge, GraphNode } from "../../types";
import { FaviconCache } from "./faviconCache";
import { convexHull, inflateHull, pathSmoothBlob } from "./hull";

export interface RenderState {
  nodes: GraphNode[];
  nodeById: Map<string, GraphNode>;
  edges: GraphEdge[];
  pins: Record<string, { x: number; y: number }>;
  hoverNodeId: string | null;
  hoverEdgeId: string | null;
  draggingId: string | null;
  /** Set of node ids that match current filter; null = no filter active. */
  filterMatches: Set<string> | null;
  /** Source node + live cursor position while shift-drag is building an edge. */
  ghost: { fromX: number; fromY: number; toX: number; toY: number } | null;
  favicons: FaviconCache;
  /** When set, draw a soft hull behind all nodes whose parentId equals this. */
  highlightGroupId: string | null;
  /** Optional explicit node set for hulls that include descendant folders. */
  highlightGroupMembers?: Set<string> | null;
  highlightGroupHue?: GroupColor | null;
  /** Local-graph mode: when set, only nodes in this set render at full
   *  opacity and only edges with both endpoints inside it are drawn. */
  focusNeighborhood: Set<string> | null;
  focusKind: "node" | "group" | null;
  /** id → topic hue; overrides groupHue when present. Null = no AI topics. */
  topicHueById?: Map<string, number> | null;
  /** Master toggle: when false, no edges are drawn. Defaults to true. */
  showEdges?: boolean;
  /** 0→1 eased progress of the hover/drag spotlight. Drives the focused
   *  node's grow animation and how much surrounding nodes dim. Defaults to 0. */
  hoverProgress?: number;
  nodeOpacity?: ReadonlyMap<string, number>;
  textCache: RenderTextCache;
}

export interface Theme {
  fg: string;
  fgMuted: string;
  bg: string;
  line: string;
}

const MAX_CANVAS_DPR = 2;
const MAX_BACKING_PIXELS = 6_000_000;
const DETAIL_LABEL_SCALE = 0.3;
const DETAIL_URL_SCALE = 0.82; // retained for detail struct; subtitle now hover-driven
const DETAIL_FAVICON_SCALE = 0.3;
const DETAIL_MONOGRAM_SCALE = 0.3;

interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface RenderDetail {
  labels: boolean;
  urls: boolean;
  favicons: boolean;
  monograms: boolean;
}

export class RenderTextCache {
  private ellipsis = new Map<string, string>();
  private urls = new Map<string, string>();
  private widths = new Map<string, number>();

  width(ctx: CanvasRenderingContext2D, text: string): number {
    const key = `${ctx.font}|${text}`;
    const cached = this.widths.get(key);
    if (cached !== undefined) return cached;
    const width = ctx.measureText(text).width;
    this.widths.set(key, width);
    if (this.widths.size > 5000) this.widths.clear();
    return width;
  }

  ellipsize(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number,
  ): string {
    const key = `${ctx.font}|${maxWidth}|${text}`;
    const cached = this.ellipsis.get(key);
    if (cached !== undefined) return cached;

    const value = ellipsizeMeasured(ctx, text, maxWidth);
    this.ellipsis.set(key, value);
    if (this.ellipsis.size > 5000) this.ellipsis.clear();
    return value;
  }

  displayUrl(url: string): string {
    const cached = this.urls.get(url);
    if (cached !== undefined) return cached;

    const value = displayUrl(url);
    this.urls.set(url, value);
    if (this.urls.size > 5000) this.urls.clear();
    return value;
  }
}

export function resizeCanvas(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
): number {
  const rawDpr = window.devicePixelRatio || 1;
  const cssPixels = Math.max(1, cssWidth * cssHeight);
  const budgetDpr = Math.sqrt(MAX_BACKING_PIXELS / cssPixels);
  const dpr = Math.max(1, Math.min(rawDpr, MAX_CANVAS_DPR, budgetDpr));
  // Assigning even an unchanged size clears the canvas backing store.
  const width = Math.round(cssWidth * dpr);
  const height = Math.round(cssHeight * dpr);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  return dpr;
}

export function applyCamera(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(cssWidth / 2 + camera.tx, cssHeight / 2 + camera.ty);
  ctx.scale(camera.scale, camera.scale);
}

export function drawGraph(
  ctx: CanvasRenderingContext2D,
  state: RenderState,
  camera: Camera,
  theme: Theme,
  size: { width: number; height: number; dpr: number },
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, size.width * size.dpr, size.height * size.dpr);
  applyCamera(ctx, camera, size.width, size.height, size.dpr);
  const bounds = visibleWorldBounds(camera, size, 96);
  const detail = detailForScale(camera.scale);

  // Group highlight sits behind everything so nodes + edges remain readable.
  if (state.highlightGroupId) drawGroupHighlight(ctx, state);
  if (state.showEdges !== false) drawEdges(ctx, state, state.nodeById, bounds);
  if (state.ghost) drawGhost(ctx, state.ghost, theme);
  drawNodes(ctx, state, theme, bounds, detail);
  if (detail.labels) drawLabels(ctx, state, theme, bounds);
}

function visibleWorldBounds(
  camera: Camera,
  size: { width: number; height: number },
  padPx: number,
): WorldBounds {
  const inv = 1 / camera.scale;
  const pad = padPx * inv;
  return {
    minX: (-size.width / 2 - camera.tx) * inv - pad,
    maxX: (size.width / 2 - camera.tx) * inv + pad,
    minY: (-size.height / 2 - camera.ty) * inv - pad,
    maxY: (size.height / 2 - camera.ty) * inv + pad,
  };
}

function detailForScale(scale: number): RenderDetail {
  return {
    labels: scale >= DETAIL_LABEL_SCALE,
    urls: scale >= DETAIL_URL_SCALE,
    favicons: scale >= DETAIL_FAVICON_SCALE,
    monograms: scale >= DETAIL_MONOGRAM_SCALE,
  };
}

function nodeIntersects(n: GraphNode, bounds: WorldBounds, pad = 0): boolean {
  const r = n.radius + pad;
  return (
    n.x + r >= bounds.minX &&
    n.x - r <= bounds.maxX &&
    n.y + r >= bounds.minY &&
    n.y - r <= bounds.maxY
  );
}

function segmentIntersectsBounds(
  a: GraphNode,
  b: GraphNode,
  bounds: WorldBounds,
  pad = 0,
): boolean {
  return (
    Math.max(a.x, b.x) + pad >= bounds.minX &&
    Math.min(a.x, b.x) - pad <= bounds.maxX &&
    Math.max(a.y, b.y) + pad >= bounds.minY &&
    Math.min(a.y, b.y) - pad <= bounds.maxY
  );
}

/**
 * Soft, translucent "blob" behind the nodes of a group — makes the group's
 * spatial extent obvious while editing it in the Groups panel.
 */
function drawGroupHighlight(
  ctx: CanvasRenderingContext2D,
  state: RenderState,
): void {
  const id = state.highlightGroupId!;
  const members = state.highlightGroupMembers
    ? state.nodes.filter((n) => state.highlightGroupMembers!.has(n.id))
    : state.nodes.filter((n) => n.parentId === id);
  if (members.length === 0) return;

  const hue = state.highlightGroupHue ?? members[0]!.groupHue;
  const padding = 36 + (members[0]!.radius ?? 14);

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  if (members.length === 1) {
    // Single node: draw a halo circle around it.
    const n = members[0]!;
    const r = n.radius + padding;
    ctx.fillStyle = hueString(hue, 75, 0.14) + "";
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = hueString(hue, 82, 0.18);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
    return;
  }

  const hull = convexHull(members.map((n) => ({ x: n.x, y: n.y })));
  const inflated = inflateHull(hull, padding);

  // Fill.
  ctx.beginPath();
  pathSmoothBlob(ctx, inflated);
  ctx.closePath();
  ctx.fillStyle = hueString(hue, 75, 0.14);
  ctx.globalAlpha = 0.22;
  ctx.fill();

  // Soft stroke.
  ctx.beginPath();
  pathSmoothBlob(ctx, inflated);
  ctx.closePath();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = hueString(hue, 82, 0.2);
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.restore();
}

function alphaFor(
  nodeId: string,
  filter: Set<string> | null,
  focus: Set<string> | null,
): number {
  // Focus mode dominates: out-of-neighborhood nodes are heavily faded so the
  // sub-graph reads as foreground. Filter dim layers on top.
  let a = 1;
  if (focus && !focus.has(nodeId)) a = Math.min(a, 0.08);
  if (filter && !filter.has(nodeId)) a = Math.min(a, 0.15);
  return a;
}

function hueString(h: GroupColor, l = 70, c = 0.17): string {
  return colorCss(h, l / 100, c);
}

function nodeAlpha(state: RenderState, id: string): number {
  return alphaFor(id, state.filterMatches, state.focusNeighborhood) * (state.nodeOpacity?.get(id) ?? 1);
}

export function hueForNode(
  n: { id: string; groupHue: GroupColor },
  topicHueById: Map<string, number> | null | undefined,
): GroupColor {
  const t = topicHueById?.get(n.id);
  return t == null ? n.groupHue : t;
}

/** Deterministic per-site avatar color (used when no favicon is available). */
export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `oklch(0.55 0.15 ${hue})`;
}

/** Read the L channel from an `oklch(L C H)` string; defaults to 1 if unparsed. */
export function oklchLightness(color: string): number {
  const m = /oklch\(\s*([0-9.]+)/i.exec(color);
  return m ? parseFloat(m[1]!) : 1;
}

export interface EdgeStyle {
  lineWidth: number;
  alphaMul: number;
  dash: number[];
}

/** Visual weight per edge kind. Hover always wins with a solid, prominent line. */
export function edgeStyleFor(
  kind: GraphEdge["kind"],
  isHover: boolean,
): EdgeStyle {
  if (isHover) return { lineWidth: 2.5, alphaMul: 1, dash: [] };
  // Auto edges are the graph's connective web — solid and clearly visible,
  // just lighter than a user's explicit manual link.
  if (kind === "auto") return { lineWidth: 1.3, alphaMul: 0.5, dash: [] };
  return { lineWidth: 1.9, alphaMul: 0.75, dash: [] };
}

function drawEdges(
  ctx: CanvasRenderingContext2D,
  state: RenderState,
  byId: Map<string, GraphNode>,
  bounds: WorldBounds,
): void {
  for (const e of state.edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) continue;
    if (!segmentIntersectsBounds(a, b, bounds, 48)) continue;
    // In focus mode, hide edges that leave the neighborhood — they only
    // create visual noise and would tether the foreground graph to faded
    // background nodes.
    if (state.focusNeighborhood) {
      if (
        !state.focusNeighborhood.has(a.id) ||
        !state.focusNeighborhood.has(b.id)
      )
        continue;
    }
    const isHover = state.hoverEdgeId === e.id;
    const aAlpha = nodeAlpha(state, a.id);
    const bAlpha = nodeAlpha(state, b.id);
    const style = edgeStyleFor(e.kind, isHover);
    const alpha = Math.sqrt(aAlpha * bAlpha) * style.alphaMul;

    const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    grad.addColorStop(0, hueString(hueForNode(a, state.topicHueById)));
    grad.addColorStop(1, hueString(hueForNode(b, state.topicHueById)));
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = grad;
    ctx.lineWidth = style.lineWidth;
    ctx.setLineDash(style.dash);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);

    if (isHover && e.label) {
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      ctx.globalAlpha = 1;
      ctx.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillStyle = hueString(a.groupHue, 85, 0.08);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(e.label, mx, my - 8);
    }
  }
  ctx.globalAlpha = 1;
}

function drawGhost(
  ctx: CanvasRenderingContext2D,
  g: NonNullable<RenderState["ghost"]>,
  theme: Theme,
): void {
  ctx.save();
  ctx.strokeStyle = theme.fgMuted;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(g.fromX, g.fromY);
  ctx.lineTo(g.toX, g.toY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/** Trace a circular node path centered at (cx, cy). */
function traceDisc(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
}

/**
 * No-favicon fallback: a brand-colored disc + white initial, floated by a
 * soft drop shadow so it sits consistently with favicon-hero nodes.
 */
function drawNodeAvatar(
  ctx: CanvasRenderingContext2D,
  n: GraphNode,
  half: number,
  alpha: number,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = "oklch(0 0 0 / 0.28)";
  ctx.shadowBlur = half * 0.55;
  ctx.shadowOffsetY = half * 0.16;
  ctx.fillStyle = avatarColor(n.url);
  traceDisc(ctx, n.x, n.y, half);
  ctx.fill();
  ctx.restore();

  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#fff";
  ctx.font = `400 ${Math.round(half * 0.9)}px -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(n.letter, n.x, n.y + 1);
}

function drawNodes(
  ctx: CanvasRenderingContext2D,
  state: RenderState,
  theme: Theme,
  bounds: WorldBounds,
  detail: RenderDetail,
): void {
  const isDark = oklchLightness(theme.bg) < 0.5;
  for (const n of state.nodes) {
    if (!nodeIntersects(n, bounds, 8)) continue;
    const alpha = nodeAlpha(state, n.id);
    const isPinned = Object.prototype.hasOwnProperty.call(state.pins, n.id);
    const isGroup = n.nodeKind === "group";
    const half = n.radius;

    // Folder tiles sit inside the existing circular hit area.
    if (isGroup) {
      const hue = hueForNode(n, state.topicHueById);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = "oklch(0 0 0 / 0.16)";
      ctx.shadowBlur = half * 0.45;
      ctx.shadowOffsetY = half * 0.16;
      const tile = ctx.createLinearGradient(n.x, n.y - half, n.x, n.y + half);
      tile.addColorStop(0, typeof hue === 'string' ? mixHex(hue, isDark ? 0 : 255, isDark ? .75 : .93) : hueString(hue, isDark ? 42 : 97, 0.025));
      tile.addColorStop(1, typeof hue === 'string' ? mixHex(hue, isDark ? 0 : 255, isDark ? .84 : .82) : hueString(hue, isDark ? 31 : 89, 0.04));
      ctx.fillStyle = tile;
      ctx.beginPath();
      ctx.roundRect(
        n.x - half * 0.88,
        n.y - half * 0.88,
        half * 1.76,
        half * 1.76,
        half * 0.46,
      );
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.strokeStyle = isDark
        ? "rgba(255,255,255,.16)"
        : "rgba(255,255,255,.8)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = hueString(hue, isDark ? 64 : 62, 0.14);
      ctx.beginPath();
      ctx.roundRect(
        n.x - half * 0.52,
        n.y - half * 0.38,
        half * 0.5,
        half * 0.28,
        half * 0.09,
      );
      ctx.fill();
      const folder = ctx.createLinearGradient(
        n.x,
        n.y - half * 0.2,
        n.x,
        n.y + half * 0.4,
      );
      folder.addColorStop(0, typeof hue === 'string' ? mixHex(hue, 255, .12) : hueString(hue, isDark ? 76 : 77, 0.12));
      if (typeof hue === 'string') folder.addColorStop(.25, hue);
      folder.addColorStop(1, typeof hue === 'string' ? mixHex(hue, 0, .1) : hueString(hue, isDark ? 63 : 64, 0.16));
      ctx.fillStyle = folder;
      ctx.beginPath();
      ctx.roundRect(
        n.x - half * 0.55,
        n.y - half * 0.22,
        half * 1.1,
        half * 0.72,
        half * 0.12,
      );
      ctx.fill();

      if (detail.labels) {
        const count = String(n.bookmarkCount ?? 0);
        const badgeX = n.x + half * 0.74;
        const badgeY = n.y - half * 0.74;
        const badgeHeight = 21;
        ctx.font = '500 12px -apple-system, BlinkMacSystemFont, sans-serif';
        const badgeWidth = Math.max(badgeHeight, state.textCache.width(ctx, count) + 10);
        // A quiet notification-style badge: circular for one digit, a capsule
        // for larger totals. Keep the exact count rather than truncating it.
        ctx.shadowColor = 'rgba(0,0,0,.16)';
        ctx.shadowBlur = 5;
        ctx.shadowOffsetY = 1;
        ctx.fillStyle = typeof hue === 'string' ? mixHex(hue, isDark ? 255 : 0, .8) : hueString(hue, isDark ? 87 : 37, 0.035);
        ctx.beginPath();
        ctx.roundRect(badgeX - badgeWidth / 2, badgeY - badgeHeight / 2, badgeWidth, badgeHeight, badgeHeight / 2);
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        ctx.strokeStyle = isDark ? 'rgba(38,40,46,.9)' : 'rgba(255,254,252,.95)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = isDark ? '#242830' : '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(count, badgeX, badgeY + .5);
      }
      ctx.restore();
      continue;
    }

    // Bookmark node: the favicon IS the node — no frame, no disc. A soft drop
    // shadow lifts it off the canvas; the site's own icon colors carry it.
    const img = detail.favicons ? state.favicons.get(n.url) : null;
    if (img) {
      const s = half * 1.75; // large and clear, constant size
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = "oklch(0 0 0 / 0.3)";
      ctx.shadowBlur = half * 0.6;
      ctx.shadowOffsetY = half * 0.18;
      try {
        ctx.drawImage(img, n.x - s / 2, n.y - s / 2, s, s);
        ctx.restore();
      } catch {
        ctx.restore();
        state.favicons.markBroken(n.url);
        if (detail.monograms) drawNodeAvatar(ctx, n, half, alpha);
      }
    } else if (detail.monograms) {
      drawNodeAvatar(ctx, n, half, alpha);
    }

    // Pin indicator: small group-hue dot at the top-right.
    if (isPinned) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = hueString(hueForNode(n, state.topicHueById), 80);
      const d = half * 0.7071; // half / sqrt(2) — 45° on the circle
      ctx.beginPath();
      ctx.arc(n.x + d, n.y - d, Math.max(2.5, half * 0.22), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function drawLabels(
  ctx: CanvasRenderingContext2D,
  state: RenderState,
  theme: Theme,
  bounds: WorldBounds,
): void {
  const material = labelMaterial(theme.bg);
  const drawPlate = (x: number, y: number, width: number, height: number) => {
    ctx.shadowColor = 'rgba(0,0,0,.08)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = material.background;
    ctx.beginPath();
    ctx.roundRect(x - width / 2, y - 4, width, height, 7);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = material.border;
    ctx.lineWidth = .7;
    ctx.stroke();
  };
  for (const n of state.nodes) {
    if (!nodeIntersects(n, bounds, 180)) continue;
    const isGroup = n.nodeKind === "group";
    const alpha = nodeAlpha(state, n.id);
    const maxWidth = isGroup ? 140 : 170;
    const y = n.y + n.radius + 7;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    // A bounded translucent surface gives normal-weight text a predictable
    // local background, without sampling images or blurring on every frame.
    ctx.font = '400 14px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    const title = state.textCache.ellipsize(ctx, n.name, maxWidth);
    const titleWidth = state.textCache.width(ctx, title);
    drawPlate(n.x, y, titleWidth + 14, 23);
    ctx.fillStyle = material.foreground;
    ctx.fillText(title, n.x, y);

    // Domain subtitle: only for the hovered bookmark, to avoid clutter.
    if (!isGroup && n.id === state.hoverNodeId) {
      const uy = y + 26;
      ctx.font = '400 11px -apple-system, BlinkMacSystemFont, sans-serif';
      const sub = state.textCache.ellipsize(
        ctx,
        state.textCache.displayUrl(n.url),
        maxWidth,
      );
      drawPlate(n.x, uy, state.textCache.width(ctx, sub) + 12, 20);
      ctx.fillStyle = material.secondary;
      ctx.fillText(sub, n.x, uy);
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

export function labelMaterial(background: string) {
  return oklchLightness(background) < 0.5
    ? { background: 'rgba(25,28,34,.88)', foreground: '#f5f5f7', secondary: '#d6d8de', border: 'rgba(255,255,255,.12)' }
    : { background: 'rgba(255,254,252,.88)', foreground: '#262b33', secondary: '#4b535e', border: 'rgba(255,255,255,.8)' };
}

function displayUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
    return `${host}${path}`;
  } catch {
    return url;
  }
}

function ellipsizeMeasured(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}
