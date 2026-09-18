# 图谱节点与连线视觉重做 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把书签图谱的节点做大、favicon 当主角、站名常驻且任意背景下清晰可读，并在相关站点（同站点群 / 同主域名）之间画出有含义、可一键开关的连线。

**Architecture:** 全部改在 Canvas 渲染层与少量数据/设置层。节点尺寸在力导向 hook `useGraphSimCustom` 调大；favicon / 标签 / 连线画法在 `render.ts` 重做；自动连线由新模块 `autoEdges.ts` 从当前书签**派生**（不落库，书签变化即跟随），仅用于显示、不可交互；手动连线、力导向、相机、命中测试、搜索聚焦、右键菜单、Chrome 读写全部保留。新增 `Settings.showEdges` 总开关。

**Tech Stack:** React 18 + TypeScript + Vite + Canvas 2D；测试用 Vitest。

> 关联 spec：`docs/superpowers/specs/2026-05-29-graph-node-edge-redesign-design.md`

---

## File Structure

| 文件 | 责任 | 改动类型 |
| ---- | ---- | -------- |
| `src/types.ts` | `GraphEdge.kind` 增加 `'auto'`；`Settings` 增加 `showEdges`；`DEFAULT_SETTINGS` 同步 | 修改 |
| `src/i18n.ts` | 新增 `tweaks.showEdges` / `showEdgesHint` 文案 | 修改 |
| `src/designs/Graph/sim/useGraphSimCustom.ts` | `radiusFor` 导出并调大节点半径 | 修改 |
| `src/designs/Graph/sim/useGraphSimCustom.test.ts` | `radiusFor` 单测 | 新建 |
| `src/services/chromeApi.ts` | `faviconCandidates` 改为优先取高清图标 | 修改 |
| `src/services/chromeApi.test.ts` | `faviconCandidates` 顺序单测 | 新建 |
| `src/designs/Graph/relationSuggest.ts` | 导出 `hostOf` 供 `autoEdges` 复用 | 修改 |
| `src/designs/Graph/autoEdges.ts` | 从书签派生「同站点群星形 + 同主域名星形」自动连线 | 新建 |
| `src/designs/Graph/autoEdges.test.ts` | `computeAutoEdges` / `baseDomain` 单测 | 新建 |
| `src/designs/Graph/render.ts` | favicon 主角化、monogram 降级兜底、标签字号+halo、URL 改 hover、自动/手动线分样式、`showEdges` 跳过、`edgeStyleFor` 抽取、显示阈值 | 修改 |
| `src/designs/Graph/render.test.ts` | `edgeStyleFor` 单测 | 修改 |
| `src/designs/Graph/GraphCanvas.tsx` | 新增 `autoEdges` / `showEdges` props，渲染时合并连线并按开关跳过 | 修改 |
| `src/designs/Graph/Graph.tsx` | 计算 `autoEdges` 并连同 `showEdges` 传给 `GraphCanvas` | 修改 |
| `src/components/Tweaks.tsx` | 设置面板加「连线」开关行 | 修改 |

每个任务自成一体、可独立编译与提交。

---

## Task 1: 数据与设置层 —— `GraphEdge.kind` + `Settings.showEdges` + 文案

**Files:**
- Modify: `src/types.ts:115-121`（`GraphEdge`）、`src/types.ts:67-104`（`Settings` + `DEFAULT_SETTINGS`）
- Modify: `src/i18n.ts:38-39`（在 `showStrip` 文案后追加）
- Test: `src/services/chromeApi.test.ts`（新建，验证默认值经 `normalizeSettings` 后含 `showEdges`）

- [ ] **Step 1: 写失败测试**

新建 `src/services/chromeApi.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../types';

describe('DEFAULT_SETTINGS.showEdges', () => {
  it('defaults edge drawing to on', () => {
    expect(DEFAULT_SETTINGS.showEdges).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/services/chromeApi.test.ts`
Expected: FAIL —— `Object literal ... showEdges` 不存在 / 值为 `undefined`。

- [ ] **Step 3: 修改 `GraphEdge` 类型**

`src/types.ts`，把：

```ts
export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: 'manual';
  label?: string;
}
```

改为：

```ts
export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  /** 'manual' = 用户 Shift 拖拽建立、可右键删除；'auto' = 从书签派生、仅显示。 */
  kind: 'manual' | 'auto';
  label?: string;
}
```

- [ ] **Step 4: 给 `Settings` 增加 `showEdges`**

`src/types.ts` 的 `Settings` 接口，在 `showStrip` 字段后追加：

```ts
  /** Draw relationship edges (same host cluster / same domain) between sites. */
  showEdges: boolean;
```

并在 `DEFAULT_SETTINGS` 中（`showStrip: true,` 后）追加：

```ts
  showEdges: true,
```

- [ ] **Step 5: 增加 i18n 文案**

`src/i18n.ts`，在：

```ts
    showStrip: '底部常用栏',
    showStripHint: '显示常用和最近访问的浮层。',
```

后追加：

```ts
    showEdges: '连线',
    showEdgesHint: '在相关站点之间显示连线（同类 / 同域名）。',
```

- [ ] **Step 6: 运行测试确认通过 + 类型检查**

Run: `npx vitest run src/services/chromeApi.test.ts && npm run typecheck`
Expected: PASS；typecheck 无报错。

- [ ] **Step 7: 提交**

```bash
git add src/types.ts src/i18n.ts src/services/chromeApi.test.ts
git commit -m "feat(graph): add edge 'auto' kind, showEdges setting, edge toggle copy"
```

---

## Task 2: 节点半径调大（`radiusFor`）

**Files:**
- Modify: `src/designs/Graph/sim/useGraphSimCustom.ts:20-23`
- Test: `src/designs/Graph/sim/useGraphSimCustom.test.ts`（新建）

目标：书签节点直径约 48–64px（半径 24–32），分组节点半径 30–40。

- [ ] **Step 1: 写失败测试**

新建 `src/designs/Graph/sim/useGraphSimCustom.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { radiusFor } from './useGraphSimCustom';

describe('radiusFor', () => {
  it('gives bookmarks a large readable base radius', () => {
    expect(radiusFor(0, 'bookmark')).toBe(24);
  });

  it('grows bookmark radius slowly with visits and caps it', () => {
    expect(radiusFor(100, 'bookmark')).toBe(31); // 24 + sqrt(100)*0.7 = 31
    expect(radiusFor(1_000_000, 'bookmark')).toBe(32); // capped at 24 + 8
  });

  it('makes group nodes larger than bookmarks and caps them', () => {
    expect(radiusFor(1_000_000, 'group')).toBe(40); // capped at 30 + 10
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/designs/Graph/sim/useGraphSimCustom.test.ts`
Expected: FAIL —— `radiusFor` 未导出 / 旧数值不匹配。

- [ ] **Step 3: 导出并调大 `radiusFor`**

`src/designs/Graph/sim/useGraphSimCustom.ts`，把：

```ts
function radiusFor(visits: number, kind: GraphNode['nodeKind']): number {
  if (kind === 'group') return 18 + Math.min(10, Math.sqrt(Math.max(1, visits)) * 1.2);
  return 11 + Math.min(13, Math.sqrt(Math.max(0, visits)) * 0.9);
}
```

改为：

```ts
export function radiusFor(visits: number, kind: GraphNode['nodeKind']): number {
  if (kind === 'group') return 30 + Math.min(10, Math.sqrt(Math.max(1, visits)) * 1.2);
  return 24 + Math.min(8, Math.sqrt(Math.max(0, visits)) * 0.7);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/designs/Graph/sim/useGraphSimCustom.test.ts`
Expected: PASS（3 个用例）。

- [ ] **Step 5: 提交**

```bash
git add src/designs/Graph/sim/useGraphSimCustom.ts src/designs/Graph/sim/useGraphSimCustom.test.ts
git commit -m "feat(graph): enlarge node radii for legibility (bookmarks 24-32, groups 30-40)"
```

---

## Task 3: favicon 取高清图标源

**Files:**
- Modify: `src/services/chromeApi.ts:411-423`（`faviconCandidates`）
- Test: `src/services/chromeApi.test.ts`（追加用例）

说明：当前候选顺序是 `favicon.ico → favicon.png → apple-touch-icon.png`。`.ico` 常为 16/32px，放进直径 48–64 的节点会糊。改为**优先 `apple-touch-icon.png`（通常 180px）**，缩小绘制更清晰；`.ico` 退为最后兜底。`faviconCache` 的 `MAX_FAVICON_SIDE`（192）已能容纳 180px，无需改动。不引入第三方 favicon 服务（保持隐私，不向外部域名发送站点列表）。

- [ ] **Step 1: 写失败测试**

在 `src/services/chromeApi.test.ts` 顶部 import 追加 `faviconCandidates`，并新增 describe：

```ts
import { DEFAULT_SETTINGS } from '../types';
import { faviconCandidates } from './chromeApi';

describe('faviconCandidates', () => {
  it('prefers the high-res apple-touch-icon first, .ico last', () => {
    expect(faviconCandidates('https://example.com')).toEqual([
      'https://example.com/apple-touch-icon.png',
      'https://example.com/favicon.png',
      'https://example.com/favicon.ico',
    ]);
  });

  it('tolerates a bare host without scheme', () => {
    expect(faviconCandidates('example.com')[0]).toBe(
      'https://example.com/apple-touch-icon.png'
    );
  });

  it('returns [] for an unparseable url', () => {
    expect(faviconCandidates('http://')).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/services/chromeApi.test.ts`
Expected: FAIL —— 顺序仍是旧的 `.ico` 优先。

- [ ] **Step 3: 调整候选顺序**

`src/services/chromeApi.ts` 的 `faviconCandidates`，把 `return [...]` 块：

```ts
    return [
      `${origin}/favicon.ico`,
      `${origin}/favicon.png`,
      `${origin}/apple-touch-icon.png`,
    ];
```

改为：

```ts
    return [
      `${origin}/apple-touch-icon.png`,
      `${origin}/favicon.png`,
      `${origin}/favicon.ico`,
    ];
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/services/chromeApi.test.ts`
Expected: PASS（默认值用例 + 3 个 favicon 用例）。

- [ ] **Step 5: 提交**

```bash
git add src/services/chromeApi.ts src/services/chromeApi.test.ts
git commit -m "feat(graph): prefer high-res apple-touch-icon for crisp node favicons"
```

---

## Task 4: 自动连线派生模块 `autoEdges`

**Files:**
- Modify: `src/designs/Graph/relationSuggest.ts:125-131`（导出 `hostOf`）
- Create: `src/designs/Graph/autoEdges.ts`
- Test: `src/designs/Graph/autoEdges.test.ts`

规则：① 同一站点群（复用 `relationSuggest.ts` 的 `HOST_CLUSTERS` / `clustersForHost`）内的书签连成**星形**——都连到该群中访问量最高者；② 同一主域名（如 `mail.google.com` / `drive.google.com` / `google.com`）的书签同样星形相连。两条规则产出的边按 `edgeId` 去重；已有手动连线的同一对不再追加自动线；分组节点、无 host 的节点跳过。全部 `kind: 'auto'`。

- [ ] **Step 1: 导出 `hostOf`**

`src/designs/Graph/relationSuggest.ts`，把：

```ts
function hostOf(url: string): string | null {
```

改为：

```ts
export function hostOf(url: string): string | null {
```

- [ ] **Step 2: 写失败测试**

新建 `src/designs/Graph/autoEdges.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import type { GraphEdge, GraphItem } from '../../types';
import { computeAutoEdges, baseDomain } from './autoEdges';

const item = (id: string, url: string, visits = 0): GraphItem => ({
  id,
  parentId: 'root',
  name: id,
  url,
  group: 'g',
  color: '#000',
  letter: id[0]!.toUpperCase(),
  visits,
  last: '',
});

const groupItem = (id: string): GraphItem => ({
  ...item(id, 'newtab://group/' + id),
  nodeKind: 'group',
});

describe('baseDomain', () => {
  it('reduces subdomains to the registrable domain', () => {
    expect(baseDomain('mail.google.com')).toBe('google.com');
    expect(baseDomain('drive.google.com')).toBe('google.com');
    expect(baseDomain('google.com')).toBe('google.com');
  });

  it('handles a known two-level TLD', () => {
    expect(baseDomain('foo.bar.co.uk')).toBe('bar.co.uk');
  });
});

describe('computeAutoEdges', () => {
  it('connects same-cluster bookmarks in a star to the most-visited hub', () => {
    const nodes = [
      item('a', 'https://chatgpt.com', 50),
      item('b', 'https://claude.ai', 80),
      item('c', 'https://gemini.google.com', 30),
    ];
    const out = computeAutoEdges(nodes, []);
    // hub = b (80 visits); edges b-a and b-c.
    expect(out).toHaveLength(2);
    expect(out.every((e) => e.kind === 'auto')).toBe(true);
    const pairs = out.map((e) => [e.from, e.to].sort().join('-')).sort();
    expect(pairs).toEqual(['a-b', 'b-c']);
  });

  it('connects same-domain subdomains in a star', () => {
    const nodes = [
      item('m', 'https://mail.google.com', 10),
      item('d', 'https://drive.google.com', 40),
      item('g', 'https://google.com', 20),
    ];
    const out = computeAutoEdges(nodes, []);
    expect(out).toHaveLength(2); // hub = d
    const pairs = out.map((e) => [e.from, e.to].sort().join('-')).sort();
    expect(pairs).toEqual(['d-g', 'd-m']);
  });

  it('does not duplicate a pair already connected by a manual edge', () => {
    const nodes = [
      item('a', 'https://chatgpt.com', 50),
      item('b', 'https://claude.ai', 80),
    ];
    const manual: GraphEdge[] = [{ id: 'a b', from: 'a', to: 'b', kind: 'manual' }];
    expect(computeAutoEdges(nodes, manual)).toEqual([]);
  });

  it('does not duplicate a pair matched by both rules', () => {
    // Two sites that share BOTH a cluster and a domain → only one edge.
    const nodes = [
      item('x', 'https://gemini.google.com', 5),
      item('y', 'https://aistudio.google.com', 9),
    ];
    const out = computeAutoEdges(nodes, []);
    expect(out).toHaveLength(1);
  });

  it('skips group nodes and unparseable urls', () => {
    const nodes = [groupItem('grp'), item('a', 'not-a-url', 1), item('b', 'also-bad', 2)];
    expect(computeAutoEdges(nodes, [])).toEqual([]);
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run src/designs/Graph/autoEdges.test.ts`
Expected: FAIL —— `./autoEdges` 模块不存在。

- [ ] **Step 4: 实现 `autoEdges.ts`**

新建 `src/designs/Graph/autoEdges.ts`：

```ts
import type { GraphEdge, GraphItem } from '../../types';
import { edgeId } from './edges';
import { clustersForHost, hostOf } from './relationSuggest';

/** Two-level public suffixes we special-case so `baseDomain` keeps eTLD+1. */
const MULTI_TLDS = new Set([
  'co.uk', 'org.uk', 'com.cn', 'net.cn', 'com.hk',
  'com.tw', 'co.jp', 'co.kr', 'com.au', 'com.br',
]);

/**
 * Approximate registrable domain (eTLD+1). Not a full public-suffix list —
 * a small curated set of common two-level TLDs is enough for grouping a
 * handful of bookmarks without pulling in a dependency.
 */
export function baseDomain(host: string): string {
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_TLDS.has(lastTwo)) return parts.slice(-3).join('.');
  return lastTwo;
}

interface Located {
  node: GraphItem;
  host: string;
}

/** Connect every member to the highest-visit hub; emit deduped 'auto' edges. */
function star(members: Located[], seen: Set<string>, out: GraphEdge[]): void {
  if (members.length < 2) return;
  const sorted = [...members].sort(
    (a, b) => b.node.visits - a.node.visits || (a.node.id < b.node.id ? -1 : 1)
  );
  const hub = sorted[0]!.node;
  for (let i = 1; i < sorted.length; i++) {
    const to = sorted[i]!.node;
    const id = edgeId(hub.id, to.id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, from: hub.id, to: to.id, kind: 'auto' });
  }
}

/**
 * Derive display-only relationship edges from the current bookmark set:
 *  - same host cluster (HOST_CLUSTERS) → star to the cluster's busiest site
 *  - same registrable domain → star to that domain's busiest site
 * Pairs already linked by a manual edge are skipped, and the two rules share
 * one dedupe set so a pair is never emitted twice.
 */
export function computeAutoEdges(
  nodes: GraphItem[],
  manualEdges: GraphEdge[]
): GraphEdge[] {
  const located: Located[] = [];
  for (const node of nodes) {
    if (node.nodeKind === 'group') continue;
    const host = hostOf(node.url);
    if (!host || !host.includes('.')) continue;
    located.push({ node, host });
  }

  const seen = new Set<string>();
  for (const e of manualEdges) seen.add(e.id); // never shadow a manual link

  const out: GraphEdge[] = [];

  // Rule 1: same host cluster.
  const byCluster = new Map<string, Located[]>();
  for (const l of located) {
    const cluster = clustersForHost(l.host)[0];
    if (!cluster) continue;
    const bucket = byCluster.get(cluster.id);
    if (bucket) bucket.push(l);
    else byCluster.set(cluster.id, [l]);
  }
  for (const members of byCluster.values()) star(members, seen, out);

  // Rule 2: same registrable domain.
  const byDomain = new Map<string, Located[]>();
  for (const l of located) {
    const dom = baseDomain(l.host);
    const bucket = byDomain.get(dom);
    if (bucket) bucket.push(l);
    else byDomain.set(dom, [l]);
  }
  for (const members of byDomain.values()) star(members, seen, out);

  return out;
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run src/designs/Graph/autoEdges.test.ts`
Expected: PASS（baseDomain 2 + computeAutoEdges 5）。

- [ ] **Step 6: 提交**

```bash
git add src/designs/Graph/relationSuggest.ts src/designs/Graph/autoEdges.ts src/designs/Graph/autoEdges.test.ts
git commit -m "feat(graph): derive auto edges from host clusters and shared domains"
```

---

## Task 5: 渲染层重做（`render.ts`）

**Files:**
- Modify: `src/designs/Graph/render.ts`（多处，见各步）
- Test: `src/designs/Graph/render.test.ts`（追加 `edgeStyleFor` 用例）

包含：显示阈值下调、favicon 主角化 + monogram 降级、标签字号 + halo、URL 改 hover、自动/手动线分样式（抽出可测的 `edgeStyleFor`）、`showEdges` 总开关。

- [ ] **Step 1: 写失败测试（`edgeStyleFor`）**

`src/designs/Graph/render.test.ts`，在 import 块把 `drawGraph` 那组导入追加 `edgeStyleFor`：

```ts
import {
  RenderTextCache,
  drawGraph,
  edgeStyleFor,
  resizeCanvas,
  type RenderState,
  type Theme,
} from './render';
```

并在文件末尾追加：

```ts
describe('edgeStyleFor', () => {
  it('draws auto edges thin, faint and dashed', () => {
    const s = edgeStyleFor('auto', false);
    expect(s.lineWidth).toBeLessThan(1);
    expect(s.alphaMul).toBeLessThan(0.5);
    expect(s.dash.length).toBeGreaterThan(0);
  });

  it('draws manual edges solid and more prominent than auto', () => {
    const manual = edgeStyleFor('manual', false);
    const auto = edgeStyleFor('auto', false);
    expect(manual.dash).toEqual([]);
    expect(manual.lineWidth).toBeGreaterThan(auto.lineWidth);
    expect(manual.alphaMul).toBeGreaterThan(auto.alphaMul);
  });

  it('hover overrides kind with a solid prominent style', () => {
    const s = edgeStyleFor('auto', true);
    expect(s.dash).toEqual([]);
    expect(s.lineWidth).toBeGreaterThanOrEqual(2);
    expect(s.alphaMul).toBe(1);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/designs/Graph/render.test.ts`
Expected: FAIL —— `edgeStyleFor` 不存在。

- [ ] **Step 3: 下调显示阈值**

`src/designs/Graph/render.ts:39-42`，把：

```ts
const DETAIL_LABEL_SCALE = 0.42;
const DETAIL_URL_SCALE = 0.82;
const DETAIL_FAVICON_SCALE = 0.72;
const DETAIL_MONOGRAM_SCALE = 0.32;
```

改为：

```ts
const DETAIL_LABEL_SCALE = 0.3;
const DETAIL_URL_SCALE = 0.82; // retained for detail struct; subtitle now hover-driven
const DETAIL_FAVICON_SCALE = 0.3;
const DETAIL_MONOGRAM_SCALE = 0.3;
```

- [ ] **Step 4: 给 `RenderState` 增加 `showEdges`**

`src/designs/Graph/render.ts` 的 `RenderState` 接口，在 `textCache: RenderTextCache;` 前追加：

```ts
  /** Master toggle: when false, no edges are drawn. Defaults to true. */
  showEdges?: boolean;
```

- [ ] **Step 5: 在 `drawGraph` 中按开关跳过连线**

`src/designs/Graph/render.ts` 的 `drawGraph`，把：

```ts
  if (state.highlightGroupId) drawGroupHighlight(ctx, state);
  drawEdges(ctx, state, state.nodeById, bounds);
```

改为：

```ts
  if (state.highlightGroupId) drawGroupHighlight(ctx, state);
  if (state.showEdges !== false) drawEdges(ctx, state, state.nodeById, bounds);
```

- [ ] **Step 6: 抽出 `edgeStyleFor` 并改 `drawEdges` 分样式**

在 `src/designs/Graph/render.ts` 的 `drawEdges` 函数**之前**插入：

```ts
export interface EdgeStyle {
  lineWidth: number;
  alphaMul: number;
  dash: number[];
}

/** Visual weight per edge kind. Hover always wins with a solid, prominent line. */
export function edgeStyleFor(kind: GraphEdge['kind'], isHover: boolean): EdgeStyle {
  if (isHover) return { lineWidth: 2.5, alphaMul: 1, dash: [] };
  if (kind === 'auto') return { lineWidth: 0.8, alphaMul: 0.3, dash: [3, 4] };
  return { lineWidth: 1.2, alphaMul: 0.6, dash: [] };
}
```

然后把 `drawEdges` 内这段：

```ts
    const isHover = state.hoverEdgeId === e.id;
    const aAlpha = alphaFor(a.id, state.filterMatches, state.focusNeighborhood);
    const bAlpha = alphaFor(b.id, state.filterMatches, state.focusNeighborhood);
    const alpha = Math.min(aAlpha, bAlpha) * (isHover ? 1 : 0.6);

    const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    grad.addColorStop(0, hueString(a.groupHue));
    grad.addColorStop(1, hueString(b.groupHue));
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = grad;
    ctx.lineWidth = isHover ? 2.5 : 1.2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
```

改为：

```ts
    const isHover = state.hoverEdgeId === e.id;
    const aAlpha = alphaFor(a.id, state.filterMatches, state.focusNeighborhood);
    const bAlpha = alphaFor(b.id, state.filterMatches, state.focusNeighborhood);
    const style = edgeStyleFor(e.kind, isHover);
    const alpha = Math.min(aAlpha, bAlpha) * style.alphaMul;

    const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    grad.addColorStop(0, hueString(a.groupHue));
    grad.addColorStop(1, hueString(b.groupHue));
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = grad;
    ctx.lineWidth = style.lineWidth;
    ctx.setLineDash(style.dash);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
```

- [ ] **Step 7: favicon 主角化 + monogram 降级兜底**

`src/designs/Graph/render.ts` 的 `drawNodes`，把这一整段（中央字母 + favicon 叠加，约现 381-413 行）：

```ts
    if (detail.monograms) {
      // Center letter monogram.
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#fff';
      ctx.font = `600 ${Math.round(n.radius * (isGroup ? 0.56 : 0.72))}px var(--font-mono, monospace)`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(n.letter, n.x, n.y + 1);
    }

    // Favicon overlay if loaded — draws on top of letter, same size as radius.
    const img = detail.favicons && !isGroup ? state.favicons.get(n.url) : null;
    if (img) {
      const s = n.radius * 1.1;
      let drawFailed = false;
      ctx.save();
      try {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius - 1, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = '#fff';
        ctx.fillRect(n.x - s / 2, n.y - s / 2, s, s);
        ctx.drawImage(img, n.x - s / 2, n.y - s / 2, s, s);
      } catch {
        drawFailed = true;
        state.favicons.markBroken(n.url);
        ctx.fillStyle = n.color;
        ctx.fillRect(n.x - s / 2, n.y - s / 2, s, s);
      } finally {
        ctx.restore();
      }
      if (drawFailed) drawNodeMonogram(ctx, n, isGroup, alpha);
    }
```

改为（favicon 占满节点；只有没有 favicon 时才画字母）：

```ts
    // Favicon is the primary visual. Fill the disc; fall back to the letter
    // monogram only when no favicon is available (groups never have one).
    const img = detail.favicons && !isGroup ? state.favicons.get(n.url) : null;
    if (img) {
      const s = n.radius * 1.4;
      ctx.globalAlpha = alpha;
      ctx.save();
      try {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius - 1, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = '#fff';
        ctx.fillRect(n.x - s / 2, n.y - s / 2, s, s);
        ctx.drawImage(img, n.x - s / 2, n.y - s / 2, s, s);
        ctx.restore();
      } catch {
        ctx.restore();
        state.favicons.markBroken(n.url);
        if (detail.monograms) drawNodeMonogram(ctx, n, isGroup, alpha);
      }
    } else if (detail.monograms) {
      drawNodeMonogram(ctx, n, isGroup, alpha);
    }
```

- [ ] **Step 8: 标签字号 + halo + URL 改 hover**

`src/designs/Graph/render.ts` 的 `drawLabels`，把循环体内从 `ctx.font = ...` 到 URL 副标题结束这一段：

```ts
    ctx.font = `${isGroup ? 600 : 500} 12px var(--font-sans, sans-serif)`;
    ctx.fillStyle = theme.fg;
    ctx.fillText(state.textCache.ellipsize(ctx, n.name, maxWidth), n.x, y);

    if (!isGroup && detail.urls) {
      ctx.globalAlpha = alpha >= 0.5 ? alpha * 0.66 : alpha * 0.82;
      ctx.font = '10px var(--font-mono, monospace)';
      ctx.fillStyle = theme.fg;
      ctx.fillText(
        state.textCache.ellipsize(ctx, state.textCache.displayUrl(n.url), maxWidth),
        n.x,
        y + 15
      );
    }
```

改为（站名 14px/600，theme.bg 描边作 halo 保证任意背景可读；域名仅在 hover 时显示）：

```ts
    // Title: always on, with a theme-bg halo so it stays legible on any
    // wallpaper or light/dark theme.
    ctx.font = `600 14px var(--font-sans, sans-serif)`;
    const title = state.textCache.ellipsize(ctx, n.name, maxWidth);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = theme.bg;
    ctx.strokeText(title, n.x, y);
    ctx.fillStyle = theme.fg;
    ctx.fillText(title, n.x, y);

    // Domain subtitle: only for the hovered bookmark, to avoid clutter.
    if (!isGroup && n.id === state.hoverNodeId) {
      const uy = y + 17;
      ctx.font = '11px var(--font-mono, monospace)';
      const sub = state.textCache.ellipsize(ctx, state.textCache.displayUrl(n.url), maxWidth);
      ctx.globalAlpha = Math.max(alpha, 0.7) * 0.85;
      ctx.lineWidth = 3;
      ctx.strokeStyle = theme.bg;
      ctx.strokeText(sub, n.x, uy);
      ctx.fillStyle = theme.fg;
      ctx.fillText(sub, n.x, uy);
    }
```

- [ ] **Step 9: 运行 `edgeStyleFor` 测试 + 既有渲染测试**

Run: `npx vitest run src/designs/Graph/render.test.ts`
Expected: PASS（`RenderTextCache` + `displayUrl` 原用例 + 3 个 `edgeStyleFor` 用例）。

- [ ] **Step 10: 类型检查**

Run: `npm run typecheck`
Expected: 无报错。

> 说明：`drawNodes` / `drawLabels` / `drawEdges` 的 Canvas 绘制效果由 Task 9 的构建 + 手动验证确认；本任务的纯函数 `edgeStyleFor` 已被单测覆盖。

- [ ] **Step 11: 提交**

```bash
git add src/designs/Graph/render.ts src/designs/Graph/render.test.ts
git commit -m "feat(graph): favicon-first nodes, always-on haloed labels, kind-styled edges, edge toggle"
```

---

## Task 6: `GraphCanvas` 接线（合并连线 + 总开关）

**Files:**
- Modify: `src/designs/Graph/GraphCanvas.tsx`

要点：新增 `autoEdges` / `showEdges` 两个 props；渲染时把手动 + 自动连线合并进 `RenderState.edges`，并传 `showEdges`；命中测试（`edgeAt`）与物理仿真仍只用手动 `props.edges`，所以自动连线不可右键、不参与力导向。

- [ ] **Step 1: 扩展 Props**

`src/designs/Graph/GraphCanvas.tsx` 的 `interface Props`，在 `edges: GraphEdge[];` 后追加：

```ts
  /** Display-only derived edges (same cluster / same domain). Not interactive,
   *  not fed to the physics sim. */
  autoEdges?: GraphEdge[];
  /** Master toggle for drawing any edges. Defaults to true. */
  showEdges?: boolean;
```

- [ ] **Step 2: 渲染时合并连线并传开关**

在 rAF loop 内构造 `RenderState` 处（`const state: RenderState = { ... }`），把：

```ts
          edges: props.edges,
```

改为：

```ts
          edges:
            props.autoEdges && props.autoEdges.length
              ? props.edges.concat(props.autoEdges)
              : props.edges,
          showEdges: props.showEdges ?? true,
```

（`hoverNodeId` 已在该对象中传入，drawLabels 的 hover 副标题即可工作；`edgeAt` 仍用 `props.edges`，无需改动。）

- [ ] **Step 3: 让 rAF 闭包随新 props 更新**

rAF loop 所在 `useEffect` 的依赖数组：

```ts
  }, [sim, props.bookmarks, props.edges, props.pins, props.themeKey, camera]);
```

改为：

```ts
  }, [sim, props.bookmarks, props.edges, props.autoEdges, props.showEdges, props.pins, props.themeKey, camera]);
```

- [ ] **Step 4: 切换/数据变化时重绘**

同步重绘的 `useEffect`（以 `props.filterText, props.filterMatches, ...` 为依赖、内部调用 `requestFrame()` 的那个），在其依赖数组的 `props.edges,` 后追加：

```ts
    props.autoEdges,
    props.showEdges,
```

- [ ] **Step 5: 类型检查**

Run: `npm run typecheck`
Expected: 无报错。

- [ ] **Step 6: 提交**

```bash
git add src/designs/Graph/GraphCanvas.tsx
git commit -m "feat(graph): render merged auto edges in GraphCanvas behind showEdges toggle"
```

---

## Task 7: `Graph.tsx` 计算并下传 `autoEdges` / `showEdges`

**Files:**
- Modify: `src/designs/Graph/Graph.tsx`

- [ ] **Step 1: 引入 `computeAutoEdges`**

`src/designs/Graph/Graph.tsx` 顶部，与现有 `./edges`、`./relationSuggest` 等同区，加入：

```ts
import { computeAutoEdges } from './autoEdges';
```

- [ ] **Step 2: 计算 `autoEdges` memo**

在 `graphItems` memo 定义之后、`return` JSX 之前，加入（`graphItems` 与手动 `edges` 已在组件作用域内）：

```ts
  // Display-only relationship edges, recomputed from the rendered node set.
  // Empty when the user has turned edges off, so we skip the work entirely.
  const autoEdges = useMemo(
    () => (settings.showEdges ? computeAutoEdges(graphItems, edges) : []),
    [graphItems, edges, settings.showEdges]
  );
```

> `useMemo` 已在本文件使用（`graphItems` 即是），无需新增 import。

- [ ] **Step 3: 传给 `GraphCanvas`**

在 `<GraphCanvas ... />` 的 props 中，于 `edges={edges}` 之后加入：

```tsx
        autoEdges={autoEdges}
        showEdges={settings.showEdges}
```

- [ ] **Step 4: 类型检查**

Run: `npm run typecheck`
Expected: 无报错。

- [ ] **Step 5: 提交**

```bash
git add src/designs/Graph/Graph.tsx
git commit -m "feat(graph): wire derived auto edges and showEdges into the canvas"
```

---

## Task 8: 设置面板加「连线」开关

**Files:**
- Modify: `src/components/Tweaks.tsx`（在「底部常用栏」开关行后追加）

> i18n 文案 `tweaks.showEdges` / `showEdgesHint` 已在 Task 1 添加。

- [ ] **Step 1: 增加开关行**

`src/components/Tweaks.tsx`，找到「底部常用栏」（`showStrip`）那一行 `<div className="row"> ... </div>`（含 `onChange({ showStrip: true })` / `false`），在它**之后**插入：

```tsx
          <div className="row">
            <div className="tweaks-metric">
              <span>{copy.tweaks.showEdges}</span>
              <span className="tweaks-metric-hint">{copy.tweaks.showEdgesHint}</span>
            </div>
            <div className="toggle">
              <button
                type="button"
                className={settings.showEdges ? 'active' : ''}
                onClick={() => onChange({ showEdges: true })}
              >
                显示
              </button>
              <button
                type="button"
                className={!settings.showEdges ? 'active' : ''}
                onClick={() => onChange({ showEdges: false })}
              >
                隐藏
              </button>
            </div>
          </div>
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: 无报错（`copy.tweaks.showEdges` 已存在；`settings.showEdges` 已在类型中）。

- [ ] **Step 3: 提交**

```bash
git add src/components/Tweaks.tsx
git commit -m "feat(settings): add edge visibility toggle to preferences panel"
```

---

## Task 9: 全量校验 + 手动验证

**Files:** 无（验证任务）

- [ ] **Step 1: 全量检查**

Run: `npm run check`
Expected: typecheck + 全部 vitest 用例 + build 均通过。

- [ ] **Step 2: 起开发服务器手动验证**

Run: `npm run dev`（mock 数据），在浏览器打开 `http://localhost:5174`，逐条核对 spec 验收标准：

  1. 无需缩放即可看清每个站的 favicon 与站名。
  2. 站名在浅色/深色主题、以及设置一张背景图后都清晰可读（halo 生效）。
  3. 有 favicon 的节点中央不再叠字母；删掉/断网某站 favicon 时回退显示字母。
  4. 同站点群（如多个 AI 聊天站）出现星形自动连线；`mail/drive/google.com` 之类同域名相连；自动线比手动线更细更淡（虚线）。
  5. 设置面板「连线 → 隐藏」可一键隐藏所有线，刷新后仍保持隐藏。
  6. 既有交互全部照常：点击进组/打开、输入字母唤起搜索并聚焦、右键空白增书签/分组、右键书签编辑删除、`Shift` 拖拽两个书签建立手动连线（实心更显眼）、右键手动连线删除、滚轮缩放、拖空白平移、双击重置、图钉固定。

- [ ] **Step 3: 如有问题回到对应 Task 修复，然后重跑 `npm run check`。**

---

## Self-Review notes（写计划时已核对）

- **Spec 覆盖**：节点放大→T2；favicon 主角+高清源→T3/T5；monogram 降级→T5；显示阈值+字号+halo→T5；URL 改 hover→T5；自动连线两规则→T4；自动/手动分样式→T5；连线总开关→T1/T5/T6/T7/T8；分组表达（同色+聚簇）为现有能力、本次不在组内连线——已满足。
- **类型一致**：`computeAutoEdges(nodes, manualEdges)`、`baseDomain`、`edgeStyleFor(kind, isHover)`、`radiusFor(visits, kind)`、`GraphEdge.kind: 'manual'|'auto'`、`Settings.showEdges`、`RenderState.showEdges`、Props `autoEdges`/`showEdges` 在各任务间签名一致。
- **无占位符**：每个代码步骤均给出完整代码。
- **范围说明**：自动连线仅用于显示，不进入物理仿真、不可右键删除（命中测试与 sim 仍只用手动 `edges`）——已在 T6 注明，避免删除一条不存在于存储的边。
- **关于 spec 的「分组淡轮廓常驻」**：spec 模块 5 提到可把现有 `hull.ts` 高亮轮廓改为常驻极淡。本计划当前未纳入该项（避免与节点放大同批引入过多视觉变化、便于先验证主改动）。如需保留该效果，作为后续独立小任务追加；已在此显式标注，未静默丢弃。
