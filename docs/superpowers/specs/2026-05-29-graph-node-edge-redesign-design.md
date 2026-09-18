# 图谱节点与连线视觉重做 — 设计文档

日期：2026-05-29
项目：Loci（Chrome 新标签页扩展，把书签渲染成 Canvas 力导向图谱）

## 背景与痛点

当前新标签页把书签画成一张 Canvas 力导向图。用户在日常使用中提出三个具体问题：

1. **节点太小、字太小，看不清是哪个网站。** 书签节点半径只有 11–24px，站名 12px 且要放大到 42% 缩放才显示，favicon 要 72% 缩放才加载——平时一屏看到的是一堆带单字母的小圆点，认不出站点。
2. **不好看。** 节点是「彩色圆 + 中间一个字母 + 上面贴一张被压小的 favicon」，信息层级混乱，favicon 不是主角。
3. **节点之间没有关联（连线）。** 现在的连线只有用户手动 `Shift` 拖拽产生，平时基本是空的，所以图看起来「没有网络感、没有关联」。

## 使用场景定位

经与用户确认：书签规模是**几十个常用站**，核心诉求是**「打开新标签页一眼认出并点开常用站」**。因此设计取向是：**节点可以放心做大、做清晰，不为容量牺牲可读性**。不需要为「上百书签」做分层折叠。

## 设计取向（已确认）

- **方向 A：放大圆盘 + 常驻清晰标签。** 保留力导向图谱形态，但把 favicon 放大成主角、站名常驻并加可读性背衬、字母 monogram 降级为兜底。（已在备选 B「卡片节点」、C「半结构化图谱」中选定 A，理由：改动可控、直击痛点、保留图谱气质。）
- **连线走「克制版」：** 只画真有含义的线，提供总开关，分组靠聚簇+颜色+轮廓表达而非组内两两连线。

## 不在本次范围内（YAGNI）

- 不做卡片矩形节点（方向 B）、不做分层折叠 / 长尾归档。
- 不做基于访问频率 / 共同访问的连线（噪音大、需深挖 history）——留作以后的可选开关。
- 不重写力导向引擎、相机、命中测试、图钉、搜索聚焦、右键菜单、分组管理 rail、Chrome 书签读写。这些只调参数或画法，逻辑不动。

---

## 模块设计

### 1. 节点尺寸（`src/designs/Graph/sim/useGraphSimCustom.ts:20-23`）

现状：
```ts
function radiusFor(visits, kind) {
  if (kind === 'group') return 18 + Math.min(10, Math.sqrt(Math.max(1, visits)) * 1.2);
  return 11 + Math.min(13, Math.sqrt(Math.max(0, visits)) * 0.9);
}
```

改为（数值在实现期可微调，原则是「书签节点直径约 48–64px，favicon 一眼可认」）：
- 书签节点基础半径 `11 → 24` 起步，按访问量小幅增长：约 `24 + min(8, sqrt(visits) * 0.7)`，落在 24–32px。
- 分组节点放大到约 30–40px，稳稳压住下属书签。

影响：节点变大后碰撞半径、力导向间距会变化，可能需要相应调大 `linkDistance` / `chargeDistanceMax`（见模块 5）。这是参数微调，不改引擎逻辑。

### 2. Favicon 成为主角（`src/designs/Graph/render.ts:392-413`，`src/services/chromeApi.ts`）

- favicon 填满节点主体：白底圆盘 + 圆形裁切，绘制尺寸约 `radius * 1.4`（当前是 `radius * 1.1`），让图标占满圆盘。
- 取更高分辨率的 favicon 源：候选 URL 在 `src/services/chromeApi.ts` 的 `faviconCandidates` 里构造，提高其请求尺寸参数（如 Google favicon 服务的 `sz=64`）。`faviconCache.ts` 的 `MAX_FAVICON_SIDE` 已为 192，可容纳更大图标，无需放宽。实现期确认各候选源的尺寸参数写法。
- 保留现有的加载失败兜底逻辑（`markBroken` + 回退 monogram）。

### 3. Monogram 降级为兜底（`render.ts:381-389`）

现状：只要 `detail.monograms` 为真就在节点中央画字母，favicon 再叠在上面。

改为：**只有当该节点没有可用 favicon（pending / broken / 加载失败）时才画字母**。有 favicon 就不画字母，节点更干净。

### 4. 可读性：显示阈值 + 字号 + 背衬（`render.ts:39-42, 436, 440-449`）

这是「字小看不清」的直接修复点。

**显示阈值（`render.ts:39-42`）** —— 几十个站没必要靠缩放才显示细节：
```
DETAIL_LABEL_SCALE   0.42 → ~0.30   // 标签几乎全程显示
DETAIL_FAVICON_SCALE 0.72 → ~0.30   // favicon 几乎全程显示
DETAIL_MONOGRAM_SCALE 0.32           // 保持
DETAIL_URL_SCALE     0.82            // URL 不再常驻（见下）
```

**标签（`render.ts:436`）：**
- 站名字号 `12 → 14px`，weight `500 → 600`，位置仍在节点正下方，**永远显示**。
- 文字加一层**深色半透明背衬或描边**，确保在亮底/暗底/任意背景图上都清晰可读。这是解决「看不清」的根本手段。

**域名副标题（`render.ts:440-449`）：**
- 不再常驻（常驻会让画面变挤）。改为**仅 hover 当前节点时**在站名下方显示域名。

### 5. 连线：有含义 + 可关 + 不乱

**数据结构（`src/types.ts:115-121`）：**
```ts
export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: 'manual' | 'auto';   // 新增 'auto'
  label?: string;
}
```

**自动连线（新增派生模块，例如 `src/designs/Graph/autoEdges.ts`）：**
- 自动线**每次根据当前书签集实时派生，不写入存储**（书签变化时连线自动跟随，无需维护）。
- 规则一 —— **同站点群**：复用现成的 `src/designs/Graph/relationSuggest.ts` 中的 `HOST_CLUSTERS`（AI 聊天、代码托管、视频、社交、设计、协作、AI 绘图……）。同一群内的站点连成**星形**——都连到该群中访问量最高的那个站，而不是两两全连，避免一团乱麻。
- 规则二 —— **同主域名**：同一注册主域名下的子站（如 `mail.google.com` / `drive.google.com` / `google.com`）自动相连。
- 自动线与手动线在 `autoEdges` 派生后合并供渲染；手动线优先（若某对已有手动线，则不再叠加同对自动线）。

**渲染区分（`render.ts:256-302` `drawEdges`）：**
- 自动线：更细、更淡（可虚线），低调。
- 手动线：保持现有实心渐变，更显眼。
- 区分依据 `edge.kind`。

**连线总开关：**
- 在 `src/types.ts` 的 `Settings` 增加 `showEdges: boolean`（默认 `true`），`DEFAULT_SETTINGS` 同步；通过 `useSettings` 持久化。
- 顶部 HUD 增加一个开关控件，一键显示/隐藏**所有**连线。
- 关闭时 `drawGraph` 跳过 `drawEdges`。

**分组的表达方式：**
- **不**在组内两两连线（那才是真正的视觉噪音来源）。
- 分组靠三件事表达：**同色（已有 `groupHue`）+ 力导向聚簇（已有）+ 一层很淡的分组轮廓**。
- 分组轮廓复用现成的 `src/designs/Graph/hull.ts`（凸包 + 平滑 blob），把现在「仅在 Groups 面板高亮某分组时才画」改为「常驻、极淡」地为每个分组画一层背景轮廓，让每个分组读起来像一片区域，结构感来自这里。

### 6. 保留不动

力导向引擎（`sim/engine.ts`）、相机/缩放/平移（`useCamera.ts`）、命中测试（`hitTest.ts`）、图钉（`pins.ts`）、搜索聚焦（`focusNeighborhood.ts`）、右键菜单、分组管理 rail、Chrome 书签/历史/topSites 读写——逻辑全部保留。仅模块 1 的尺寸变化可能带动力导向间距参数微调。

---

## 改动文件清单

| 文件 | 改动 |
| ---- | ---- |
| `src/designs/Graph/sim/useGraphSimCustom.ts` | 节点半径放大（模块 1） |
| `src/designs/Graph/render.ts` | favicon 放大、monogram 降级、显示阈值、标签字号+背衬、域名改 hover、自动/手动线区分、分组常驻轮廓、连线总开关跳过逻辑（模块 2/3/4/5） |
| `src/services/chromeApi.ts` | `faviconCandidates` 提高取图尺寸参数（模块 2） |
| `src/designs/Graph/autoEdges.ts`（新增） | 从书签派生同站点群（星形）+ 同主域名自动连线（模块 5） |
| `src/types.ts` | `GraphEdge.kind` 加 `'auto'`；`Settings` 加 `showEdges`（模块 5） |
| `src/hooks/useSettings.ts` / `DEFAULT_SETTINGS` | `showEdges` 默认值与持久化（模块 5） |
| 顶部 HUD 组件 | 连线总开关控件（模块 5） |

## 验收标准

1. 打开新标签页，**无需缩放**即可看清每个常用站的 favicon 和站名。
2. 站名在任意背景下清晰可读（有背衬/描边）。
3. 节点中央在有 favicon 时不再叠字母；无 favicon 时回退显示字母。
4. 同一站点群（如多个 AI 聊天站）之间出现自动连线，呈星形而非全连；同主域名子站相连。
5. 顶部开关可一键隐藏/显示所有连线，刷新后状态保持。
6. 每个分组有一层很淡的背景轮廓，分组在视觉上成片。
7. 现有交互（点击进组/打开、搜索聚焦、右键增删、Shift 拖拽建关联、右键删连线、缩放平移、图钉）全部照常工作。
8. `npm run check`（typecheck + test + build）通过。
