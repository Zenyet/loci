import { colorCss, colorHex, mixHex } from '../../services/color';
import type { Camera, GroupColor, GraphEdge, GraphNode } from "../../types";
import { FaviconCache } from "./faviconCache";
import { convexHull, inflateHull, pathSmoothBlob } from "./hull";
import type { RenderSpriteCache } from "./spriteCache";

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
  spriteCache?: RenderSpriteCache;
}

export interface Theme {
  fg: string;
  fgMuted: string;
  bg: string;
  line: string;
}

const MAX_CANVAS_DPR = 2;
const MAX_BACKING_PIXELS = 6_000_000;
// Below this scale 14px titles become <10px and mostly overlap. Keep the
// focused/hovered labels, but don't rasterize unreadable text for the overview.
const DETAIL_LABEL_SCALE = 0.7;
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
    if (this.widths.size > 5000) this.widths.delete(this.widths.keys().next().value!);
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
    if (this.ellipsis.size > 5000) this.ellipsis.delete(this.ellipsis.keys().next().value!);
    return value;
  }

  displayUrl(url: string): string {
    const cached = this.urls.get(url);
    if (cached !== undefined) return cached;

    const value = displayUrl(url);
    this.urls.set(url, value);
    if (this.urls.size > 5000) this.urls.delete(this.urls.keys().next().value!);
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
  const dpr = Math.min(rawDpr, MAX_CANVAS_DPR, budgetDpr);
  // Assigning even an unchanged size clears the canvas backing store.
  const width = Math.floor(cssWidth * dpr);
  const height = Math.floor(cssHeight * dpr);
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
  state.spriteCache?.beginFrame();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, size.width * size.dpr, size.height * size.dpr);
  applyCamera(ctx, camera, size.width, size.height, size.dpr);
  const bounds = visibleWorldBounds(camera, size, 96);
  const detail = detailForScale(camera.scale, state.nodes.length);

  // Group highlight sits behind everything so nodes + edges remain readable.
  if (state.highlightGroupId) drawGroupHighlight(ctx, state);
  if (state.showEdges !== false) drawEdges(ctx, state, state.nodeById, bounds);
  if (state.ghost) drawGhost(ctx, state.ghost, theme);
  drawNodes(ctx, state, theme, bounds, detail, camera.scale * size.dpr);
  drawLabels(ctx, state, theme, bounds, camera.scale * size.dpr, detail.labels);
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

function detailForScale(scale: number, nodeCount: number): RenderDetail {
  return {
    labels: scale >= DETAIL_LABEL_SCALE || nodeCount < 200,
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

const HOVER_EDGE_STYLE: EdgeStyle = { lineWidth: 2.5, alphaMul: 1, dash: [] };
const AUTO_EDGE_STYLE: EdgeStyle = { lineWidth: 1.3, alphaMul: 0.5, dash: [] };
const MANUAL_EDGE_STYLE: EdgeStyle = { lineWidth: 1.9, alphaMul: 0.75, dash: [] };

/** Visual weight per edge kind. Hover always wins with a solid, prominent line. */
export function edgeStyleFor(
  kind: GraphEdge["kind"],
  isHover: boolean,
): EdgeStyle {
  if (isHover) return HOVER_EDGE_STYLE;
  // Auto edges are the graph's connective web — solid and clearly visible,
  // just lighter than a user's explicit manual link.
  if (kind === "auto") return AUTO_EDGE_STYLE;
  return MANUAL_EDGE_STYLE;
}

function drawEdges(
  ctx: CanvasRenderingContext2D,
  state: RenderState,
  byId: Map<string, GraphNode>,
  bounds: WorldBounds,
): void {
  ctx.setLineDash([]);
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

    const fromHue = hueForNode(a, state.topicHueById);
    const toHue = hueForNode(b, state.topicHueById);
    if (fromHue === toHue) ctx.strokeStyle = hueString(fromHue);
    else {
      const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      grad.addColorStop(0, hueString(fromHue));
      grad.addColorStop(1, hueString(toHue));
      ctx.strokeStyle = grad;
    }
    ctx.globalAlpha = alpha;
    ctx.lineWidth = style.lineWidth;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

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

/** A glass tile and a continuous, softly bevelled folder, in radius units. */
function drawFolderTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  hue: GroupColor,
  isDark: boolean,
): void {
  const custom = typeof hue === 'string';
  const base = colorHex(hue);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(radius, radius);

  // Milky tinted glass; the fine rim stays legible over a wallpaper.
  const tile = ctx.createLinearGradient(-.6, -.88, .5, .88);
  tile.addColorStop(0, custom
    ? mixHex(hue, isDark ? 0 : 255, isDark ? .58 : .94)
    : hueString(hue, isDark ? 42 : 98, .025));
  tile.addColorStop(1, custom
    ? mixHex(hue, isDark ? 0 : 255, isDark ? .78 : .78)
    : hueString(hue, isDark ? 29 : 89, .06));
  ctx.shadowColor = isDark ? 'rgba(0,0,0,.3)' : 'rgba(31,46,69,.2)';
  ctx.shadowBlur = radius * .42;
  ctx.shadowOffsetY = radius * .16;
  ctx.fillStyle = tile;
  ctx.beginPath();
  ctx.roundRect(-.88, -.88, 1.76, 1.76, .43);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  ctx.save();
  ctx.clip();
  const glow = ctx.createRadialGradient(-.36, -.68, 0, -.24, -.44, 1.5);
  glow.addColorStop(0, isDark ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.45)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(-.88, -.88, 1.76, 1.76);

  const reflection = ctx.createLinearGradient(0, -.88, 0, .55);
  reflection.addColorStop(0, isDark ? 'rgba(255,255,255,.1)' : 'rgba(255,255,255,.28)');
  reflection.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = reflection;
  ctx.beginPath();
  ctx.moveTo(.47, -.88);
  ctx.lineTo(.94, -.88);
  ctx.lineTo(.03, .53);
  ctx.lineTo(-.45, .53);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  const rim = ctx.createLinearGradient(0, -.88, 0, .88);
  rim.addColorStop(0, isDark ? 'rgba(255,255,255,.38)' : 'rgba(255,255,255,.98)');
  rim.addColorStop(.55, isDark ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.5)');
  rim.addColorStop(1, isDark ? 'rgba(255,255,255,.24)' : 'rgba(255,255,255,.86)');
  ctx.strokeStyle = rim;
  ctx.lineWidth = .025;
  ctx.beginPath();
  ctx.roundRect(-.865, -.865, 1.73, 1.73, .42);
  ctx.stroke();

  // The tab flows into the rear panel, instead of looking like a separate block.
  const rear = ctx.createLinearGradient(0, -.44, 0, .47);
  rear.addColorStop(0, custom ? mixHex(hue, 255, .13) : hueString(hue, 72, .15));
  if (custom) rear.addColorStop(.25, hue);
  rear.addColorStop(1, custom ? mixHex(hue, 0, .16) : hueString(hue, 58, .16));
  ctx.fillStyle = rear;
  ctx.beginPath();
  ctx.moveTo(-.57, .3);
  ctx.lineTo(-.57, -.32);
  ctx.quadraticCurveTo(-.57, -.44, -.45, -.44);
  ctx.lineTo(-.17, -.44);
  ctx.quadraticCurveTo(-.07, -.44, -.045, -.34);
  ctx.quadraticCurveTo(-.03, -.26, .045, -.26);
  ctx.lineTo(.42, -.26);
  ctx.quadraticCurveTo(.58, -.26, .58, -.1);
  ctx.lineTo(.58, .3);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = isDark ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.32)';
  ctx.lineWidth = .02;
  ctx.stroke();

  // Rounded front cover: a luminous top edge, saturated foot and colored shadow.
  const front = ctx.createLinearGradient(-.24, -.26, .22, .5);
  front.addColorStop(0, custom ? mixHex(hue, 255, .56) : hueString(hue, 88, .075));
  front.addColorStop(.45, custom ? mixHex(hue, 255, .22) : hueString(hue, 79, .12));
  front.addColorStop(1, custom ? hue : hueString(hue, 72, .15));
  ctx.shadowColor = `${base}${isDark ? '55' : '60'}`;
  ctx.shadowBlur = radius * .3;
  ctx.shadowOffsetY = radius * .16;
  ctx.fillStyle = front;
  ctx.beginPath();
  ctx.roundRect(-.59, -.255, 1.18, .765, .17);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  const bevel = ctx.createLinearGradient(0, -.255, 0, .51);
  bevel.addColorStop(0, 'rgba(255,255,255,.8)');
  bevel.addColorStop(.4, 'rgba(255,255,255,.18)');
  bevel.addColorStop(1, `${base}25`);
  ctx.strokeStyle = bevel;
  ctx.lineWidth = .022;
  ctx.stroke();
  ctx.restore();
}

function drawFolderBadge(
  ctx: CanvasRenderingContext2D,
  n: GraphNode,
  state: RenderState,
  isDark: boolean,
): void {
  const half = n.radius;
  const hue = hueForNode(n, state.topicHueById);
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

function drawBookmarkNode(
  ctx: CanvasRenderingContext2D,
  n: GraphNode,
  state: RenderState,
  detail: RenderDetail,
  img: HTMLImageElement | null,
  alpha: number,
): void {
  const half = n.radius;
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
}

function drawNodes(
  ctx: CanvasRenderingContext2D,
  state: RenderState,
  theme: Theme,
  bounds: WorldBounds,
  detail: RenderDetail,
  pixelScale: number,
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
      const extent = half * 1.55;
      const cached = state.spriteCache?.draw(ctx, `folder|${half}|${hue}|${isDark}`,
        n.x, n.y, { x: -extent, y: -extent, width: extent * 2, height: extent * 2 }, pixelScale,
        target => drawFolderTile(target, 0, 0, half, hue, isDark));
      if (!cached) drawFolderTile(ctx, n.x, n.y, half, hue, isDark);
      if (detail.labels) {
        const count = String(n.bookmarkCount ?? 0);
        ctx.font = '500 12px -apple-system, BlinkMacSystemFont, sans-serif';
        const width = Math.max(21, state.textCache.width(ctx, count) + 10) + 16;
        const badgeX = half * .74, badgeY = -half * .74;
        const badge = state.spriteCache?.draw(ctx, `badge|${hue}|${isDark}|${count}`,
          n.x + badgeX, n.y + badgeY, { x: -width / 2, y: -19, width, height: 40 }, pixelScale,
          target => drawFolderBadge(target, { ...n, x: -badgeX, y: -badgeY }, state, isDark));
        if (!badge) drawFolderBadge(ctx, n, state, isDark);
      }
      ctx.restore();
      continue;
    }

    // Bookmark node: the favicon IS the node — no frame, no disc. A soft drop
    // shadow lifts it off the canvas; the site's own icon colors carry it.
    const img = detail.favicons ? state.favicons.get(n.url) : null;
    ctx.globalAlpha = alpha;
    const extent = half * 1.6;
    const iconKey = img ? `image|${state.spriteCache?.sourceId(img)}` : `avatar|${n.url}|${n.letter}`;
    const cached = state.spriteCache?.draw(ctx, `${iconKey}|${half}`, n.x, n.y,
      { x: -extent, y: -extent, width: extent * 2, height: extent * 2 }, pixelScale,
      target => drawBookmarkNode(target, { ...n, x: 0, y: 0 }, state, detail, img, 1));
    if (!cached) drawBookmarkNode(ctx, n, state, detail, img, alpha);

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

function drawLabelPlate(
  ctx: CanvasRenderingContext2D,
  material: ReturnType<typeof labelMaterial>,
  x: number, y: number, width: number, height: number,
): void {
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
}

function drawLabels(
  ctx: CanvasRenderingContext2D,
  state: RenderState,
  theme: Theme,
  bounds: WorldBounds,
  pixelScale: number,
  showAll: boolean,
): void {
  const material = labelMaterial(theme.bg);
  for (const n of state.nodes) {
    if (!showAll && n.id !== state.hoverNodeId && n.id !== state.draggingId &&
        !state.filterMatches?.has(n.id) && !state.focusNeighborhood?.has(n.id)) continue;
    if (!nodeIntersects(n, bounds, 180)) continue;
    const isGroup = n.nodeKind === "group";
    const maxWidth = isGroup ? 140 : 170;
    const y = n.y + n.radius + 7;
    ctx.globalAlpha = nodeAlpha(state, n.id);
    ctx.font = '400 14px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    const title = state.textCache.ellipsize(ctx, n.name, maxWidth);
    const titleWidth = state.textCache.width(ctx, title);
    let sub = '';
    let subWidth = 0;
    if (!isGroup && n.id === state.hoverNodeId) {
      ctx.font = '400 11px -apple-system, BlinkMacSystemFont, sans-serif';
      sub = state.textCache.ellipsize(ctx, state.textCache.displayUrl(n.url), maxWidth);
      subWidth = state.textCache.width(ctx, sub);
    }
    const paint = (target: CanvasRenderingContext2D, x = 0, top = 0) => {
      target.textAlign = 'center';
      target.textBaseline = 'top';
      target.font = '400 14px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
      drawLabelPlate(target, material, x, top, titleWidth + 14, 23);
      target.fillStyle = material.foreground;
      target.fillText(title, x, top);
      if (sub) {
        target.font = '400 11px -apple-system, BlinkMacSystemFont, sans-serif';
        drawLabelPlate(target, material, x, top + 26, subWidth + 12, 20);
        target.fillStyle = material.secondary;
        target.fillText(sub, x, top + 26);
      }
    };
    const width = Math.max(titleWidth + 14, subWidth + 12) + 16;
    const cached = state.spriteCache?.draw(ctx, `label|${material.background}|${title}|${sub}`,
      n.x, y, { x: -width / 2, y: -12, width, height: sub ? 66 : 40 }, pixelScale, paint);
    if (!cached) paint(ctx, n.x, y);
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
