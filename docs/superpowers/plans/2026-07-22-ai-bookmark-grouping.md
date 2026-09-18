# AI 书签分组(创建分组节点 + BYOK)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 BYOK 大模型把书签分组,经审阅 Modal 手动微调 / 重新生成后,写入真实 Chrome 文件夹(图自动出现分组节点),并支持一步撤销。

**Architecture:** 复用现有 `AiSettings` provider 层,新增独立 `Grouper` 接口(Claude + OpenAI 兼容)。AI I/O 与副作用编排薄薄两层,核心逻辑(方案解析 / 预览态 reducer / 应用计划 / 撤销计划)全在 `src/services/grouping/plan.ts` 纯函数里 TDD。应用与撤销通过依赖注入 `createFolder`/`moveBookmark`/`removeFolder`,便于单测。

**Tech Stack:** TypeScript + React 18 + Vite + Vitest。`@anthropic-ai/sdk`(结构化输出)、`zod`。Chrome `bookmarks` / `storage.local` API(测试环境 `hasChromeApi=false` 自动走 `mockBookmarks`)。

## Global Constraints

- **提交策略(覆盖 writing-plans 默认):** 本仓库遵循用户 CLAUDE.md——**仅当用户明确说“提交 / commit / push”时才执行 `git commit`**。因此各任务末尾的 “Commit” 步骤在执行阶段**默认暂不提交**:改完后停在工作区,等用户开口;提交时只 `git add` 本会话新增/修改的**精确文件路径**,禁止 `git add -A/./-u`,不碰仓库里其它无关改动。
- **BYOK / 隐私:** key 仅存 `chrome.storage.local`;分组只发**书签标题 + host**(不发完整路径 / query);仅手动触发。
- **不污染持久书签数据:** `GroupProposal` / `GroupingConfig` 是运行时/设置态;唯一落盘的是撤销日志(独立 storage key `newtab-grouping-undo`)。真正的书签结构改动只经 `applyGrouping`。
- **零退化:** provider `off` / 缺 key → 入口禁用;现有图、topic 分类、`Classifier` 行为完全不变。
- **默认 Claude 模型:** `claude-opus-4-8`(`DEFAULT_CLAUDE_MODEL`,已存在于 `src/services/ai/types.ts`)。不替用户默认降级。
- **风格一致:** 复用 `Modal` / `InlineEdit` 组件与 CSS 变量(`--bg-1 / --line / --fg / --accent`)。新 UI 字符串沿用 Tweaks 现有“内联中文字面量”风格(如 `显示`/`隐藏`),不强制走 i18n。
- **测试范围:** 纯逻辑 + provider 接口用 Vitest(provider 与 chrome 均 mock,不打真网络);仓库无 RTL,**UI 组件不写单测**,验证靠 `npm run typecheck` + `npm run build`。
- **一次运行的验证命令:** 单测 `npx vitest run <path>`;全量 `npm run check`(= typecheck + test + build)。

---

## 文件结构

**新增**
- `src/services/grouping/plan.ts` — 纯函数:范围选择、方案解析、预览 reducer、最小组合并、应用/撤销计划。
- `src/services/grouping/plan.test.ts` — 上述纯函数测试。
- `src/services/grouping/errors.ts` — `GroupingError` + HTTP 状态映射。
- `src/services/grouping/store.ts` — 撤销日志 load/save/clear(chrome.storage / localStorage 双路)。
- `src/services/grouping/store.test.ts`
- `src/services/grouping/apply.ts` — `applyGrouping` / `undoLastGrouping`(DI 副作用编排)。
- `src/services/grouping/apply.test.ts`
- `src/services/ai/grouping.ts` — `Grouper` 接口 + `ClaudeGrouper` + `OpenAICompatibleGrouper` + `makeGrouper`。
- `src/services/ai/grouping.claude.test.ts`
- `src/services/ai/grouping.openai.test.ts`
- `src/components/GroupingReview.tsx` — 审阅 Modal。

**修改**
- `src/types.ts` — 新增 `GroupingConfig` / `ProposedGroup` / `GroupProposal` / `GroupingUndo`;`Settings.grouping`;`DEFAULT_SETTINGS.grouping`。
- `src/services/chromeApi.ts` — `normalizeSettings` 归一化 `grouping`。
- `src/components/Tweaks.tsx` — AI 段新增分组配置行 + “用 AI 整理分组”入口按钮 + props。
- `src/App.tsx` — `runGrouping` / `applyProposal` / `undoGrouping` + 状态 + 挂 `GroupingReview`。

---

## Task 1: 类型 + Settings.grouping + 归一化

**Files:**
- Modify: `src/types.ts`(在 `AiSettings` 后、`Settings` 前后)
- Modify: `src/services/chromeApi.ts:338-345`(`normalizeSettings`)
- Test: `src/services/chromeApi.test.ts`

**Interfaces:**
- Produces: `GroupingConfig`, `ProposedGroup`, `GroupProposal`, `GroupingUndo` 类型;`Settings.grouping: GroupingConfig`;`DEFAULT_SETTINGS.grouping`。

- [ ] **Step 1: Write the failing test** — 追加到 `src/services/chromeApi.test.ts`

```ts
import { normalizeSettings } from './chromeApi';

describe('normalizeSettings grouping', () => {
  it('fills grouping defaults when absent', () => {
    const s = normalizeSettings({ theme: 'dark' } as never);
    expect(s.grouping).toEqual({
      granularity: 'balanced',
      minGroupSize: 2,
      nameLanguage: 'auto',
      scope: 'ungrouped',
      reuseExisting: true,
    });
  });

  it('resets invalid enum fields but keeps valid overrides', () => {
    const s = normalizeSettings({ grouping: { granularity: 'nope', scope: 'all', minGroupSize: 5 } } as never);
    expect(s.grouping.granularity).toBe('balanced'); // invalid → default
    expect(s.grouping.scope).toBe('all');            // valid override kept
    expect(s.grouping.minGroupSize).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/chromeApi.test.ts`
Expected: FAIL(`s.grouping` undefined)。

- [ ] **Step 3: Add types to `src/types.ts`** — 在 `AiSettings` 接口之后插入:

```ts
export type GroupGranularity = 'coarse' | 'balanced' | 'fine';
export type GroupNameLanguage = 'auto' | 'zh' | 'en';
export type GroupScope = 'ungrouped' | 'all';

export interface GroupingConfig {
  granularity: GroupGranularity;
  /** 成员数小于此值的组合并进“其他”。 */
  minGroupSize: number;
  nameLanguage: GroupNameLanguage;
  scope: GroupScope;
  /** 允许把书签归入已有同名文件夹。 */
  reuseExisting: boolean;
}

/** AI 分组的运行时产物(未应用前不落盘)。 */
export interface ProposedGroup {
  key: string;
  name: string;
  existingFolderId?: string;
  memberIds: string[];
}
export interface GroupProposal {
  groups: ProposedGroup[];
  unassigned: string[];
}

/** 撤销日志(storage 单槽)。 */
export interface GroupingUndo {
  at: string;
  moved: { id: string; fromParentId: string }[];
  createdFolderIds: string[];
}
```

在 `Settings` 接口里,`ai: AiSettings;` 之后加:

```ts
  /** AI 分组配置(BYOK)。 */
  grouping: GroupingConfig;
```

在 `DEFAULT_SETTINGS` 里,`ai: { provider: 'off', apiKey: '', baseUrl: '', model: '' },` 之后加:

```ts
  grouping: {
    granularity: 'balanced',
    minGroupSize: 2,
    nameLanguage: 'auto',
    scope: 'ungrouped',
    reuseExisting: true,
  },
```

- [ ] **Step 4: Normalize in `src/services/chromeApi.ts`** — 在 `normalizeSettings` 里,`next.ai = ai;` 之后、`return next;` 之前插入:

```ts
  const VALID_GRANULARITY = new Set(['coarse', 'balanced', 'fine']);
  const VALID_NAME_LANG = new Set(['auto', 'zh', 'en']);
  const VALID_SCOPE = new Set(['ungrouped', 'all']);
  const grouping = { ...DEFAULT_SETTINGS.grouping, ...(next.grouping ?? {}) };
  if (!VALID_GRANULARITY.has(grouping.granularity)) grouping.granularity = DEFAULT_SETTINGS.grouping.granularity;
  if (!VALID_NAME_LANG.has(grouping.nameLanguage)) grouping.nameLanguage = DEFAULT_SETTINGS.grouping.nameLanguage;
  if (!VALID_SCOPE.has(grouping.scope)) grouping.scope = DEFAULT_SETTINGS.grouping.scope;
  if (typeof grouping.minGroupSize !== 'number' || grouping.minGroupSize < 1) {
    grouping.minGroupSize = DEFAULT_SETTINGS.grouping.minGroupSize;
  }
  if (typeof grouping.reuseExisting !== 'boolean') grouping.reuseExisting = DEFAULT_SETTINGS.grouping.reuseExisting;
  next.grouping = grouping;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/services/chromeApi.test.ts`
Expected: PASS。

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: 无错误。

- [ ] **Step 7: Commit(遵循提交策略,默认暂不提交,待用户指示)**

```bash
git add src/types.ts src/services/chromeApi.ts src/services/chromeApi.test.ts
git commit -m "feat(grouping): add GroupingConfig types + settings normalization"
```

---

## Task 2: plan.ts — 范围选择 / 方案解析 / 预览 reducer / 最小组合并

**Files:**
- Create: `src/services/grouping/plan.ts`
- Test: `src/services/grouping/plan.test.ts`

**Interfaces:**
- Consumes: `Bookmark`, `Group`, `ChromeData`, `ProposedGroup`, `GroupProposal`, `GroupingConfig`(from `../../types`)。
- Produces:
  - `selectScopedBookmarks(data: ChromeData, scope: GroupScope): Bookmark[]`
  - `toProposal(raw: { groups: { name: string; memberIds: string[] }[]; unassigned: string[] }, inputIds: string[], groups: Group[], reuseExisting: boolean): GroupProposal`
  - `applyMinGroupSize(p: GroupProposal, minSize: number, otherName: string): GroupProposal`
  - `moveMember(p: GroupProposal, memberId: string, toKey: string | null): GroupProposal`
  - `renameGroup(p: GroupProposal, key: string, name: string): GroupProposal`
  - `deleteGroup(p: GroupProposal, key: string): GroupProposal`

- [ ] **Step 1: Write failing tests** — `src/services/grouping/plan.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  selectScopedBookmarks, toProposal, applyMinGroupSize,
  moveMember, renameGroup, deleteGroup,
} from './plan';
import type { ChromeData, Group } from '../../types';

const bm = (id: string, parentId: string) =>
  ({ id, parentId, name: id, url: `https://${id}.com`, group: '', color: '', letter: id[0], visits: 0, last: '' });

const data: ChromeData = {
  bookmarks: [bm('a', 'bar'), bm('b', 'bar'), bm('c', 'folder1')],
  recents: [], groups: [{ id: 'folder1', label: 'Dev', parentGroupId: null, depth: 0 }],
  barId: 'bar', source: 'chrome',
};

describe('selectScopedBookmarks', () => {
  it('ungrouped → only bookmarks directly under barId', () => {
    expect(selectScopedBookmarks(data, 'ungrouped').map((b) => b.id)).toEqual(['a', 'b']);
  });
  it('all → every bookmark', () => {
    expect(selectScopedBookmarks(data, 'all').map((b) => b.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('toProposal', () => {
  const groups: Group[] = [{ id: 'folder1', label: 'Dev', parentGroupId: null, depth: 0 }];
  it('assigns stable keys, drops hallucinated ids, computes unassigned', () => {
    const p = toProposal(
      { groups: [{ name: 'Dev', memberIds: ['a', 'ghost'] }, { name: 'News', memberIds: ['b'] }], unassigned: [] },
      ['a', 'b', 'c'], groups, true,
    );
    expect(p.groups[0]).toMatchObject({ key: 'g0', name: 'Dev', existingFolderId: 'folder1', memberIds: ['a'] });
    expect(p.groups[1]).toMatchObject({ key: 'g1', name: 'News', memberIds: ['b'] });
    expect(p.groups[1].existingFolderId).toBeUndefined();
    expect(p.unassigned).toEqual(['c']); // c not covered by any group
  });
  it('does not resolve existing folder when reuseExisting=false', () => {
    const p = toProposal({ groups: [{ name: 'Dev', memberIds: ['a'] }], unassigned: [] }, ['a'], groups, false);
    expect(p.groups[0].existingFolderId).toBeUndefined();
  });
});

describe('applyMinGroupSize', () => {
  it('folds groups smaller than minSize into a single "other" group', () => {
    const p = { groups: [
      { key: 'g0', name: 'Big', memberIds: ['a', 'b'] },
      { key: 'g1', name: 'Tiny', memberIds: ['c'] },
    ], unassigned: [] };
    const out = applyMinGroupSize(p, 2, '其他');
    expect(out.groups.map((g) => g.name)).toEqual(['Big', '其他']);
    expect(out.groups[1].memberIds).toEqual(['c']);
    expect(out.groups[1].key).toBe('other');
  });
  it('no-op when all groups meet minSize', () => {
    const p = { groups: [{ key: 'g0', name: 'Big', memberIds: ['a', 'b'] }], unassigned: [] };
    expect(applyMinGroupSize(p, 2, '其他')).toEqual(p);
  });
});

describe('reducers', () => {
  const base = { groups: [
    { key: 'g0', name: 'A', memberIds: ['a', 'b'] },
    { key: 'g1', name: 'B', memberIds: ['c'] },
  ], unassigned: ['d'] };

  it('moveMember relocates to another group', () => {
    const out = moveMember(base, 'a', 'g1');
    expect(out.groups[0].memberIds).toEqual(['b']);
    expect(out.groups[1].memberIds).toEqual(['c', 'a']);
  });
  it('moveMember to null sends to unassigned', () => {
    expect(moveMember(base, 'a', null).unassigned).toEqual(['d', 'a']);
  });
  it('renameGroup changes only the named group', () => {
    expect(renameGroup(base, 'g0', 'X').groups[0].name).toBe('X');
  });
  it('deleteGroup returns its members to unassigned', () => {
    const out = deleteGroup(base, 'g0');
    expect(out.groups.map((g) => g.key)).toEqual(['g1']);
    expect(out.unassigned).toEqual(['d', 'a', 'b']);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/services/grouping/plan.test.ts`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: Implement `src/services/grouping/plan.ts`**

```ts
import type { Bookmark, ChromeData, Group, GroupProposal, GroupScope } from '../../types';

export function selectScopedBookmarks(data: ChromeData, scope: GroupScope): Bookmark[] {
  if (scope === 'all') return data.bookmarks;
  return data.bookmarks.filter((b) => b.parentId === data.barId);
}

export function toProposal(
  raw: { groups: { name: string; memberIds: string[] }[]; unassigned: string[] },
  inputIds: string[],
  groups: Group[],
  reuseExisting: boolean,
): GroupProposal {
  const valid = new Set(inputIds);
  const byName = new Map(groups.map((g) => [g.label.trim().toLowerCase(), g.id] as const));
  const covered = new Set<string>();
  const out = raw.groups.map((g, i) => {
    const memberIds = g.memberIds.filter((id) => valid.has(id) && !covered.has(id));
    memberIds.forEach((id) => covered.add(id));
    const existingFolderId = reuseExisting ? byName.get(g.name.trim().toLowerCase()) : undefined;
    return { key: `g${i}`, name: g.name.trim(), existingFolderId, memberIds };
  }).filter((g) => g.memberIds.length > 0);
  const unassigned = inputIds.filter((id) => !covered.has(id));
  return { groups: out, unassigned };
}

export function applyMinGroupSize(p: GroupProposal, minSize: number, otherName: string): GroupProposal {
  const keep = p.groups.filter((g) => g.memberIds.length >= minSize);
  const small = p.groups.filter((g) => g.memberIds.length < minSize);
  if (small.length === 0) return p;
  const otherMembers = small.flatMap((g) => g.memberIds);
  return {
    groups: [...keep, { key: 'other', name: otherName, memberIds: otherMembers }],
    unassigned: p.unassigned,
  };
}

function withoutMember(p: GroupProposal, id: string): GroupProposal {
  return {
    groups: p.groups.map((g) => ({ ...g, memberIds: g.memberIds.filter((m) => m !== id) })),
    unassigned: p.unassigned.filter((m) => m !== id),
  };
}

export function moveMember(p: GroupProposal, memberId: string, toKey: string | null): GroupProposal {
  const cleared = withoutMember(p, memberId);
  if (toKey === null) return { ...cleared, unassigned: [...cleared.unassigned, memberId] };
  return {
    ...cleared,
    groups: cleared.groups.map((g) => (g.key === toKey ? { ...g, memberIds: [...g.memberIds, memberId] } : g)),
  };
}

export function renameGroup(p: GroupProposal, key: string, name: string): GroupProposal {
  return { ...p, groups: p.groups.map((g) => (g.key === key ? { ...g, name } : g)) };
}

export function deleteGroup(p: GroupProposal, key: string): GroupProposal {
  const target = p.groups.find((g) => g.key === key);
  if (!target) return p;
  return {
    groups: p.groups.filter((g) => g.key !== key),
    unassigned: [...p.unassigned, ...target.memberIds],
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/services/grouping/plan.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit(遵循提交策略)**

```bash
git add src/services/grouping/plan.ts src/services/grouping/plan.test.ts
git commit -m "feat(grouping): pure plan helpers (scope, proposal, reducers, minGroupSize)"
```

---

## Task 3: plan.ts — 应用计划 / 撤销计划

**Files:**
- Modify: `src/services/grouping/plan.ts`(追加)
- Test: `src/services/grouping/plan.test.ts`(追加)

**Interfaces:**
- Produces:
  - `interface ApplyPlan { folders: { key: string; name: string; existingFolderId?: string }[]; moves: { id: string; toKey: string; fromParentId: string }[]; summary: { newFolders: number; movedBookmarks: number } }`
  - `buildApplyPlan(p: GroupProposal, bookmarks: Bookmark[]): ApplyPlan`
  - `buildUndoPlan(u: GroupingUndo): { moves: { id: string; toParentId: string }[]; removeFolderIds: string[] }`

- [ ] **Step 1: Write failing tests** — 追加到 `plan.test.ts`

```ts
import { buildApplyPlan, buildUndoPlan } from './plan';

describe('buildApplyPlan', () => {
  const bms = [bm('a', 'bar'), bm('b', 'bar'), bm('c', 'folder1')];
  it('reuses existing folder, skips members already inside it, counts new folders', () => {
    const p = {
      groups: [
        { key: 'g0', name: 'Dev', existingFolderId: 'folder1', memberIds: ['a', 'c'] }, // c already in folder1 → skip
        { key: 'g1', name: 'News', memberIds: ['b'] },                                   // new folder
      ],
      unassigned: [],
    };
    const plan = buildApplyPlan(p, bms);
    expect(plan.summary).toEqual({ newFolders: 1, movedBookmarks: 2 });
    expect(plan.moves).toEqual([
      { id: 'a', toKey: 'g0', fromParentId: 'bar' },
      { id: 'b', toKey: 'g1', fromParentId: 'bar' },
    ]);
    expect(plan.folders).toEqual([
      { key: 'g0', name: 'Dev', existingFolderId: 'folder1' },
      { key: 'g1', name: 'News', existingFolderId: undefined },
    ]);
  });
});

describe('buildUndoPlan', () => {
  it('reverses moves and lists created folders for removal', () => {
    const plan = buildUndoPlan({
      at: 't',
      moved: [{ id: 'a', fromParentId: 'bar' }, { id: 'b', fromParentId: 'bar' }],
      createdFolderIds: ['newf'],
    });
    expect(plan.moves).toEqual([{ id: 'a', toParentId: 'bar' }, { id: 'b', toParentId: 'bar' }]);
    expect(plan.removeFolderIds).toEqual(['newf']);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/services/grouping/plan.test.ts`
Expected: FAIL(`buildApplyPlan` 未导出)。

- [ ] **Step 3: Append to `src/services/grouping/plan.ts`**

先在文件顶部 import 补上 `GroupingUndo`:

```ts
import type { Bookmark, ChromeData, Group, GroupProposal, GroupScope, GroupingUndo } from '../../types';
```

追加:

```ts
export interface ApplyPlan {
  folders: { key: string; name: string; existingFolderId?: string }[];
  moves: { id: string; toKey: string; fromParentId: string }[];
  summary: { newFolders: number; movedBookmarks: number };
}

export function buildApplyPlan(p: GroupProposal, bookmarks: Bookmark[]): ApplyPlan {
  const parentById = new Map(bookmarks.map((b) => [b.id, b.parentId] as const));
  const folders = p.groups.map((g) => ({ key: g.key, name: g.name, existingFolderId: g.existingFolderId }));
  const moves: ApplyPlan['moves'] = [];
  for (const g of p.groups) {
    for (const id of g.memberIds) {
      const fromParentId = parentById.get(id) ?? '';
      if (g.existingFolderId && fromParentId === g.existingFolderId) continue; // already inside
      moves.push({ id, toKey: g.key, fromParentId });
    }
  }
  return {
    folders,
    moves,
    summary: { newFolders: folders.filter((f) => !f.existingFolderId).length, movedBookmarks: moves.length },
  };
}

export function buildUndoPlan(u: GroupingUndo): { moves: { id: string; toParentId: string }[]; removeFolderIds: string[] } {
  return {
    moves: u.moved.map((m) => ({ id: m.id, toParentId: m.fromParentId })),
    removeFolderIds: u.createdFolderIds,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/services/grouping/plan.test.ts`
Expected: PASS(全部)。

- [ ] **Step 5: Commit(遵循提交策略)**

```bash
git add src/services/grouping/plan.ts src/services/grouping/plan.test.ts
git commit -m "feat(grouping): buildApplyPlan + buildUndoPlan"
```

---

## Task 4: errors + 撤销日志 storage

**Files:**
- Create: `src/services/grouping/errors.ts`
- Create: `src/services/grouping/store.ts`
- Test: `src/services/grouping/store.test.ts`

**Interfaces:**
- Produces:
  - `class GroupingError extends Error { kind: 'auth' | 'rate_limit' | 'network' | 'parse' | 'apply' }`
  - `httpErrorKind(status: number): 'auth' | 'rate_limit' | 'network'`
  - `loadUndo(): Promise<GroupingUndo | null>` / `saveUndo(u: GroupingUndo): Promise<void>` / `clearUndo(): Promise<void>`

- [ ] **Step 1: Write failing test** — `src/services/grouping/store.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { loadUndo, saveUndo, clearUndo } from './store';

describe('grouping undo store (localStorage path)', () => {
  beforeEach(() => localStorage.clear());
  it('round-trips and clears', async () => {
    expect(await loadUndo()).toBeNull();
    await saveUndo({ at: 't', moved: [{ id: 'a', fromParentId: 'bar' }], createdFolderIds: ['f'] });
    expect(await loadUndo()).toEqual({ at: 't', moved: [{ id: 'a', fromParentId: 'bar' }], createdFolderIds: ['f'] });
    await clearUndo();
    expect(await loadUndo()).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/services/grouping/store.test.ts`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: Implement `src/services/grouping/errors.ts`**

```ts
export type GroupingErrorKind = 'auth' | 'rate_limit' | 'network' | 'parse' | 'apply';

export class GroupingError extends Error {
  kind: GroupingErrorKind;
  constructor(kind: GroupingErrorKind, message: string) {
    super(message);
    this.name = 'GroupingError';
    this.kind = kind;
  }
}

export function httpErrorKind(status: number): 'auth' | 'rate_limit' | 'network' {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  return 'network';
}
```

- [ ] **Step 4: Implement `src/services/grouping/store.ts`**(镜像 `topicCache` 的双路存取)

```ts
import { hasChromeApi } from '../chromeApi';
import type { GroupingUndo } from '../../types';

const UNDO_KEY = 'newtab-grouping-undo';

export async function loadUndo(): Promise<GroupingUndo | null> {
  if (hasChromeApi && chrome.storage?.local) {
    const obj = await chrome.storage.local.get(UNDO_KEY);
    return (obj[UNDO_KEY] as GroupingUndo) ?? null;
  }
  try {
    const raw = localStorage.getItem(UNDO_KEY);
    return raw ? (JSON.parse(raw) as GroupingUndo) : null;
  } catch {
    return null;
  }
}

export async function saveUndo(u: GroupingUndo): Promise<void> {
  if (hasChromeApi && chrome.storage?.local) {
    await chrome.storage.local.set({ [UNDO_KEY]: u });
    return;
  }
  try {
    localStorage.setItem(UNDO_KEY, JSON.stringify(u));
  } catch {
    /* noop */
  }
}

export async function clearUndo(): Promise<void> {
  if (hasChromeApi && chrome.storage?.local) {
    await chrome.storage.local.remove(UNDO_KEY);
    return;
  }
  try {
    localStorage.removeItem(UNDO_KEY);
  } catch {
    /* noop */
  }
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/services/grouping/store.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit(遵循提交策略)**

```bash
git add src/services/grouping/errors.ts src/services/grouping/store.ts src/services/grouping/store.test.ts
git commit -m "feat(grouping): typed errors + undo-journal store"
```

---

## Task 5: Grouper 接口 + ClaudeGrouper + makeGrouper(Claude)

**Files:**
- Create: `src/services/ai/grouping.ts`
- Test: `src/services/ai/grouping.claude.test.ts`

**Interfaces:**
- Consumes: `AiSettings`, `GroupingConfig`(from `../../types`);`GroupingError`(from `../grouping/errors`);`DEFAULT_CLAUDE_MODEL`(from `./types`)。
- Produces:
  - `interface GroupInput { id: string; title: string; host: string; currentGroup?: string }`
  - `interface RawProposal { groups: { name: string; memberIds: string[] }[]; unassigned: string[] }`
  - `interface Grouper { group(inputs: GroupInput[], existingGroups: string[]): Promise<RawProposal> }`
  - `class ClaudeGrouper implements Grouper`(构造 `{ apiKey; model?; config; createClient? }`)
  - `groupingSystemPrompt(config: GroupingConfig): string`(导出便于测试 prompt 内容)
  - `makeGrouper(ai: AiSettings, config: GroupingConfig): Grouper | null`

- [ ] **Step 1: Write failing test** — `src/services/ai/grouping.claude.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { ClaudeGrouper, groupingSystemPrompt, makeGrouper } from './grouping';
import type { GroupingConfig } from '../../types';

const cfg: GroupingConfig = {
  granularity: 'coarse', minGroupSize: 2, nameLanguage: 'zh', scope: 'ungrouped', reuseExisting: true,
};

describe('groupingSystemPrompt', () => {
  it('encodes granularity + language into the prompt', () => {
    const p = groupingSystemPrompt(cfg);
    expect(p).toContain('中文');       // nameLanguage zh
    expect(p.toLowerCase()).toContain('fewer'); // coarse hint
  });
});

describe('ClaudeGrouper', () => {
  it('sends title+host+existing groups and maps parsed_output', async () => {
    const parse = vi.fn().mockResolvedValue({
      parsed_output: { groups: [{ name: '开发', memberIds: ['1'] }], unassigned: ['2'] },
    });
    const g = new ClaudeGrouper({ apiKey: 'k', config: cfg, createClient: () => ({ messages: { parse } } as never) });
    const out = await g.group(
      [{ id: '1', title: 'GitHub', host: 'github.com' }, { id: '2', title: 'News', host: 'news.com' }],
      ['Dev'],
    );
    expect(out.groups).toEqual([{ name: '开发', memberIds: ['1'] }]);
    expect(out.unassigned).toEqual(['2']);
    const userMsg = (parse.mock.calls[0][0] as { messages: { content: string }[] }).messages[0].content;
    expect(userMsg).toContain('github.com');
    expect(userMsg).toContain('Dev');       // existing groups passed as context
    expect(userMsg).not.toContain('https://');
  });

  it('returns empty proposal without calling API when no inputs', async () => {
    const parse = vi.fn();
    const g = new ClaudeGrouper({ apiKey: 'k', config: cfg, createClient: () => ({ messages: { parse } } as never) });
    expect(await g.group([], [])).toEqual({ groups: [], unassigned: [] });
    expect(parse).not.toHaveBeenCalled();
  });
});

describe('makeGrouper', () => {
  it('returns null when provider off or key missing', () => {
    expect(makeGrouper({ provider: 'off', apiKey: '', baseUrl: '', model: '' }, cfg)).toBeNull();
    expect(makeGrouper({ provider: 'claude', apiKey: '', baseUrl: '', model: '' }, cfg)).toBeNull();
  });
  it('returns a ClaudeGrouper for claude+key', () => {
    expect(makeGrouper({ provider: 'claude', apiKey: 'k', baseUrl: '', model: '' }, cfg)).toBeInstanceOf(ClaudeGrouper);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/services/ai/grouping.claude.test.ts`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: Implement `src/services/ai/grouping.ts`**(OpenAI 分支留到 Task 10;此处仅 Claude)

```ts
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { AiSettings, GroupingConfig } from '../../types';
import { DEFAULT_CLAUDE_MODEL } from './types';
import { GroupingError } from '../grouping/errors';

export interface GroupInput { id: string; title: string; host: string; currentGroup?: string }
export interface RawProposal { groups: { name: string; memberIds: string[] }[]; unassigned: string[] }

export interface Grouper {
  group(inputs: GroupInput[], existingGroups: string[]): Promise<RawProposal>;
}

const Schema = z.object({
  groups: z.array(z.object({ name: z.string(), memberIds: z.array(z.string()) })),
  unassigned: z.array(z.string()),
});
const OUTPUT_FORMAT = zodOutputFormat(Schema);

const GRANULARITY_HINT: Record<GroupingConfig['granularity'], string> = {
  coarse: 'Prefer FEWER, broader groups (roughly 3-6).',
  balanced: 'Aim for a balanced number of groups (roughly 6-12).',
  fine: 'Prefer MORE, finer-grained groups (roughly 12-20).',
};
const LANG_HINT: Record<GroupingConfig['nameLanguage'], string> = {
  auto: 'Name groups in the dominant language of the bookmark titles.',
  zh: 'Name every group in 中文.',
  en: 'Name every group in English.',
};

export function groupingSystemPrompt(config: GroupingConfig): string {
  return [
    'You organize browser bookmarks into a small set of purpose-based groups.',
    GRANULARITY_HINT[config.granularity],
    LANG_HINT[config.nameLanguage],
    `Each group needs a short, human-readable name and the list of member ids that belong to it.`,
    'Reuse an existing group name verbatim when a bookmark clearly fits it.',
    'Put ids that fit no clear group into "unassigned". Assign every id exactly once.',
  ].join(' ');
}

interface ClaudeOpts {
  apiKey: string;
  model?: string;
  config: GroupingConfig;
  createClient?: (apiKey: string) => { messages: { parse: (req: unknown) => Promise<{ parsed_output: z.infer<typeof Schema> | null }> } };
}

export class ClaudeGrouper implements Grouper {
  private apiKey: string;
  private model: string;
  private config: GroupingConfig;
  private createClient: NonNullable<ClaudeOpts['createClient']>;

  constructor(opts: ClaudeOpts) {
    this.apiKey = opts.apiKey;
    this.model = opts.model || DEFAULT_CLAUDE_MODEL;
    this.config = opts.config;
    this.createClient =
      opts.createClient ?? ((apiKey) => new Anthropic({ apiKey, dangerouslyAllowBrowser: true }) as never);
  }

  async group(inputs: GroupInput[], existingGroups: string[]): Promise<RawProposal> {
    if (inputs.length === 0) return { groups: [], unassigned: [] };
    const client = this.createClient(this.apiKey);
    const list = inputs.map((s) => ({ id: s.id, title: s.title, host: s.host, group: s.currentGroup }));
    const user =
      `Existing groups (reuse when fitting): ${JSON.stringify(existingGroups)}\n` +
      `Bookmarks to group as JSON:\n${JSON.stringify(list)}`;
    try {
      const res = await client.messages.parse({
        model: this.model,
        max_tokens: 16000,
        system: groupingSystemPrompt(this.config),
        messages: [{ role: 'user', content: user }],
        output_config: { format: OUTPUT_FORMAT },
      });
      const parsed = res.parsed_output;
      if (!parsed) throw new GroupingError('parse', 'model returned no structured output');
      return { groups: parsed.groups, unassigned: parsed.unassigned };
    } catch (e) {
      if (e instanceof GroupingError) throw e;
      const status = (e as { status?: number }).status;
      if (status === 401 || status === 403) throw new GroupingError('auth', 'invalid API key');
      if (status === 429) throw new GroupingError('rate_limit', 'rate limited');
      throw new GroupingError('network', (e as Error).message || 'request failed');
    }
  }
}

export function makeGrouper(ai: AiSettings, config: GroupingConfig): Grouper | null {
  if (ai.provider === 'off' || !ai.apiKey) return null;
  if (ai.provider === 'claude') return new ClaudeGrouper({ apiKey: ai.apiKey, model: ai.model, config });
  // openai-compatible branch added in Task 10.
  return null;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/services/ai/grouping.claude.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit(遵循提交策略)**

```bash
git add src/services/ai/grouping.ts src/services/ai/grouping.claude.test.ts
git commit -m "feat(grouping): Grouper interface + ClaudeGrouper + makeGrouper"
```

---

## Task 6: apply.ts — applyGrouping + undoLastGrouping(DI 编排)

**Files:**
- Create: `src/services/grouping/apply.ts`
- Test: `src/services/grouping/apply.test.ts`

**Interfaces:**
- Consumes: `ApplyPlan` / `buildUndoPlan`(from `./plan`);`GroupingUndo`(from `../../types`);`loadUndo/saveUndo/clearUndo`(from `./store`);`GroupingError`(from `./errors`)。
- Produces:
  - `interface ApplyDeps { createFolder(parentId, title): Promise<string>; moveBookmark(id, dest): Promise<void>; removeFolder(id): Promise<void>; now(): string }`
  - `applyGrouping(plan: ApplyPlan, barId: string, deps?: Partial<ApplyDeps>): Promise<{ newFolders: number; movedBookmarks: number }>`
  - `undoLastGrouping(deps?: Partial<ApplyDeps>): Promise<boolean>`(true=已撤销)

- [ ] **Step 1: Write failing test** — `src/services/grouping/apply.test.ts`

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyGrouping, undoLastGrouping } from './apply';
import { loadUndo } from './store';
import type { ApplyPlan } from './plan';

beforeEach(() => localStorage.clear());

function fakeDeps() {
  const calls: string[] = [];
  let n = 0;
  return {
    calls,
    deps: {
      createFolder: vi.fn(async (_p: string, name: string) => { calls.push(`create:${name}`); return `newf${++n}`; }),
      moveBookmark: vi.fn(async (id: string, dest: { parentId?: string }) => { calls.push(`move:${id}->${dest.parentId}`); }),
      removeFolder: vi.fn(async (id: string) => { calls.push(`remove:${id}`); }),
      now: () => 't',
    },
  };
}

const plan: ApplyPlan = {
  folders: [
    { key: 'g0', name: 'Dev', existingFolderId: 'folder1' },
    { key: 'g1', name: 'News' }, // new
  ],
  moves: [
    { id: 'a', toKey: 'g0', fromParentId: 'bar' },
    { id: 'b', toKey: 'g1', fromParentId: 'bar' },
  ],
  summary: { newFolders: 1, movedBookmarks: 2 },
};

describe('applyGrouping', () => {
  it('creates new folders, moves bookmarks, writes an undo journal', async () => {
    const { deps, calls } = fakeDeps();
    const summary = await applyGrouping(plan, 'bar', deps);
    expect(summary).toEqual({ newFolders: 1, movedBookmarks: 2 });
    expect(calls).toEqual(['create:News', 'move:a->folder1', 'move:b->newf1']);
    expect(await loadUndo()).toEqual({
      at: 't', createdFolderIds: ['newf1'],
      moved: [{ id: 'a', fromParentId: 'bar' }, { id: 'b', fromParentId: 'bar' }],
    });
  });

  it('rolls back moves + created folders when a move fails, then throws', async () => {
    const { deps } = fakeDeps();
    deps.moveBookmark = vi.fn()
      .mockImplementationOnce(async () => {}) // a ok
      .mockRejectedValueOnce(new Error('boom')); // b fails
    await expect(applyGrouping(plan, 'bar', deps)).rejects.toMatchObject({ kind: 'apply' });
    // a moved back to bar; created folder removed
    expect(deps.moveBookmark).toHaveBeenCalledWith('a', { parentId: 'bar' });
    expect(deps.removeFolder).toHaveBeenCalledWith('newf1');
    expect(await loadUndo()).toBeNull();
  });
});

describe('undoLastGrouping', () => {
  it('reverses moves + removes created folders, then clears journal', async () => {
    const { deps, calls } = fakeDeps();
    await applyGrouping(plan, 'bar', deps);
    calls.length = 0;
    const ok = await undoLastGrouping(deps);
    expect(ok).toBe(true);
    expect(calls).toEqual(['move:a->bar', 'move:b->bar', 'remove:newf1']);
    expect(await loadUndo()).toBeNull();
  });
  it('returns false when no journal', async () => {
    const { deps } = fakeDeps();
    expect(await undoLastGrouping(deps)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/services/grouping/apply.test.ts`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: Implement `src/services/grouping/apply.ts`**

```ts
import { createFolder as realCreateFolder, moveBookmark as realMoveBookmark, removeFolder as realRemoveFolder } from '../chromeApi';
import { buildUndoPlan, type ApplyPlan } from './plan';
import { loadUndo, saveUndo, clearUndo } from './store';
import { GroupingError } from './errors';
import type { GroupingUndo } from '../../types';

export interface ApplyDeps {
  createFolder: (parentId: string, title: string) => Promise<string>;
  moveBookmark: (id: string, dest: { parentId?: string; index?: number }) => Promise<void>;
  removeFolder: (id: string) => Promise<void>;
  now: () => string;
}

function resolve(deps?: Partial<ApplyDeps>): ApplyDeps {
  return {
    createFolder: deps?.createFolder ?? realCreateFolder,
    moveBookmark: deps?.moveBookmark ?? realMoveBookmark,
    removeFolder: deps?.removeFolder ?? realRemoveFolder,
    now: deps?.now ?? (() => new Date().toISOString()),
  };
}

export async function applyGrouping(
  plan: ApplyPlan,
  barId: string,
  depsIn?: Partial<ApplyDeps>,
): Promise<{ newFolders: number; movedBookmarks: number }> {
  const deps = resolve(depsIn);
  const keyToId = new Map<string, string>();
  const createdFolderIds: string[] = [];
  const moved: GroupingUndo['moved'] = [];
  try {
    for (const f of plan.folders) {
      if (f.existingFolderId) {
        keyToId.set(f.key, f.existingFolderId);
      } else {
        const id = await deps.createFolder(barId, f.name);
        createdFolderIds.push(id);
        keyToId.set(f.key, id);
      }
    }
    for (const m of plan.moves) {
      const toId = keyToId.get(m.toKey);
      if (!toId) continue;
      await deps.moveBookmark(m.id, { parentId: toId });
      moved.push({ id: m.id, fromParentId: m.fromParentId });
    }
  } catch (e) {
    // Roll back: move done bookmarks back, remove freshly created folders.
    for (const m of moved.reverse()) {
      try { await deps.moveBookmark(m.id, { parentId: m.fromParentId }); } catch { /* best-effort */ }
    }
    for (const id of createdFolderIds.reverse()) {
      try { await deps.removeFolder(id); } catch { /* best-effort */ }
    }
    await clearUndo();
    throw new GroupingError('apply', (e as Error).message || 'apply failed');
  }
  await saveUndo({ at: deps.now(), moved, createdFolderIds });
  return plan.summary;
}

export async function undoLastGrouping(depsIn?: Partial<ApplyDeps>): Promise<boolean> {
  const deps = resolve(depsIn);
  const undo = await loadUndo();
  if (!undo) return false;
  const plan = buildUndoPlan(undo);
  for (const m of plan.moves) {
    try { await deps.moveBookmark(m.id, { parentId: m.toParentId }); } catch { /* best-effort */ }
  }
  for (const id of plan.removeFolderIds) {
    try { await deps.removeFolder(id); } catch { /* best-effort */ }
  }
  await clearUndo();
  return true;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/services/grouping/apply.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit(遵循提交策略)**

```bash
git add src/services/grouping/apply.ts src/services/grouping/apply.test.ts
git commit -m "feat(grouping): applyGrouping + undoLastGrouping with rollback"
```

---

## Task 7: GroupingReview 审阅 Modal

**Files:**
- Create: `src/components/GroupingReview.tsx`
- 验证:`npm run typecheck` + `npm run build`(仓库无 RTL,不写组件单测)

**Interfaces:**
- Consumes: `Modal`(`./Modal`)、`InlineEdit`(`./InlineEdit`)、reducers/`buildApplyPlan`(`../services/grouping/plan`)、`GroupProposal`/`Bookmark`(`../types`)。
- Produces(props):

```ts
interface Props {
  open: boolean;
  proposal: GroupProposal | null;
  bookmarks: Bookmark[];           // 用于影响摘要 + 成员标题显示
  regenerating: boolean;
  error: string | null;
  onChange: (next: GroupProposal) => void;   // 手动改回写(父组件持有 proposal)
  onRegenerate: () => void;
  onApply: () => void;
  onClose: () => void;
}
```

- [ ] **Step 1: Implement `src/components/GroupingReview.tsx`**

```tsx
import { useMemo, useState } from 'react';
import type { Bookmark, GroupProposal } from '../types';
import { Modal } from './Modal';
import { InlineEdit } from './InlineEdit';
import { buildApplyPlan, moveMember, renameGroup, deleteGroup } from '../services/grouping/plan';

interface Props {
  open: boolean;
  proposal: GroupProposal | null;
  bookmarks: Bookmark[];
  regenerating: boolean;
  error: string | null;
  onChange: (next: GroupProposal) => void;
  onRegenerate: () => void;
  onApply: () => void;
  onClose: () => void;
}

export function GroupingReview({
  open, proposal, bookmarks, regenerating, error, onChange, onRegenerate, onApply, onClose,
}: Props) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const titleById = useMemo(() => new Map(bookmarks.map((b) => [b.id, b.name] as const)), [bookmarks]);
  const summary = useMemo(
    () => (proposal ? buildApplyPlan(proposal, bookmarks).summary : { newFolders: 0, movedBookmarks: 0 }),
    [proposal, bookmarks],
  );
  const targets = proposal?.groups.map((g) => ({ key: g.key, name: g.name })) ?? [];

  return (
    <Modal open={open} onClose={onClose} title="用 AI 整理分组" width={640}>
      <p style={{ fontSize: 12, color: 'var(--fg-2)', margin: 0 }}>
        整理时会把书签标题 + 域名发送给所选服务商。应用后可一步撤销。
      </p>
      {error && <p style={{ color: '#e5484d', fontSize: 13 }}>{error}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '50vh', overflow: 'auto' }}>
        {proposal?.groups.map((g) => (
          <div key={g.key} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              {editingKey === g.key ? (
                <InlineEdit
                  value={g.name}
                  onSubmit={(name) => { onChange(renameGroup(proposal, g.key, name)); setEditingKey(null); }}
                  onCancel={() => setEditingKey(null)}
                />
              ) : (
                <strong style={{ fontSize: 13 }}>
                  {g.name} <span style={{ color: 'var(--fg-2)' }}>({g.memberIds.length})</span>
                  {g.existingFolderId && <span style={{ color: 'var(--fg-2)', fontSize: 11 }}> · 已有文件夹</span>}
                </strong>
              )}
              <span style={{ display: 'flex', gap: 6 }}>
                <button type="button" onClick={() => setEditingKey(g.key)}>重命名</button>
                <button type="button" onClick={() => onChange(deleteGroup(proposal, g.key))}>删除</button>
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {g.memberIds.map((id) => (
                <MemberChip
                  key={id}
                  label={titleById.get(id) ?? id}
                  targets={targets.filter((t) => t.key !== g.key)}
                  onMove={(toKey) => onChange(moveMember(proposal, id, toKey))}
                />
              ))}
            </div>
          </div>
        ))}

        {proposal && proposal.unassigned.length > 0 && (
          <div style={{ border: '1px dashed var(--line)', borderRadius: 10, padding: 10 }}>
            <strong style={{ fontSize: 13, color: 'var(--fg-2)' }}>未归类 ({proposal.unassigned.length})</strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {proposal.unassigned.map((id) => (
                <MemberChip
                  key={id}
                  label={titleById.get(id) ?? id}
                  targets={targets}
                  onMove={(toKey) => onChange(moveMember(proposal, id, toKey))}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--fg-2)' }}>
          将新建 {summary.newFolders} 个文件夹 · 移动 {summary.movedBookmarks} 个书签
        </span>
        <span style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onRegenerate} disabled={regenerating}>
            {regenerating ? '生成中…' : '重新生成'}
          </button>
          <button type="button" onClick={onClose}>取消</button>
          <button type="button" onClick={onApply} disabled={!proposal || summary.movedBookmarks === 0}>
            应用整理
          </button>
        </span>
      </div>
    </Modal>
  );
}

function MemberChip({
  label, targets, onMove,
}: { label: string; targets: { key: string; name: string }[]; onMove: (toKey: string | null) => void }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid var(--line)', borderRadius: 999, padding: '2px 6px', fontSize: 12 }}>
      {label}
      <select
        aria-label={`移动 ${label}`}
        value=""
        onChange={(e) => {
          const v = e.target.value;
          if (v) onMove(v === '__unassigned__' ? null : v);
          e.currentTarget.value = '';
        }}
        style={{ border: 'none', background: 'transparent', color: 'var(--fg-2)', cursor: 'pointer' }}
      >
        <option value="">移到…</option>
        {targets.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
        <option value="__unassigned__">未归类</option>
      </select>
    </span>
  );
}
```

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: 通过。若 `--danger` / `--fg-dim` token 不存在,用现有 token 替换(见 `src/styles/tokens.css`)——但不要新增 CSS 变量,回退到 `var(--fg)` / 内联色值。

- [ ] **Step 3: Commit(遵循提交策略)**

```bash
git add src/components/GroupingReview.tsx
git commit -m "feat(grouping): review modal (edit / move / regenerate / apply summary)"
```

---

## Task 8: Tweaks — 分组配置行 + 入口按钮

**Files:**
- Modify: `src/components/Tweaks.tsx`(Props 接口 + AI 段,`onClassify` 按钮那段 `558` 行附近之后)
- 验证:`npm run typecheck` + `npm run build`

**Interfaces:**
- Consumes: `settings.grouping`、`onChange`(已有,`(patch: Partial<Settings>) => void`)、新增 props `onGroup?: () => void`、`grouping?: boolean`(进行中)。
- Produces: 触发 `onGroup`(打开审阅流程)、写 `settings.grouping.*`。

- [ ] **Step 1: Extend Props** — 在 `Tweaks` 的 Props 接口里(`classifying?` / `aiReady?` 附近)追加:

```ts
  onGroup?: () => void;
  grouping?: boolean;
```

并在函数签名解构处加入 `onGroup, grouping`。

- [ ] **Step 2: Add config rows + entry button** — 在现有 `onClassify` 按钮的 `</div>`(约 `558-560` 行,`aiClassify` 那个 `<div className="row">` 之后)插入:

```tsx
              <div className="row">
                <div className="tweaks-metric"><span>分组粒度</span></div>
                <div className="toggle">
                  {(['coarse', 'balanced', 'fine'] as const).map((glevel) => (
                    <button key={glevel} type="button"
                      className={settings.grouping.granularity === glevel ? 'active' : ''}
                      onClick={() => onChange({ grouping: { ...settings.grouping, granularity: glevel } })}>
                      {glevel === 'coarse' ? '粗' : glevel === 'balanced' ? '均衡' : '细'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="row">
                <div className="tweaks-metric"><span>组名语言</span></div>
                <div className="toggle">
                  {(['auto', 'zh', 'en'] as const).map((lang) => (
                    <button key={lang} type="button"
                      className={settings.grouping.nameLanguage === lang ? 'active' : ''}
                      onClick={() => onChange({ grouping: { ...settings.grouping, nameLanguage: lang } })}>
                      {lang === 'auto' ? '自动' : lang === 'zh' ? '中文' : 'EN'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="row">
                <div className="tweaks-metric">
                  <span>整理范围</span>
                  <span className="tweaks-metric-hint">仅未分组 / 含已分组书签</span>
                </div>
                <div className="toggle">
                  <button type="button" className={settings.grouping.scope === 'ungrouped' ? 'active' : ''}
                    onClick={() => onChange({ grouping: { ...settings.grouping, scope: 'ungrouped' } })}>仅未分组</button>
                  <button type="button" className={settings.grouping.scope === 'all' ? 'active' : ''}
                    onClick={() => onChange({ grouping: { ...settings.grouping, scope: 'all' } })}>含已分组</button>
                </div>
              </div>
              <div className="row">
                <div className="tweaks-metric">
                  <span>复用已有文件夹</span>
                  <span className="tweaks-metric-hint">最小组 {settings.grouping.minGroupSize} 个以下并入“其他”</span>
                </div>
                <div className="toggle">
                  <button type="button" className={settings.grouping.reuseExisting ? 'active' : ''}
                    onClick={() => onChange({ grouping: { ...settings.grouping, reuseExisting: true } })}>开</button>
                  <button type="button" className={!settings.grouping.reuseExisting ? 'active' : ''}
                    onClick={() => onChange({ grouping: { ...settings.grouping, reuseExisting: false } })}>关</button>
                </div>
              </div>
              <div className="row">
                <button type="button" disabled={!aiReady || grouping} onClick={() => onGroup?.()}>
                  {grouping ? '整理中…' : '用 AI 整理分组'}
                </button>
              </div>
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: 通过。

- [ ] **Step 4: Commit(遵循提交策略)**

```bash
git add src/components/Tweaks.tsx
git commit -m "feat(grouping): Tweaks config rows + AI grouping entry button"
```

---

## Task 9: App 接线 + 撤销入口

**Files:**
- Modify: `src/App.tsx`
- 验证:`npm run typecheck` + `npm run build`(+ 手动冒烟,见 Step 4)

**Interfaces:**
- Consumes: `makeGrouper`(`./services/ai/grouping`)、`selectScopedBookmarks`/`toProposal`/`applyMinGroupSize`/`buildApplyPlan`(`./services/grouping/plan`)、`applyGrouping`/`undoLastGrouping`(`./services/grouping/apply`)、`loadUndo`(`./services/grouping/store`)、`GroupingReview`、`hostOf`(已 import)。

- [ ] **Step 1: Add imports** — 在 `src/App.tsx` 顶部 import 区追加:

```ts
import { makeGrouper } from './services/ai/grouping';
import { selectScopedBookmarks, toProposal, applyMinGroupSize } from './services/grouping/plan';
import { applyGrouping, undoLastGrouping } from './services/grouping/apply';
import { loadUndo } from './services/grouping/store';
import { GroupingReview } from './components/GroupingReview';
import type { GroupProposal } from './types';
```

- [ ] **Step 2: Add state + handlers** — 在 `App()` 内、`runClassify` 定义之后插入:

```ts
  const [grouping, setGrouping] = useState(false);
  const [proposal, setProposal] = useState<GroupProposal | null>(null);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);

  useEffect(() => { loadUndo().then((u) => setCanUndo(!!u)); }, []);

  const generateProposal = async (): Promise<GroupProposal | null> => {
    const grouper = makeGrouper(settings.ai, settings.grouping);
    if (!grouper || !data) return null;
    const scoped = selectScopedBookmarks(data, settings.grouping.scope);
    const inputs = scoped.map((b) => ({
      id: b.id, title: b.name, host: hostOf(b.url) ?? b.url,
      currentGroup: data.groups.find((g) => g.id === b.parentId)?.label,
    }));
    const raw = await grouper.group(inputs, data.groups.map((g) => g.label));
    const resolved = toProposal(raw, inputs.map((i) => i.id), data.groups, settings.grouping.reuseExisting);
    return applyMinGroupSize(resolved, settings.grouping.minGroupSize, '其他');
  };

  const runGrouping = async (): Promise<void> => {
    setGrouping(true);
    setGroupError(null);
    setProposal(null);
    try {
      const p = await generateProposal();
      setProposal(p);
    } catch (e) {
      setGroupError((e as Error).message || '生成分组失败');
    } finally {
      setGrouping(false);
    }
  };

  const regenerate = async (): Promise<void> => {
    setGrouping(true);
    setGroupError(null);
    try {
      const p = await generateProposal();
      setProposal(p);
    } catch (e) {
      setGroupError((e as Error).message || '生成分组失败');
    } finally {
      setGrouping(false);
    }
  };

  const applyProposal = async (): Promise<void> => {
    if (!proposal || !data?.barId) return;
    setGroupError(null);
    try {
      const { buildApplyPlan } = await import('./services/grouping/plan');
      await applyGrouping(buildApplyPlan(proposal, data.bookmarks), data.barId);
      setProposal(null);
      setCanUndo(true);
      refresh();
    } catch (e) {
      setGroupError((e as Error).message || '应用失败');
    }
  };

  const undoGrouping = async (): Promise<void> => {
    await undoLastGrouping();
    setCanUndo(false);
    refresh();
  };
```

> 说明:`buildApplyPlan` 可直接静态 import 到顶部与其它 plan 函数一起;此处用动态 import 仅为示意,执行时请把它并入 Step 1 的静态 import(`selectScopedBookmarks, toProposal, applyMinGroupSize, buildApplyPlan`)并删掉这行动态 import。

- [ ] **Step 3: Render the modal + wire Tweaks** — 给两处 `<Tweaks .../>` 都补上 props `onGroup={runGrouping}` 和 `grouping={grouping}`;并在主 `return` 的 `<Tweaks .../>` 之后加:

```tsx
      <GroupingReview
        open={!!proposal || grouping}
        proposal={proposal}
        bookmarks={data.bookmarks}
        regenerating={grouping}
        error={groupError}
        onChange={setProposal}
        onRegenerate={regenerate}
        onApply={applyProposal}
        onClose={() => { setProposal(null); setGroupError(null); }}
      />
      {canUndo && (
        <button type="button" className="grouping-undo-fab" onClick={undoGrouping}>
          撤销上次整理
        </button>
      )}
```

并把顶部 `import { useState } from 'react';` 改为 `import { useState, useEffect } from 'react';`。

- [ ] **Step 4: Typecheck, build, manual smoke**

Run: `npm run check`
Expected: typecheck + 全部测试 + build 通过。
手动冒烟(可选,`npm run dev` → 5174):provider 设 Claude + key → 点“用 AI 整理分组” → Modal 出方案 → 改一个成员 / 重命名 / 删除 → 应用 → 图出现新 group 节点 → 点“撤销上次整理”复原。

- [ ] **Step 5: Commit(遵循提交策略)**

```bash
git add src/App.tsx
git commit -m "feat(grouping): wire runGrouping / apply / undo + review modal into App"
```

---

## Task 10: OpenAICompatibleGrouper(兼容端点)

**Files:**
- Modify: `src/services/ai/grouping.ts`(追加类 + `makeGrouper` 分支)
- Test: `src/services/ai/grouping.openai.test.ts`

**Interfaces:**
- Produces: `class OpenAICompatibleGrouper implements Grouper`(构造 `{ apiKey; baseUrl; model; config; fetchFn? }`);`makeGrouper` 支持 `openai-compatible`。

- [ ] **Step 1: Write failing test** — `src/services/ai/grouping.openai.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { OpenAICompatibleGrouper, makeGrouper } from './grouping';
import type { GroupingConfig } from '../../types';

const cfg: GroupingConfig = {
  granularity: 'balanced', minGroupSize: 2, nameLanguage: 'auto', scope: 'ungrouped', reuseExisting: true,
};

describe('OpenAICompatibleGrouper', () => {
  it('posts to {baseUrl}/chat/completions and parses JSON content', async () => {
    const body = { choices: [{ message: { content: JSON.stringify({ groups: [{ name: 'Dev', memberIds: ['1'] }], unassigned: [] }) } }] };
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    const g = new OpenAICompatibleGrouper({ apiKey: 'k', baseUrl: 'https://api.example.com/v1', model: 'm', config: cfg, fetchFn });
    const out = await g.group([{ id: '1', title: 'GitHub', host: 'github.com' }], ['Dev']);
    expect(out.groups).toEqual([{ name: 'Dev', memberIds: ['1'] }]);
    expect(fetchFn.mock.calls[0][0]).toBe('https://api.example.com/v1/chat/completions');
  });

  it('throws typed auth error on 401', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const g = new OpenAICompatibleGrouper({ apiKey: 'k', baseUrl: 'u', model: 'm', config: cfg, fetchFn });
    await expect(g.group([{ id: '1', title: 'x', host: 'x.com' }], [])).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('makeGrouper openai-compatible', () => {
  it('returns null when baseUrl or model missing', () => {
    expect(makeGrouper({ provider: 'openai-compatible', apiKey: 'k', baseUrl: '', model: '' }, cfg)).toBeNull();
  });
  it('returns an OpenAICompatibleGrouper when fully configured', () => {
    expect(makeGrouper({ provider: 'openai-compatible', apiKey: 'k', baseUrl: 'u', model: 'm' }, cfg))
      .toBeInstanceOf(OpenAICompatibleGrouper);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/services/ai/grouping.openai.test.ts`
Expected: FAIL(`OpenAICompatibleGrouper` 未导出)。

- [ ] **Step 3: Append to `src/services/ai/grouping.ts`**

```ts
interface OpenAiOpts { apiKey: string; baseUrl: string; model: string; config: GroupingConfig; fetchFn?: typeof fetch }

export class OpenAICompatibleGrouper implements Grouper {
  constructor(private opts: OpenAiOpts) {}

  async group(inputs: GroupInput[], existingGroups: string[]): Promise<RawProposal> {
    if (inputs.length === 0) return { groups: [], unassigned: [] };
    const doFetch = this.opts.fetchFn ?? fetch;
    const list = inputs.map((s) => ({ id: s.id, title: s.title, host: s.host, group: s.currentGroup }));
    const system =
      groupingSystemPrompt(this.opts.config) +
      ' Reply ONLY with JSON: {"groups":[{"name":string,"memberIds":string[]}],"unassigned":string[]}.';
    let resp: Response;
    try {
      resp = await doFetch(`${this.opts.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.opts.apiKey}` },
        body: JSON.stringify({
          model: this.opts.model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: `Existing groups: ${JSON.stringify(existingGroups)}\nGroup:\n${JSON.stringify(list)}` },
          ],
        }),
      });
    } catch (e) {
      throw new GroupingError('network', (e as Error).message || 'request failed');
    }
    if (!resp.ok) throw new GroupingError(httpErrorKind(resp.status), `grouping failed: ${resp.status}`);
    const dataJson = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
    const content = dataJson.choices?.[0]?.message?.content ?? '{"groups":[],"unassigned":[]}';
    let parsed: RawProposal;
    try {
      const raw = JSON.parse(content) as Partial<RawProposal>;
      parsed = { groups: raw.groups ?? [], unassigned: raw.unassigned ?? [] };
    } catch {
      throw new GroupingError('parse', 'invalid JSON from model');
    }
    return parsed;
  }
}
```

在顶部 import 补 `httpErrorKind`:

```ts
import { GroupingError, httpErrorKind } from '../grouping/errors';
```

把 `makeGrouper` 里的注释行替换为:

```ts
  if (ai.provider === 'openai-compatible') {
    if (!ai.baseUrl || !ai.model) return null;
    return new OpenAICompatibleGrouper({ apiKey: ai.apiKey, baseUrl: ai.baseUrl, model: ai.model, config });
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/services/ai/grouping.openai.test.ts`
Expected: PASS。

- [ ] **Step 5: Full check**

Run: `npm run check`
Expected: 全绿。

- [ ] **Step 6: Commit(遵循提交策略)**

```bash
git add src/services/ai/grouping.ts src/services/ai/grouping.openai.test.ts
git commit -m "feat(grouping): OpenAI-compatible Grouper provider (BYOK)"
```

---

## 自查(计划 vs spec)

- **spec §4.1 数据模型** → Task 1(类型 + 归一化)。✅
- **spec §4.2 provider 接口 + makeGrouper** → Task 5(Claude)+ Task 10(兼容端点)。✅
- **spec §4.3 服务分层(reducer / plan / apply / store)** → Task 2/3(plan)、Task 4(store/errors)、Task 6(apply)。✅
- **spec §4.4 UI 层(Tweaks 入口 + 配置)** → Task 8。✅
- **spec §4.5 审阅 Modal 交互(移动/重命名/删除/重新生成/影响摘要)** → Task 7 + Task 9 接线。✅
- **spec §5 数据流(收集范围→group→resolve→minGroupSize→Modal→apply→refresh→undo)** → Task 9。✅
- **spec §6 隐私/typed 错误/应用原子性/幂等/回退** → Task 5/10(typed error + 只发 title+host)、Task 6(回滚 + 幂等 skip)、Task 8(aiReady 禁用)、Task 7(隐私文案)。✅
- **spec §7 测试策略** → Task 1-6、10 均含 Vitest;UI(7-9)按仓库惯例用 typecheck+build。✅
- **placeholder 扫描**:无 TBD/TODO;每个代码步骤含完整代码。✅
- **类型一致性**:`ApplyPlan` / `GroupProposal` / `RawProposal` / `GroupingUndo` / `ApplyDeps` 在各任务间签名一致;`buildApplyPlan` 在 Task 3 定义、Task 7/9 消费;`moveMember/renameGroup/deleteGroup` 在 Task 2 定义、Task 7 消费。✅

**已知与 spec 的有意偏差(brainstorming 后细化):**
1. 撤销记录去掉 `fromIndex`(Bookmark 模型无 index),撤销移回原 parent(追加),符合 spec“best-effort、不强求精确 index”。
2. 成员“移到…”用原生 `<select>` 而非耦合 `GroupSelect`(提案组尚非真实 `Group`),符合 spec“复用 GroupSelect 思路”的意图。
3. UI 组件不写单测(仓库无 RTL,且无既有组件测试),核心逻辑全在 `plan.ts` 纯函数里 TDD。
