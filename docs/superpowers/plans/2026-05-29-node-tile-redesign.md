# 节点视觉升级：App 图标圆角方块 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 把单个书签节点从「彩色圆 + favicon 撑满 + 硬色环」重画成一枚有质感的 App 图标——圆角方块(squircle)+ 柔和投影 + favicon 居中留白 + 分组色底纹；无 favicon 时用「首字母 + 品牌色头像」兜底；分组节点画成叠层方块。

**Architecture:** 改动集中在 `src/designs/Graph/render.ts` 的 `drawNodes`，外加两个可单测的纯函数(`avatarColor`、`oklchLightness`)。命中测试(`hitTest.ts` 用 `node.radius` 作半径)、布局、连线、交互、标签(`drawLabels`)都不动——方块边长 = `2 × node.radius`，与原来的圆同占位，所以碰撞/命中/相机全部不受影响。

**Tech Stack:** React + TypeScript + Canvas 2D（`ctx.roundRect`，Chrome 扩展环境可用）；测试 Vitest。

> 关联：本轮是 `docs/superpowers/specs/2026-05-29-graph-node-edge-redesign-design.md` 的视觉精修后续。

---

## File Structure

| 文件 | 责任 | 改动 |
| ---- | ---- | ---- |
| `src/designs/Graph/render.ts` | 新增纯函数 `avatarColor`/`oklchLightness`；重写 `drawNodes`（squircle 书签 + 叠层分组 + favicon 留白 + 首字母头像兜底 + 分组色底纹 + 图钉点 + hover 抬升）；`drawNodes` 增加 `theme` 入参 | 修改 |
| `src/designs/Graph/render.test.ts` | 给 ctx mock 补 `roundRect` 与 shadow 属性；新增 `avatarColor`/`oklchLightness` 单测；更新既有 favicon 顺序断言为新契约 | 修改 |

---

## Task 1: 纯色彩函数 `avatarColor` + `oklchLightness`

**Files:**
- Modify: `src/designs/Graph/render.ts`（在 `hueString`（约 253-255 行）之后新增两个导出函数）
- Test: `src/designs/Graph/render.test.ts`（新增 describe 块）

- [ ] **Step 1: 写失败测试。** 在 `src/designs/Graph/render.test.ts` 顶部 import 增加这两个名字。当前是：
```ts
import { drawGraph, edgeStyleFor, RenderTextCache, type RenderState, type Theme } from './render';
```
改为：
```ts
import {
  avatarColor,
  drawGraph,
  edgeStyleFor,
  oklchLightness,
  RenderTextCache,
  type RenderState,
  type Theme,
} from './render';
```
在文件末尾追加：
```ts
describe('avatarColor', () => {
  it('is deterministic for the same seed', () => {
    expect(avatarColor('https://github.com')).toBe(avatarColor('https://github.com'));
  });

  it('returns an oklch string', () => {
    expect(avatarColor('x')).toMatch(/^oklch\(/);
  });

  it('varies hue across different seeds', () => {
    expect(avatarColor('https://a.com')).not.toBe(avatarColor('https://b.com'));
  });
});

describe('oklchLightness', () => {
  it('reads the L channel from an oklch string', () => {
    expect(oklchLightness('oklch(0.18 0.008 60)')).toBeCloseTo(0.18);
  });

  it('tolerates leading whitespace from getComputedStyle', () => {
    expect(oklchLightness(' oklch(0.96 0.006 80)')).toBeCloseTo(0.96);
  });

  it('defaults to 1 (treated as light) for non-oklch input', () => {
    expect(oklchLightness('#111')).toBe(1);
  });
});
```

- [ ] **Step 2: 运行确认失败。** `npx vitest run src/designs/Graph/render.test.ts` —— `avatarColor`/`oklchLightness` 不存在。

- [ ] **Step 3: 实现两个函数。** 在 `src/designs/Graph/render.ts` 的 `hueString` 函数之后（紧接其 `}` 下一行）插入：
```ts
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
```

- [ ] **Step 4: 运行确认通过。** `npx vitest run src/designs/Graph/render.test.ts` —— 新增 6 个用例通过（既有用例此时可能因 mock 缺 `roundRect` 仍然通过，因为 Task 1 没改 drawNodes；若已通过则继续）。再跑 `npm run typecheck` 确认干净。

- [ ] **Step 5: 提交**（显式路径；禁止 `git add -A/./-u`）：
```bash
git add src/designs/Graph/render.ts src/designs/Graph/render.test.ts
git commit -m "feat(graph): add avatarColor + oklchLightness helpers for tile nodes"
```

---

## Task 2: 重写 `drawNodes` —— App 图标方块

**Files:**
- Modify: `src/designs/Graph/render.ts`（`drawNodes` 函数体 + `drawGraph` 里对它的调用）
- Test: `src/designs/Graph/render.test.ts`（ctx mock 补 `roundRect`/shadow；更新既有 favicon 顺序断言）

设计参数（实现期可微调，保持比例）：方块半边 `half = n.radius`；圆角 `corner = half * 0.55`；favicon 居中、边长 `half * 1.15`（**留白不撑满**）；柔和投影；亮/暗主题不同面色；分组色画成方块底部内侧的一条色带；图钉为右上角小圆点；hover/拖动时投影抬升 + 一圈分组色描边；分组节点画成叠层方块。

- [ ] **Step 1: 给 ctx mock 补方法/属性。** 在 `src/designs/Graph/render.test.ts` 的 `createContext` 返回对象里，`setLineDash: vi.fn(),` 之后追加：
```ts
    roundRect: vi.fn(),
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
```

- [ ] **Step 2: 更新既有 favicon 顺序断言为新契约。** 既有测试 `draws an opaque backing before favicon pixels` 断言 `fillRect` 在 `drawImage` 之前。新画法中方块表面用 `roundRect`+`fill` 绘制（不再用 `fillRect` 当白底），favicon 直接画在表面之上。把该测试体中这段：
```ts
    expect(fillRect).toHaveBeenCalled();
    expect(drawImage).toHaveBeenCalled();
    expect(fillRect.mock.invocationCallOrder[0]).toBeLessThan(
      drawImage.mock.invocationCallOrder[0]!
    );
    expect(markBroken).not.toHaveBeenCalled();
```
替换为（断言「方块表面在 favicon 之前绘制」这一新契约，用 `roundRect` 的首次调用次序）：
```ts
    const roundRect = ctx.roundRect as unknown as ReturnType<typeof vi.fn>;
    expect(roundRect).toHaveBeenCalled();
    expect(drawImage).toHaveBeenCalled();
    expect(roundRect.mock.invocationCallOrder[0]).toBeLessThan(
      drawImage.mock.invocationCallOrder[0]!
    );
    expect(markBroken).not.toHaveBeenCalled();
```
（`falls back instead of throwing when a cached favicon becomes broken` 测试不改——它让 `drawImage` 抛错并断言 `markBroken` 被调用且不抛异常；新代码的 catch 仍调用 `markBroken`。保留。）

- [ ] **Step 3: 运行确认失败/红。** `npx vitest run src/designs/Graph/render.test.ts` —— 顺序断言此时应失败（旧 drawNodes 还在用 `fillRect`、且 `roundRect` 未被调用）。

- [ ] **Step 4: 让 `drawNodes` 接收 `theme`。** 在 `drawGraph` 中找到这一行：
```ts
  drawNodes(ctx, state, bounds, detail);
```
改为：
```ts
  drawNodes(ctx, state, theme, bounds, detail);
```

- [ ] **Step 5: 重写 `drawNodes` + 新增两个绘制辅助函数。** 把现有 `drawNodes` 整个函数（从 `function drawNodes(` 到其结尾 `}`，即把 squircle 之前的彩色圆/硬环/favicon 撑满那一整套替换掉）替换为下面的实现，并在其**之前**新增 `traceSquircle` 与 `drawTileAvatar` 两个辅助函数：

```ts
/** Trace a rounded-square (squircle-ish) path centered at (cx, cy). */
function traceSquircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  half: number,
  corner: number
): void {
  ctx.beginPath();
  ctx.roundRect(cx - half, cy - half, half * 2, half * 2, corner);
}

/** Fill the tile with a brand color and draw the white initial — favicon fallback. */
function drawTileAvatar(
  ctx: CanvasRenderingContext2D,
  n: GraphNode,
  half: number,
  corner: number,
  alpha: number
): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = avatarColor(n.url);
  traceSquircle(ctx, n.x, n.y, half, corner);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `600 ${Math.round(half * 0.9)}px var(--font-sans, sans-serif)`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(n.letter, n.x, n.y + 1);
}

function drawNodes(
  ctx: CanvasRenderingContext2D,
  state: RenderState,
  theme: Theme,
  bounds: WorldBounds,
  detail: RenderDetail
): void {
  const isDark = oklchLightness(theme.bg) < 0.5;
  for (const n of state.nodes) {
    if (!nodeIntersects(n, bounds, 8)) continue;
    const alpha = alphaFor(n.id, state.filterMatches, state.focusNeighborhood);
    const isHover = state.hoverNodeId === n.id;
    const isDragging = state.draggingId === n.id;
    const lift = isHover || isDragging;
    const isPinned = Object.prototype.hasOwnProperty.call(state.pins, n.id);
    const isGroup = n.nodeKind === 'group';
    const half = n.radius;
    const corner = half * 0.55;

    // ── Group node: stacked tiles in the folder hue ────────────────────────
    if (isGroup) {
      const off = half * 0.22;
      ctx.globalAlpha = alpha * 0.6;
      ctx.fillStyle = hueString(n.groupHue, isDark ? 40 : 80, 0.1);
      traceSquircle(ctx, n.x + off, n.y - off, half, corner);
      ctx.fill();

      ctx.globalAlpha = alpha;
      ctx.save();
      ctx.shadowColor = `oklch(0 0 0 / ${lift ? 0.3 : 0.2})`;
      ctx.shadowBlur = half * (lift ? 0.85 : 0.5);
      ctx.shadowOffsetY = half * (lift ? 0.26 : 0.16);
      ctx.fillStyle = hueString(n.groupHue, isDark ? 50 : 70, 0.14);
      traceSquircle(ctx, n.x, n.y, half, corner);
      ctx.fill();
      ctx.restore();

      if (lift) {
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 2;
        ctx.strokeStyle = hueString(n.groupHue, 78);
        traceSquircle(ctx, n.x, n.y, half, corner);
        ctx.stroke();
      }

      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#fff';
      ctx.font = `600 ${Math.round(half * 0.8)}px var(--font-sans, sans-serif)`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(n.letter, n.x, n.y + 1);
      continue;
    }

    // ── Bookmark node: app-icon tile ───────────────────────────────────────
    const img = detail.favicons ? state.favicons.get(n.url) : null;

    // Soft drop shadow lifts the tile off the canvas.
    ctx.globalAlpha = alpha;
    ctx.save();
    ctx.shadowColor = `oklch(0 0 0 / ${lift ? 0.3 : 0.2})`;
    ctx.shadowBlur = half * (lift ? 0.9 : 0.5);
    ctx.shadowOffsetY = half * (lift ? 0.28 : 0.16);
    // Surface: near-white tile when a favicon exists; brand color for avatars.
    ctx.fillStyle = img
      ? isDark
        ? hueString(n.groupHue, 92, 0.01)
        : hueString(n.groupHue, 99, 0.004)
      : avatarColor(n.url);
    traceSquircle(ctx, n.x, n.y, half, corner);
    ctx.fill();
    ctx.restore();

    // Hairline border to define the tile edge.
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1;
    ctx.strokeStyle = isDark ? 'oklch(1 0 0 / 0.1)' : 'oklch(0 0 0 / 0.07)';
    traceSquircle(ctx, n.x, n.y, half, corner);
    ctx.stroke();

    if (img) {
      const s = half * 1.15; // centered with padding — not bled to the edge
      try {
        ctx.drawImage(img, n.x - s / 2, n.y - s / 2, s, s);
      } catch {
        state.favicons.markBroken(n.url);
        if (detail.monograms) drawTileAvatar(ctx, n, half, corner, alpha);
      }
    } else if (detail.monograms) {
      ctx.fillStyle = '#fff';
      ctx.font = `600 ${Math.round(half * 0.9)}px var(--font-sans, sans-serif)`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(n.letter, n.x, n.y + 1);
    }

    // Group-hue accent band along the tile's inner foot.
    ctx.save();
    traceSquircle(ctx, n.x, n.y, half, corner);
    ctx.clip();
    ctx.globalAlpha = alpha * 0.9;
    ctx.fillStyle = hueString(n.groupHue, 62, 0.18);
    const barH = Math.max(2.5, half * 0.16);
    ctx.fillRect(n.x - half, n.y + half - barH, half * 2, barH);
    ctx.restore();

    // Hover/drag: group-hue outline.
    if (lift) {
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 2;
      ctx.strokeStyle = hueString(n.groupHue, 75);
      traceSquircle(ctx, n.x, n.y, half, corner);
      ctx.stroke();
    }

    // Pin indicator: small dot at the top-right corner.
    if (isPinned) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = hueString(n.groupHue, 80);
      ctx.beginPath();
      ctx.arc(n.x + half, n.y - half, Math.max(2.5, half * 0.2), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}
```

注意：旧的 `drawNodeMonogram` 辅助函数若已无人调用，删除它以免留下死代码；若仍被别处引用则保留（实现时 grep 确认：搜索 `drawNodeMonogram` 的引用，仅 `drawNodes` 用到就一并删除其定义）。

- [ ] **Step 6: 运行测试确认通过。** `npx vitest run src/designs/Graph/render.test.ts`
  期望：`avatarColor`/`oklchLightness`（Task 1 的 6 个）+ 更新后的「方块表面先于 favicon」顺序断言 + 破损 favicon 回退断言，全部通过。

- [ ] **Step 7: typecheck。** `npm run typecheck` —— 干净。

- [ ] **Step 8: 提交**（显式路径；禁止 `git add -A/./-u`）：
```bash
git add src/designs/Graph/render.ts src/designs/Graph/render.test.ts
git commit -m "feat(graph): redraw nodes as app-icon tiles with soft shadow + avatar fallback"
```

---

## Task 3: 全量校验

**Files:** 无（验证任务）

- [ ] **Step 1:** `npm run check`（typecheck + 全部 vitest + build）必须全绿。
- [ ] **Step 2:** `npm run build` 产出 `dist/`，供用户在 Chrome 里加载（`chrome://extensions` → 开发者模式 → 加载已解压 → 选 `dist/`），核对：
  1. 节点是带柔和投影的圆角方块，favicon 居中留白、不再撑满发虚。
  2. 无 favicon 的站点显示「品牌色方块 + 白色首字母」头像。
  3. 每个方块底部有一条分组色带；hover 时方块描一圈分组色、投影抬升。
  4. 分组节点是叠层方块 + 首字母，和书签一眼可区分。
  5. 亮/暗主题下方块面色与边框都清晰（暗色不刺眼、亮色有边界）。
  6. 既有交互全部照常：点击/进组/搜索聚焦/右键/Shift 连线/缩放平移/双击重置/图钉（右上角小圆点）。
- [ ] **Step 3:** 有问题回到对应 Task 修复后重跑 `npm run check`。

---

## Self-Review notes（写计划时已核对）

- **占位不变**：方块边长 = `2 × node.radius`，与原圆同半径，`hitTest.ts`/相机/碰撞全部基于 `node.radius`，无需改动。
- **类型一致**：`avatarColor(seed: string): string`、`oklchLightness(color: string): number`、`drawNodes(ctx, state, theme, bounds, detail)`（新增 `theme: Theme`）在 Task 1/2 间一致；`drawGraph` 调用同步更新。
- **测试契约更新而非削弱**：favicon「白底先于图片」旧断言改为「方块表面(roundRect+fill)先于 favicon」新断言，仍验证真实绘制顺序；破损回退断言保留。
- **mock 完整性**：新增 `roundRect`（方法，必须存在否则抛错）与 shadow 属性（赋值即可）。
- **死代码**：`drawNodeMonogram` 若仅被旧 drawNodes 使用，随本次删除。
- **范围**：仅 `render.ts` + `render.test.ts`；不碰连线、布局、交互、`drawLabels`、`drawGraph` 其余部分。
