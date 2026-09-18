# AI 书签分组(创建分组节点 + BYOK)— 设计文档

- 日期:2026-07-22
- 分支:`feat/ai-grouping`(基于 `feat/graph-node-edge-redesign` HEAD,继承已有 AI 基建)
- 状态:已通过 brainstorming 评审,待用户复核 spec

## 1. 背景与问题

Loci 把 Chrome 书签渲染成力导向图。此前已落地一套 **BYOK AI 基建**:`AiSettings`
(provider / apiKey / baseUrl / model)、统一 `Classifier` 接口(`ClaudeClassifier` +
`OpenAICompatibleClassifier`)、`makeClassifier` 工厂、`topicCache`(内容哈希增量缓存)。
它把站点分类成 **临时 topic 标签**,驱动图的连线 / 着色 / hover 邻域——但这些是
**display-only、不落盘到书签**。

用户希望更进一步:**用 AI 真正把网站"分组",创建分组节点**。在 Loci 里
"分组节点"(`GraphItem.nodeKind === 'group'`)是由**真实 Chrome 文件夹**
(`data.groups`)渲染出来的(见 `Graph.tsx` 构建 group 节点处)。因此
"创建分组节点" = **创建真实文件夹并把书签移入**,图会自动出现对应 group 节点。

## 2. 已确认的核心决策(brainstorming 产出)

| 决策点 | 选择 |
|---|---|
| 分组落地 | **写入真实 Chrome 文件夹**(`createFolder` / `moveBookmark`),破坏性,靠预览+确认+一步撤销保护 |
| 与现有 topic 关系 | **新增独立 `Grouper` 能力**,与 topic 分类并存互不干扰 |
| 处理范围 | 用户自主选择:默认仅**未分组的根书签**,可选**包含已分组书签** |
| 复用已有文件夹 | **可复用**:AI 既能归入已有文件夹,也能提新分组 |
| 配置项 | 分组粒度/组数、最小组大小、组名语言风格、范围/复用开关 |
| 应用后撤销 | **提供一步撤销**:移回原位 + 删除新建空文件夹 |
| 审阅 | **审阅优先**:AI 出方案 → Modal 反馈 → 用户确认/手动改/重新生成 → 应用 |
| provider | **BYOK 优先**,复用现有 provider 层(默认 Claude,支持 OpenAI 兼容端点) |
| UI | **统一**:复用 `Modal` / `InlineEdit` / `GroupSelect` 思路与 token 配色 |

## 3. 目标 / 非目标

**目标**
- 一个独立 `Grouper` provider 接口(复用 `AiSettings`),默认 `ClaudeGrouper`,可切 OpenAI 兼容端点。
- 手动触发的批量分组:AI 产出"分组名 + 成员",可复用现有文件夹名。
- 审阅 Modal:预览、手动改(移动成员 / 重命名组 / 删组)、重新生成、影响摘要。
- 确认后应用:创建真实文件夹 + 移动书签,写撤销日志;刷新后图自动出现 group 节点。
- 一步撤销:把书签移回原位、删除新建的空文件夹。
- 无 key / provider off 时优雅禁用,现有图 / topic 行为零退化。

**非目标(本期不做)**
- 不在开新标签 / 渲染热路径自动调 AI(成本 / 隐私 / 延迟)。
- 不做服务端代理;BYOK 浏览器直连。
- 不做多层嵌套分组的智能规划(v1 只在书签栏根下建**一层**文件夹;数据模型支持嵌套,留后续)。
- 不改动现有 topic 分类管线(两者并存)。
- 不做超过"上一次整理"的多级撤销历史(只存单槽撤销日志)。

## 4. 架构

### 4.1 数据模型 / 类型(均不污染持久书签数据)

```ts
// AI 分组的运行时产物(内存;未应用前不落盘)
interface ProposedGroup {
  key: string;                 // 预览内稳定 key(React & 手动改用)
  name: string;                // 组名(可编辑)
  existingFolderId?: string;   // 命中已有文件夹时填;否则应用时新建
  memberIds: string[];         // 成员书签 id
}
interface GroupProposal {
  groups: ProposedGroup[];
  unassigned: string[];        // AI 未归类 / 用户手动移出的
}

// 持久化的"配置默认值"(Settings 新增一段)
interface GroupingConfig {
  granularity: 'coarse' | 'balanced' | 'fine';  // 组数粒度 → 影响 prompt
  minGroupSize: number;                          // 小于则并入"其他/杂项"
  nameLanguage: 'auto' | 'zh' | 'en';            // 组名语言风格
  scope: 'ungrouped' | 'all';                    // 处理范围
  reuseExisting: boolean;                        // 是否允许归入已有文件夹
}

// 撤销日志(storage 单槽:只存"上一次整理")
interface GroupingUndo {
  at: string;
  moved: { id: string; fromParentId: string; fromIndex: number }[];
  createdFolderIds: string[];
}
```

`Settings.grouping: GroupingConfig` 进 `DEFAULT_SETTINGS`,零配置默认安全值:
`{ granularity: 'balanced', minGroupSize: 2, nameLanguage: 'auto', scope: 'ungrouped', reuseExisting: true }`。

### 4.2 Provider 接口("暴露的接口")

```ts
interface GroupInput { id: string; title: string; host: string; currentGroup?: string }

interface Grouper {
  /** 批量分组。实现负责一次/分批调用底层模型,返回分组方案。 */
  group(inputs: GroupInput[], existingGroups: string[]): Promise<GroupProposal>;
}

// 复用现有 AiSettings;config 决定 prompt 粒度/语言/最小组
function makeGrouper(ai: AiSettings, config: GroupingConfig): Grouper | null;
```

实现(与现有 `Classifier` 对称,复用 provider 判定逻辑):
- **`ClaudeGrouper`(默认)**:官方 `@anthropic-ai/sdk` + `dangerouslyAllowBrowser`,
  zod schema + `messages.parse` 结构化输出,默认 `claude-opus-4-8`(可配)。
  prompt 吃 `GroupingConfig`(粒度→目标组数区间、最小组、组名语言),并把
  `existingGroups`(现有文件夹名清单)作为"可复用上下文"喂入。
- **`OpenAICompatibleGrouper`**:`baseUrl + apiKey + model`,raw fetch,
  `response_format: json_object`,同一套 prompt 契约。
- `makeGrouper` 与 `makeClassifier` 同构:`off` / 缺 key / 兼容端点缺 baseUrl·model → `null`。

### 4.3 服务分层(纯逻辑与副作用分离)

- `src/services/ai/grouping.ts` — `Grouper` 接口 + `ClaudeGrouper` + `OpenAICompatibleGrouper` + `makeGrouper`。
- `src/services/grouping/plan.ts` — **纯函数**,不碰 chrome:
  - 预览态 reducer:`moveMember(proposal, memberId, toKey|null)`、`renameGroup`、
    `deleteGroup`(成员回 unassigned)、`mergeGroup`。全部返回新 `GroupProposal`。
  - `buildApplyPlan(proposal, data, barId)` → `{ createFolders: {key,name}[], moves: {id, toKey}[], summary: {newFolders, movedBookmarks} }`。
    命中 `existingFolderId` 复用;成员已在目标文件夹则跳过。
  - `buildUndoPlan(undo)` → `{ moves: {id, toParentId, index}[], removeFolderIds: string[] }`。
  - `minGroupSize` 后处理:小于阈值的组并入"其他/杂项"(纯函数,应用前生效于预览)。
- `src/services/grouping/apply.ts` — 副作用编排:
  - `applyGrouping(proposal, data, barId)`:按 plan 顺序 `createFolder`→`moveBookmark`,
    **边执行边攒 `GroupingUndo`**(记录每个书签移动前的 `parentId`/`index` 与新建 folder id),
    存入 storage 单槽;任一步失败→用已攒日志回滚(反向 move + 删新建空文件夹)+ 抛 typed error。
  - `undoLastGrouping()`:读单槽日志,执行 `buildUndoPlan`;best-effort(书签被用户挪走则跳过)。
  - `loadUndo()` / `saveUndo()` / `clearUndo()`:沿用 `topicCache` 的 chrome.storage/localStorage 双路。

### 4.4 UI 层

- `src/components/GroupingReview.tsx` — 审阅 Modal(复用 `Modal`,`width≈640`)。
- `Tweaks.tsx` AI 段:在现有「用 AI 分类」下增「用 AI 整理分组」入口 + 4 行配置
  (粒度 / 最小组 / 语言 / 范围·复用),`onChange` 写 `settings.grouping`;禁用态复用 `aiReady`。
- `App.tsx`:新增 `runGrouping()`(收集范围内书签 + 现有组名 → `makeGrouper().group()` → 开 Modal)、
  `applyProposal()`(`applyGrouping` → `refresh()`)、`undoGrouping()`。状态:`grouping`/`proposal`/`groupingError`。

### 4.5 审阅 Modal 交互(全部走纯 reducer,UI 只 dispatch)

```
┌ 用 AI 整理分组 ───────────────────────────── ✕ ┐
│ 隐私提示:整理时会把书签标题+域名发送给所选服务商    │
│ 范围:[仅未分组·含已分组]  复用已有:[开·关]  粒度:[粗·均衡·细] │
│ ─────────────────────────────────────────── │
│ ▸ 开发工具 (5)              [重命名] [删除]   │  ← 标题 InlineEdit
│    ◦ GitHub  ◦ MDN  ◦ Stack Overflow …       │  ← 成员 chip + 「移到…」下拉
│ ▸ 设计 (3)  · 命中已有文件夹 ↺              │  ← 复用已有文件夹标记
│ ▸ 未归类 (2)                                 │  ← unassigned,可选进任意组
│ ─────────────────────────────────────────── │
│ 将新建 3 个文件夹 · 移动 10 个书签           │  ← 实时影响摘要
│           [重新生成]      [取消] [应用整理]   │
└──────────────────────────────────────────────┘
```

- **手动分配**:成员 chip 的「移到…」轻量下拉(复用 `GroupSelect` 思路),选目标组或"未归类";不引入拖拽库,键鼠可用、可测。
- **重命名 / 删除组**:标题 `InlineEdit`;删组把成员退回未归类。
- **重新生成**:带当前开关重调 `group(...)`,覆盖预览;loading 态复用现有 `classifying` 模式。
- **影响摘要**:实时算"新建 N 文件夹 / 移动 M 书签"。
- **撤销反馈**:应用成功后给「撤销上次整理」入口;`GroupingUndo` 有值时常驻可用。
- 配色沿用 token(`--bg-1 / --line / --fg`),组卡片可选按 `groupHues` 上色,与图里 group 节点呼应。

## 5. 数据流(端到端)

1. Tweaks 点「用 AI 整理分组」→ 收集范围内书签 `{id,title,host,currentGroup}` + 现有文件夹名。
2. `makeGrouper(settings.ai, settings.grouping).group(inputs, existingGroups)` → `GroupProposal`(经 `minGroupSize` 后处理)。
3. 打开审阅 Modal:预览 + 手动改 + 重新生成。
4. 点「应用」→ `buildApplyPlan` → `applyGrouping` 写真实书签 + 存撤销日志 → `refresh()`(group 节点自动出现)。
5. 反馈可「撤销」→ `undoLastGrouping` 复原。无 key / off → 入口禁用并提示先配置 provider。

## 6. 安全 / 隐私 / 错误处理

- **隐私**:仅发**标题 + host**(不含完整路径 / query),仅手动触发;Modal 顶部延用现有告知文案(改为"整理时…")。key 仅 `chrome.storage.local`。
- **Typed 错误**:`GroupingError`(`auth` 401 / `rate_limit` 429 / `network` / `parse`)→ Modal 内联红字;生成失败**不改任何书签**。
- **应用原子性**:顺序执行、边做边攒撤销日志;任一步失败→立即回滚已完成的移动 + 删刚建的空文件夹,再抛错。不留半吊子状态。
- **幂等**:命中已有文件夹复用而非重复建;成员已在目标文件夹则跳过 move。
- **回退**:未配置 provider → 功能对现有图 / topic 零影响。

## 7. 测试策略(Vitest;provider 与 chrome 均 mock,不打真网络)

- **Grouper 解析**:mock provider 响应,验证 `ClaudeGrouper` / `OpenAICompatibleGrouper` 正确产出 `GroupProposal`;粒度/语言/最小组进 prompt;`existingGroups` 作为上下文传入。
- **预览 reducer 纯函数**:`moveMember / renameGroup / deleteGroup / mergeGroup` 迁移正确、成员不丢不重、删组回 unassigned。
- **`buildApplyPlan`**:复用 vs 新建判定、成员已在目标不 move、影响摘要计数、空/单组边界、`minGroupSize` 并入"其他"。
- **`buildUndoPlan`**:反向 move 到原 parent、删 createdFolderIds、书签被挪走时 best-effort 不炸。
- **apply 编排**:用 chromeApi mock(沿用 `chromeApi.test.ts` / `mockBookmarks` 模式)验证顺序与失败回滚。
- **`makeGrouper` 工厂**:off / 缺 key / 兼容端点缺 baseUrl·model → `null`,入口禁用。

## 8. 风险 / 待定

- **分组质量**:粒度过细则碎、过粗则糊;靠 `granularity` + `minGroupSize` + 审阅手改兜底,实测调 prompt。
- **成本**:大量书签批量分组对 Opus 偏贵;可让用户填 Haiku 4.5(prompt 里说明便宜够用),但不替用户默认降级。
- **兼容端点 CORS**:浏览器直连某些端点可能不放行——失败给清晰提示(沿用 typed error)。
- **移动一致性**:应用中若用户在别处并发改书签,以 chrome 实际状态为准;撤销 best-effort。
- **索引漂移**:撤销记录 `fromIndex` 为尽力值;若原文件夹结构已变,移回到原 parent 即可,不强求精确 index。

## 9. 分阶段实现建议(交由 writing-plans 细化)

1. 类型 + `Settings.grouping` + `DEFAULT_SETTINGS` + Tweaks 配置行与入口按钮(禁用态)。
2. `Grouper` 接口 + `ClaudeGrouper` + `makeGrouper` + `plan.ts` 纯函数(reducer / buildApplyPlan / buildUndoPlan / minGroupSize)(+ 测试)。
3. `GroupingReview` Modal + 手动改 / 重新生成 + 影响摘要 + App 接线。
4. `apply.ts`(`applyGrouping` + 撤销日志 + `undoLastGrouping`)+ `refresh()` + 撤销入口(+ 测试)。
5. `OpenAICompatibleGrouper`(+ 测试)。
