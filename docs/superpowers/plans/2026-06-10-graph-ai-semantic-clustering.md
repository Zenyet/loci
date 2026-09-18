# AI 语义聚类 + 语义邻域 hover — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Loci 图谱用可插拔的 BYOK AI provider 把书签做语义主题分类,据此聚类/连边/着色,并把 hover 升级为同主题语义邻域高亮;无 key 时回退到现有启发式连边。

**Architecture:** 一个 `Classifier` provider 接口(默认 `ClaudeClassifier`,另有 `OpenAICompatibleClassifier`)做批量分类,结果按内容哈希增量缓存在 `chrome.storage`;纯函数 `computeTopicEdges` 用主题取代"随便找中心"的连边,`topicHue` 给主题稳定配色;`Graph.tsx` 有主题结果时走主题路径,否则回退 `computeConnectedEdges`;hover 邻域定义切换为同主题簇。

**Tech Stack:** TypeScript + React 18 + Vite + Vitest;`@anthropic-ai/sdk` + `zod`(新增);Canvas 2D 渲染;`chrome.storage.local`。

参考 spec:`docs/superpowers/specs/2026-06-10-graph-ai-semantic-clustering-design.md`

---

## 文件结构

新增:
- `src/services/ai/types.ts` — `Classifier` 接口与分类输入/输出类型。
- `src/services/ai/claude.ts` — `ClaudeClassifier`(`@anthropic-ai/sdk` + 结构化输出)。
- `src/services/ai/openaiCompatible.ts` — `OpenAICompatibleClassifier`(raw fetch)。
- `src/services/ai/index.ts` — `makeClassifier(settings.ai)` 工厂。
- `src/services/ai/claude.test.ts` / `openaiCompatible.test.ts` — provider 单测(mock,不打网络)。
- `src/services/topicCache.ts` — 哈希、读写、增量 diff。
- `src/services/topicCache.test.ts`
- `src/designs/Graph/topicEdges.ts` — `computeTopicEdges` 纯函数。
- `src/designs/Graph/topicEdges.test.ts`
- `src/designs/Graph/topicHue.ts` — 主题 → hue 稳定映射。
- `src/designs/Graph/topicHue.test.ts`
- `src/designs/Graph/topicNeighborhood.ts` — 同主题邻域集合。
- `src/designs/Graph/topicNeighborhood.test.ts`

修改:
- `src/types.ts` — `Settings.ai`、`DEFAULT_SETTINGS.ai`、`GraphItem.topics?`。
- `src/services/chromeApi.ts` — `normalizeSettings` 补 `ai` 默认与校验。
- `src/i18n.ts` — Tweaks 文案。
- `src/components/Tweaks.tsx` — provider/key/model 设置 + "用 AI 整理"按钮。
- `src/designs/Graph/render.ts` — `RenderState.topicHueById`,边/节点优先用主题色。
- `src/designs/Graph/GraphCanvas.tsx` — 透传 `topicHueById`。
- `src/designs/Graph/Graph.tsx` — 主题分类 state、主题边/回退、hover 邻域、触发分类、透传。

---

## Task 1: 安装依赖

**Files:**
- Modify: `package.json`(由 npm 写入)

- [ ] **Step 1: 安装运行时依赖**

Run:
```bash
npm install @anthropic-ai/sdk zod
```
Expected: `package.json` 的 `dependencies` 出现 `@anthropic-ai/sdk` 与 `zod`,无报错。

- [ ] **Step 2: 验证构建未破坏**

Run: `npm run check`
Expected: 现有 19 测试文件全过,`vite build` 成功。

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add @anthropic-ai/sdk and zod for AI classification"
```

---

## Task 2: 类型扩展(Settings.ai / GraphItem.topics)

**Files:**
- Modify: `src/types.ts`
- Modify: `src/services/chromeApi.ts:336`(`normalizeSettings`)
- Test: `src/services/chromeApi.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/services/chromeApi.test.ts` 末尾追加(文件已 import `DEFAULT_SETTINGS`):
```ts
import { normalizeSettings as _nz } from './chromeApi';
// 若 normalizeSettings 未导出,本任务会先导出它(见 Step 3)。

describe('normalizeSettings ai defaults', () => {
  it('fills ai defaults when absent', () => {
    const s = _nz({} as never);
    expect(s.ai).toEqual({ provider: 'off', apiKey: '', baseUrl: '', model: '' });
  });
  it('coerces an invalid provider back to off', () => {
    const s = _nz({ ai: { provider: 'bogus', apiKey: 'k', baseUrl: '', model: '' } } as never);
    expect(s.ai.provider).toBe('off');
    expect(s.ai.apiKey).toBe('k');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/chromeApi.test.ts -v`
Expected: FAIL(`normalizeSettings` 未导出 / `s.ai` 为 undefined)。

- [ ] **Step 3: 实现类型与默认值**

`src/types.ts` — 在 `SearchProviderId` 下方新增:
```ts
export type AiProvider = 'off' | 'claude' | 'openai-compatible';

export interface AiSettings {
  provider: AiProvider;
  /** BYOK API key (stored locally only). */
  apiKey: string;
  /** Base URL for openai-compatible endpoints. */
  baseUrl: string;
  /** Model id; '' means provider default (claude → claude-opus-4-8). */
  model: string;
}
```
`Settings` 接口新增字段(在 `customSearchUrl` 后):
```ts
  /** AI semantic-classification provider config (BYOK). */
  ai: AiSettings;
```
`DEFAULT_SETTINGS` 新增(在 `customSearchUrl` 后):
```ts
  ai: { provider: 'off', apiKey: '', baseUrl: '', model: '' },
```
`GraphItem` 接口新增可选字段(运行时注入,不持久化):
```ts
  /** AI-assigned semantic topics; topics[0] is the primary cluster key. */
  topics?: string[];
```

`src/services/chromeApi.ts` — 把 `normalizeSettings` 改为 `export`,并补 `ai` 规整:
```ts
const VALID_AI_PROVIDERS = new Set(['off', 'claude', 'openai-compatible']);

export function normalizeSettings(raw: Partial<Settings> | null | undefined): Settings {
  const next = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
  if (!VALID_THEMES.has(next.theme)) next.theme = DEFAULT_SETTINGS.theme;
  const ai = { ...DEFAULT_SETTINGS.ai, ...(next.ai ?? {}) };
  if (!VALID_AI_PROVIDERS.has(ai.provider)) ai.provider = 'off';
  next.ai = ai;
  return next;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/services/chromeApi.test.ts -v`
Expected: PASS。

- [ ] **Step 5: 全量校验 + Commit**

Run: `npm run check`
```bash
git add src/types.ts src/services/chromeApi.ts src/services/chromeApi.test.ts
git commit -m "feat(settings): add BYOK ai config + GraphItem.topics"
```

---

## Task 3: 主题缓存与增量 diff

**Files:**
- Create: `src/services/topicCache.ts`
- Test: `src/services/topicCache.test.ts`

- [ ] **Step 1: 写失败测试**

`src/services/topicCache.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { cacheKey, sitesNeedingClassify, mergeTopics, type TopicCache } from './topicCache';

const site = (id: string, title: string, url: string) => ({ id, title, url });

describe('cacheKey', () => {
  it('is stable for same id+title+url and changes when any differs', () => {
    const a = cacheKey(site('1', 'GitHub', 'https://github.com'));
    expect(cacheKey(site('1', 'GitHub', 'https://github.com'))).toBe(a);
    expect(cacheKey(site('1', 'GitHub renamed', 'https://github.com'))).not.toBe(a);
    expect(cacheKey(site('1', 'GitHub', 'https://gitlab.com'))).not.toBe(a);
  });
});

describe('sitesNeedingClassify', () => {
  it('returns only sites whose cacheKey is absent from cache', () => {
    const cache: TopicCache = { [cacheKey(site('1', 'GitHub', 'https://github.com'))]: { topics: ['dev'], at: 't' } };
    const sites = [site('1', 'GitHub', 'https://github.com'), site('2', 'News', 'https://news.com')];
    const need = sitesNeedingClassify(sites, cache);
    expect(need.map((s) => s.id)).toEqual(['2']);
  });
});

describe('mergeTopics', () => {
  it('maps each site id to topics from cache (after results merged in)', () => {
    const s1 = site('1', 'GitHub', 'https://github.com');
    const cache: TopicCache = { [cacheKey(s1)]: { topics: ['dev'], at: 't' } };
    const map = mergeTopics([s1], cache);
    expect(map.get('1')).toEqual(['dev']);
    expect(map.has('2')).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/topicCache.test.ts -v`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现**

`src/services/topicCache.ts`:
```ts
import { hasChromeApi } from './chromeApi';

export interface CacheSite { id: string; title: string; url: string }
export interface TopicEntry { topics: string[]; at: string }
export type TopicCache = Record<string, TopicEntry>;

const TOPIC_CACHE_KEY = 'newtab-topic-cache';

/** Stable content hash of id+title+url (FNV-1a, base36). */
export function cacheKey(s: CacheSite): string {
  const str = `${s.id} ${s.title} ${s.url}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function sitesNeedingClassify(sites: CacheSite[], cache: TopicCache): CacheSite[] {
  return sites.filter((s) => !cache[cacheKey(s)]);
}

/** id → topics, for sites present in cache. */
export function mergeTopics(sites: CacheSite[], cache: TopicCache): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const s of sites) {
    const entry = cache[cacheKey(s)];
    if (entry) out.set(s.id, entry.topics);
  }
  return out;
}

export async function loadTopicCache(): Promise<TopicCache> {
  if (hasChromeApi && chrome.storage?.local) {
    const obj = await chrome.storage.local.get(TOPIC_CACHE_KEY);
    return (obj[TOPIC_CACHE_KEY] as TopicCache) ?? {};
  }
  try {
    const raw = localStorage.getItem(TOPIC_CACHE_KEY);
    return raw ? (JSON.parse(raw) as TopicCache) : {};
  } catch {
    return {};
  }
}

export async function saveTopicCache(cache: TopicCache): Promise<void> {
  if (hasChromeApi && chrome.storage?.local) {
    await chrome.storage.local.set({ [TOPIC_CACHE_KEY]: cache });
    return;
  }
  try {
    localStorage.setItem(TOPIC_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* noop */
  }
}
```
> 注:`hasChromeApi` 已在 `chromeApi.ts:16` 导出。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/services/topicCache.test.ts -v`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/services/topicCache.ts src/services/topicCache.test.ts
git commit -m "feat(ai): topic cache with content-hash incremental diff"
```

---

## Task 4: `computeTopicEdges` 纯函数

**Files:**
- Create: `src/designs/Graph/topicEdges.ts`
- Test: `src/designs/Graph/topicEdges.test.ts`

- [ ] **Step 1: 写失败测试**

`src/designs/Graph/topicEdges.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { GraphEdge, GraphItem } from '../../types';
import { computeTopicEdges } from './topicEdges';
import { edgeId } from './edges';

const item = (id: string, visits = 0, topics: string[] = []): GraphItem => ({
  id, parentId: 'root', name: id, url: `https://${id}.com`, group: 'g',
  color: '#000', letter: id[0]!.toUpperCase(), visits, last: '', topics,
});

const isConnected = (ids: string[], edges: GraphEdge[]): boolean => {
  if (ids.length === 0) return true;
  const adj = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of edges) { adj.get(e.from)?.push(e.to); adj.get(e.to)?.push(e.from); }
  const seen = new Set([ids[0]!]); const q = [ids[0]!];
  while (q.length) for (const n of adj.get(q.shift()!) ?? []) if (!seen.has(n)) { seen.add(n); q.push(n); }
  return seen.size === ids.length;
};

describe('computeTopicEdges', () => {
  it('returns nothing for fewer than two nodes', () => {
    expect(computeTopicEdges([], new Map(), [])).toEqual([]);
    expect(computeTopicEdges([item('a')], new Map([['a', ['dev']]]), [])).toEqual([]);
  });

  it('stars within each topic then links topic hubs into one component', () => {
    const nodes = [item('a', 5), item('b', 9), item('c', 2), item('d', 7), item('e', 1)];
    const topics = new Map([
      ['a', ['dev']], ['b', ['dev']], ['c', ['news']], ['d', ['news']], ['e', ['solo']],
    ]);
    const out = computeTopicEdges(nodes, topics, []);
    expect(out.every((e) => e.kind === 'auto')).toBe(true);
    expect(isConnected(nodes.map((n) => n.id), out)).toBe(true);
  });

  it('uses topics[0] as the primary cluster key', () => {
    const nodes = [item('a', 1), item('b', 2)];
    const topics = new Map([['a', ['dev', 'x']], ['b', ['dev', 'y']]]);
    const out = computeTopicEdges(nodes, topics, []);
    // both share primary 'dev' → one intra-cluster edge a-b
    expect(out).toHaveLength(1);
    expect([out[0]!.from, out[0]!.to].sort()).toEqual(['a', 'b']);
  });

  it('treats a node with no topic as its own singleton cluster (still connected)', () => {
    const nodes = [item('a', 1, ['dev']), item('b', 2, ['dev']), item('c', 3)];
    const topics = new Map([['a', ['dev']], ['b', ['dev']]]); // c absent
    const out = computeTopicEdges(nodes, topics, []);
    expect(isConnected(['a', 'b', 'c'], out)).toBe(true);
  });

  it('does not shadow a manual edge', () => {
    const nodes = [item('a', 1), item('b', 2)];
    const topics = new Map([['a', ['dev']], ['b', ['dev']]]);
    const manual: GraphEdge[] = [{ id: edgeId('a', 'b'), from: 'b', to: 'a', kind: 'manual' }];
    expect(computeTopicEdges(nodes, topics, manual)).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/designs/Graph/topicEdges.test.ts -v`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现**

`src/designs/Graph/topicEdges.ts`:
```ts
import type { GraphEdge, GraphItem } from '../../types';
import { edgeId } from './edges';

/** Highest-visit node wins; ties break by id ascending for stable output. */
function hubOf(nodes: GraphItem[]): GraphItem {
  return [...nodes].sort((a, b) => b.visits - a.visits || (a.id < b.id ? -1 : 1))[0]!;
}

/** Primary topic = topics[0]; nodes without one get a unique singleton key. */
function primaryKey(n: GraphItem, topicMap: Map<string, string[]>): string {
  const t = topicMap.get(n.id);
  return t && t.length ? `t:${t[0]}` : `solo:${n.id}`;
}

/**
 * Connect every node into one network using AI topics as the clustering
 * dimension: star each topic cluster to its busiest member, then star every
 * cluster hub to the single global hub. Display-only ('auto') edges that never
 * shadow a manual edge.
 */
export function computeTopicEdges(
  nodes: GraphItem[],
  topicMap: Map<string, string[]>,
  manualEdges: GraphEdge[]
): GraphEdge[] {
  if (nodes.length < 2) return [];

  const seen = new Set<string>();
  for (const e of manualEdges) seen.add(edgeId(e.from, e.to));

  const out: GraphEdge[] = [];
  const link = (a: GraphItem, b: GraphItem): void => {
    if (a.id === b.id) return;
    const id = edgeId(a.id, b.id);
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, from: a.id, to: b.id, kind: 'auto' });
  };

  const byTopic = new Map<string, GraphItem[]>();
  for (const n of nodes) {
    const key = primaryKey(n, topicMap);
    const bucket = byTopic.get(key);
    if (bucket) bucket.push(n);
    else byTopic.set(key, [n]);
  }

  const clusterHubs: GraphItem[] = [];
  for (const members of byTopic.values()) {
    const hub = hubOf(members);
    clusterHubs.push(hub);
    for (const n of members) link(hub, n);
  }

  if (clusterHubs.length > 1) {
    const globalHub = hubOf(clusterHubs);
    for (const hub of clusterHubs) link(globalHub, hub);
  }

  return out;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/designs/Graph/topicEdges.test.ts -v`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/designs/Graph/topicEdges.ts src/designs/Graph/topicEdges.test.ts
git commit -m "feat(graph): computeTopicEdges — cluster by AI topic into one network"
```

---

## Task 5: 主题 → hue 稳定映射

**Files:**
- Create: `src/designs/Graph/topicHue.ts`
- Test: `src/designs/Graph/topicHue.test.ts`

- [ ] **Step 1: 写失败测试**

`src/designs/Graph/topicHue.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { GraphItem } from '../../types';
import { topicHue, topicHueById } from './topicHue';

const item = (id: string, topics?: string[]): GraphItem => ({
  id, parentId: 'root', name: id, url: `https://${id}.com`, group: 'g',
  color: '#000', letter: 'X', visits: 0, last: '', topics,
});

describe('topicHue', () => {
  it('is deterministic and in [0,360)', () => {
    const h = topicHue('dev');
    expect(topicHue('dev')).toBe(h);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(360);
  });
  it('differs for different topics', () => {
    expect(topicHue('dev')).not.toBe(topicHue('news'));
  });
});

describe('topicHueById', () => {
  it('maps each node id to its primary topic hue, skipping topicless nodes', () => {
    const map = topicHueById([item('a', ['dev']), item('b', [])], new Map([['a', ['dev']]]));
    expect(map.get('a')).toBe(topicHue('dev'));
    expect(map.has('b')).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/designs/Graph/topicHue.test.ts -v`
Expected: FAIL。

- [ ] **Step 3: 实现**

`src/designs/Graph/topicHue.ts`:
```ts
import type { GraphItem } from '../../types';

/** Deterministic hue in [0,360) from a topic label (FNV-1a). */
export function topicHue(topic: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < topic.length; i++) {
    h ^= topic.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 360;
}

/** id → hue for nodes that have a primary topic in topicMap. */
export function topicHueById(
  nodes: GraphItem[],
  topicMap: Map<string, string[]>
): Map<string, number> {
  const out = new Map<string, number>();
  for (const n of nodes) {
    const t = topicMap.get(n.id);
    if (t && t.length) out.set(n.id, topicHue(t[0]!));
  }
  return out;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/designs/Graph/topicHue.test.ts -v`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/designs/Graph/topicHue.ts src/designs/Graph/topicHue.test.ts
git commit -m "feat(graph): stable topic→hue mapping"
```

---

## Task 6: 同主题邻域(hover 用)

**Files:**
- Create: `src/designs/Graph/topicNeighborhood.ts`
- Test: `src/designs/Graph/topicNeighborhood.test.ts`

- [ ] **Step 1: 写失败测试**

`src/designs/Graph/topicNeighborhood.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { topicNeighborhood } from './topicNeighborhood';

describe('topicNeighborhood', () => {
  const topics = new Map([
    ['a', ['dev']], ['b', ['dev']], ['c', ['news']],
  ]);
  it('returns all node ids sharing the focused node primary topic, incl. itself', () => {
    expect(topicNeighborhood('a', topics)).toEqual(new Set(['a', 'b']));
  });
  it('returns just the node itself when it has no topic', () => {
    expect(topicNeighborhood('z', topics)).toEqual(new Set(['z']));
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/designs/Graph/topicNeighborhood.test.ts -v`
Expected: FAIL。

- [ ] **Step 3: 实现**

`src/designs/Graph/topicNeighborhood.ts`:
```ts
/** Set of node ids sharing the focused node's primary topic (always includes id). */
export function topicNeighborhood(
  id: string,
  topicMap: Map<string, string[]>
): Set<string> {
  const own = topicMap.get(id);
  const primary = own && own.length ? own[0] : null;
  const out = new Set<string>([id]);
  if (primary == null) return out;
  for (const [other, topics] of topicMap) {
    if (topics.length && topics[0] === primary) out.add(other);
  }
  return out;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/designs/Graph/topicNeighborhood.test.ts -v`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/designs/Graph/topicNeighborhood.ts src/designs/Graph/topicNeighborhood.test.ts
git commit -m "feat(graph): same-topic neighborhood helper for hover"
```

---

## Task 7: 渲染按主题着色(`topicHueById` 进 RenderState)

**Files:**
- Modify: `src/designs/Graph/render.ts`
- Test: `src/designs/Graph/render.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/designs/Graph/render.test.ts` 末尾追加:
```ts
import { hueForNode } from './render';

describe('hueForNode', () => {
  const node = { id: 'a', groupHue: 120 } as never;
  it('prefers a topic hue when present', () => {
    expect(hueForNode(node, new Map([['a', 47]]))).toBe(47);
  });
  it('falls back to groupHue when no topic hue', () => {
    expect(hueForNode(node, new Map())).toBe(120);
    expect(hueForNode(node, null)).toBe(120);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/designs/Graph/render.test.ts -t hueForNode -v`
Expected: FAIL(`hueForNode` 未导出)。

- [ ] **Step 3: 实现**

`src/designs/Graph/render.ts` —

1) 在 `RenderState` 接口内(`focusNeighborhood` 附近)新增:
```ts
  /** id → topic hue; overrides groupHue when present. Null = no AI topics. */
  topicHueById?: Map<string, number> | null;
```

2) 新增导出辅助函数(放在 `hueString` 附近):
```ts
export function hueForNode(
  n: { id: string; groupHue: number },
  topicHueById: Map<string, number> | null | undefined
): number {
  const t = topicHueById?.get(n.id);
  return t == null ? n.groupHue : t;
}
```

3) `drawEdges` 内,把渐变两端的 `a.groupHue`/`b.groupHue` 改为主题色优先(替换当前 render.ts:319-320 两行):
```ts
    grad.addColorStop(0, hueString(hueForNode(a, state.topicHueById)));
    grad.addColorStop(1, hueString(hueForNode(b, state.topicHueById)));
```

4) `drawNodes` 内,无 favicon 兜底圆与首字母用色处(render.ts:432 与 471),把 `n.groupHue` 改为:
```ts
      ctx.fillStyle = hueString(hueForNode(n, state.topicHueById), isDark ? 55 : 66, 0.16); // line ~432
```
```ts
      ctx.fillStyle = hueString(hueForNode(n, state.topicHueById), 80); // line ~471
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/designs/Graph/render.test.ts -v`
Expected: PASS(全部,含既有用例)。

- [ ] **Step 5: Commit**

```bash
git add src/designs/Graph/render.ts src/designs/Graph/render.test.ts
git commit -m "feat(graph): color edges/nodes by AI topic hue when available"
```

---

## Task 8: GraphCanvas 透传 `topicHueById`

**Files:**
- Modify: `src/designs/Graph/GraphCanvas.tsx`

- [ ] **Step 1: 新增 prop**

在 `GraphCanvas` props 接口(`autoEdges?` 附近,约 GraphCanvas.tsx:16)新增:
```ts
  /** id → topic hue; when set, overrides folder groupHue in rendering. */
  topicHueById?: Map<string, number> | null;
```

- [ ] **Step 2: 注入 RenderState**

在 RenderState 组装处(GraphCanvas.tsx:360 起,`focusNeighborhood` 那一行附近)新增一行:
```ts
          topicHueById: props.topicHueById ?? null,
```
并把 `props.topicHueById` 加入该 effect 的依赖数组(GraphCanvas.tsx:420 的 deps 列表)。

- [ ] **Step 3: 校验 + Commit**

Run: `npm run check`
```bash
git add src/designs/Graph/GraphCanvas.tsx
git commit -m "feat(graph): thread topicHueById into render state"
```

---

## Task 9: Graph.tsx 接线 — 主题边/回退/着色/hover/state

**Files:**
- Modify: `src/designs/Graph/Graph.tsx`

> 本任务把主题数据接入图。分类的"触发与抓取"在 Task 11(orchestration)完成;这里先把
> `topicMap` 作为 React state,空 Map 时行为与现状完全一致(回退 `computeConnectedEdges`)。

- [ ] **Step 1: 引入 state 与 imports**

顶部 import 增补:
```ts
import { computeTopicEdges } from "./topicEdges";
import { topicHueById as computeTopicHueById } from "./topicHue";
import { topicNeighborhood } from "./topicNeighborhood";
```
组件内(其它 `useState` 附近,如 Graph.tsx:106)新增:
```ts
  const [topicMap, setTopicMap] = useState<Map<string, string[]>>(new Map());
```

- [ ] **Step 2: 改 autoEdges memo 为主题优先、回退启发式**

替换现有 `autoEdges` memo(Graph.tsx:586-589):
```ts
  const autoEdges = useMemo(
    () =>
      !settings.showEdges
        ? []
        : topicMap.size
          ? computeTopicEdges(visibleGraphItems, topicMap, edges)
          : computeConnectedEdges(visibleGraphItems, edges),
    [visibleGraphItems, edges, settings.showEdges, topicMap]
  );
```
> 保留 `computeConnectedEdges` 的 import。

- [ ] **Step 3: 计算 topicHueById 并附在节点上**

在 `autoEdges` memo 之后新增:
```ts
  const topicHueById = useMemo(
    () => (topicMap.size ? computeTopicHueById(visibleGraphItems, topicMap) : null),
    [visibleGraphItems, topicMap]
  );
```
并把 `topics` 注入渲染节点 —— 在 `visibleGraphItems` 的 map 内(Graph.tsx:579,bookmark 分支)补 `topics`:
```ts
          .map((b) => ({ ...b, nodeKind: "bookmark" as const, topics: topicMap.get(b.id) }))
```
> `visibleGraphItems` 的 deps 数组加上 `topicMap`(Graph.tsx:582)。

- [ ] **Step 4: hover 邻域改为同主题(有主题时)**

替换 `canvasFocusSet`(Graph.tsx:225):
```ts
  const canvasFocusSet = focusedNodeId
    ? topicMap.size
      ? topicNeighborhood(focusedNodeId, topicMap)
      : focusNeighborhood
    : null;
```

- [ ] **Step 5: 透传 topicHueById 给 GraphCanvas**

在 `<GraphCanvas ... >`(Graph.tsx:662 附近,`autoEdges={autoEdges}` 下一行)新增:
```tsx
        topicHueById={topicHueById}
```

- [ ] **Step 6: 校验 + Commit**

Run: `npm run check`
Expected: 全过、build 成功;此时 `topicMap` 仍为空,运行时行为与现状一致。
```bash
git add src/designs/Graph/Graph.tsx
git commit -m "feat(graph): use topic edges/colors/neighborhood when topics present (fallback otherwise)"
```

---

## Task 10: Classifier 接口 + Claude provider

**Files:**
- Create: `src/services/ai/types.ts`
- Create: `src/services/ai/claude.ts`
- Create: `src/services/ai/index.ts`
- Test: `src/services/ai/claude.test.ts`

- [ ] **Step 1: 定义接口类型**

`src/services/ai/types.ts`:
```ts
export interface ClassifyInput { id: string; title: string; host: string }
export interface ClassifyResult { topics: string[] }

export interface Classifier {
  /** Batch-classify sites into 1–3 semantic topics each. */
  classify(sites: ClassifyInput[]): Promise<Map<string, ClassifyResult>>;
}

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-4-8';
```

- [ ] **Step 2: 写失败测试(注入假 client,不打网络)**

`src/services/ai/claude.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { ClaudeClassifier } from './claude';

describe('ClaudeClassifier', () => {
  it('sends only title+host and maps parsed_output back to id→topics', async () => {
    const parse = vi.fn().mockResolvedValue({
      parsed_output: { items: [{ id: '1', topics: ['dev'] }, { id: '2', topics: ['news'] }] },
    });
    const fakeClient = { messages: { parse } } as never;
    const c = new ClaudeClassifier({ apiKey: 'k', model: 'claude-opus-4-8', createClient: () => fakeClient });

    const out = await c.classify([
      { id: '1', title: 'GitHub', host: 'github.com' },
      { id: '2', title: 'Hacker News', host: 'news.ycombinator.com' },
    ]);

    expect(out.get('1')).toEqual({ topics: ['dev'] });
    expect(out.get('2')).toEqual({ topics: ['news'] });
    // payload carries title+host, never full urls
    const payload = JSON.stringify(parse.mock.calls[0][0]);
    expect(payload).toContain('github.com');
    expect(payload).not.toContain('https://');
  });

  it('returns an empty map for no sites without calling the API', async () => {
    const parse = vi.fn();
    const c = new ClaudeClassifier({ apiKey: 'k', createClient: () => ({ messages: { parse } } as never) });
    expect((await c.classify([])).size).toBe(0);
    expect(parse).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `npx vitest run src/services/ai/claude.test.ts -v`
Expected: FAIL(模块不存在)。

- [ ] **Step 4: 实现 Claude provider**

`src/services/ai/claude.ts`:
```ts
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { type Classifier, type ClassifyInput, type ClassifyResult, DEFAULT_CLAUDE_MODEL } from './types';

const Schema = z.object({
  items: z.array(z.object({ id: z.string(), topics: z.array(z.string()) })),
});

interface ClaudeOpts {
  apiKey: string;
  model?: string;
  /** Injectable for tests. */
  createClient?: (apiKey: string) => { messages: { parse: (req: unknown) => Promise<{ parsed_output: z.infer<typeof Schema> | null }> } };
}

const SYSTEM =
  'You label browser bookmarks with 1-3 short, lowercase semantic topic tags ' +
  '(e.g. "dev tools", "news", "design", "ai"). Group sites that serve a similar ' +
  'purpose under the SAME tag wording. Return one entry per input id.';

export class ClaudeClassifier implements Classifier {
  private apiKey: string;
  private model: string;
  private createClient: NonNullable<ClaudeOpts['createClient']>;

  constructor(opts: ClaudeOpts) {
    this.apiKey = opts.apiKey;
    this.model = opts.model || DEFAULT_CLAUDE_MODEL;
    this.createClient =
      opts.createClient ??
      ((apiKey) => new Anthropic({ apiKey, dangerouslyAllowBrowser: true }) as never);
  }

  async classify(sites: ClassifyInput[]): Promise<Map<string, ClassifyResult>> {
    const out = new Map<string, ClassifyResult>();
    if (sites.length === 0) return out;

    const client = this.createClient(this.apiKey);
    const list = sites.map((s) => ({ id: s.id, title: s.title, host: s.host }));
    const res = await client.messages.parse({
      model: this.model,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: 'user', content: `Classify these sites as JSON:\n${JSON.stringify(list)}` }],
      output_config: { format: zodOutputFormat(Schema) },
    });

    for (const item of res.parsed_output?.items ?? []) {
      out.set(item.id, { topics: item.topics.slice(0, 3) });
    }
    return out;
  }
}
```

- [ ] **Step 5: 工厂**

`src/services/ai/index.ts`:
```ts
import type { AiSettings } from '../../types';
import type { Classifier } from './types';
import { ClaudeClassifier } from './claude';
import { OpenAICompatibleClassifier } from './openaiCompatible';

/** null = AI off / not configured → caller falls back to heuristic edges. */
export function makeClassifier(ai: AiSettings): Classifier | null {
  if (ai.provider === 'off' || !ai.apiKey) return null;
  if (ai.provider === 'claude') return new ClaudeClassifier({ apiKey: ai.apiKey, model: ai.model });
  if (ai.provider === 'openai-compatible') {
    if (!ai.baseUrl || !ai.model) return null;
    return new OpenAICompatibleClassifier({ apiKey: ai.apiKey, baseUrl: ai.baseUrl, model: ai.model });
  }
  return null;
}

export type { Classifier } from './types';
```
> `OpenAICompatibleClassifier` 在 Task 12 创建;本任务先建一个最小占位以让 `index.ts` 编译:
> 创建 `src/services/ai/openaiCompatible.ts` 仅含:
```ts
import type { Classifier, ClassifyInput, ClassifyResult } from './types';
export class OpenAICompatibleClassifier implements Classifier {
  constructor(_opts: { apiKey: string; baseUrl: string; model: string }) {}
  async classify(_sites: ClassifyInput[]): Promise<Map<string, ClassifyResult>> { return new Map(); }
}
```

- [ ] **Step 6: 运行确认通过**

Run: `npx vitest run src/services/ai/claude.test.ts -v && npm run check`
Expected: PASS + build 成功。

- [ ] **Step 7: Commit**

```bash
git add src/services/ai/types.ts src/services/ai/claude.ts src/services/ai/index.ts src/services/ai/openaiCompatible.ts src/services/ai/claude.test.ts
git commit -m "feat(ai): Classifier interface + ClaudeClassifier (structured output, BYOK)"
```

---

## Task 11: 触发分类(orchestration)+ 设置 UI + i18n

**Files:**
- Modify: `src/i18n.ts`
- Modify: `src/components/Tweaks.tsx`
- Modify: `src/designs/Graph/Graph.tsx`

- [ ] **Step 1: i18n 文案**

`src/i18n.ts` 的 tweaks 块(showEdgesHint 附近,约 i18n.ts:136)新增:
```ts
    aiProvider: 'AI 分类',
    aiProviderHint: '用大模型按语义给书签分类、聚类、连线（BYOK，仅手动触发，发送标题+域名）。',
    aiApiKey: 'API Key',
    aiModel: '模型',
    aiClassify: '用 AI 整理',
    aiClassifying: '分类中…',
```
> 若项目有多语言 locale，需在每个 locale 的 tweaks 块补同名键。

- [ ] **Step 2: Graph.tsx 暴露 classify 动作**

Graph.tsx 顶部 import:
```ts
import { makeClassifier } from "../../services/ai";
import { hostOf } from "./relationSuggest";
import { loadTopicCache, saveTopicCache, sitesNeedingClassify, mergeTopics, cacheKey } from "../../services/topicCache";
```
组件内新增分类状态与函数(在 `topicMap` state 附近):
```ts
  const [classifying, setClassifying] = useState(false);

  // 启动时用缓存填充已分类结果
  useEffect(() => {
    let alive = true;
    loadTopicCache().then((cache) => {
      if (!alive) return;
      const sites = visibleGraphItems
        .filter((b) => b.nodeKind !== "group")
        .map((b) => ({ id: b.id, title: b.name, url: b.url }));
      setTopicMap(mergeTopics(sites, cache));
    });
    return () => { alive = false; };
    // 仅启动时;后续由手动分类更新
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const runClassify = async (): Promise<void> => {
    const classifier = makeClassifier(settings.ai);
    if (!classifier) return;
    setClassifying(true);
    try {
      const cache = await loadTopicCache();
      const sites = visibleGraphItems
        .filter((b) => b.nodeKind !== "group")
        .map((b) => ({ id: b.id, title: b.name, url: b.url }));
      const need = sitesNeedingClassify(sites, cache);
      if (need.length) {
        const inputs = need.map((s) => ({ id: s.id, title: s.title, host: hostOf(s.url) ?? s.url }));
        const result = await classifier.classify(inputs);
        const now = new Date().toISOString();
        for (const s of need) {
          const r = result.get(s.id);
          if (r) cache[cacheKey(s)] = { topics: r.topics, at: now };
        }
        await saveTopicCache(cache);
      }
      setTopicMap(mergeTopics(sites, cache));
    } finally {
      setClassifying(false);
    }
  };
```
> 把 `runClassify` / `classifying` 透传到渲染 Tweaks 的位置(Graph.tsx 已渲染 `<Tweaks settings onChange ... />`,给它加 `onClassify={runClassify}` `classifying={classifying}` `aiReady={settings.ai.provider !== 'off' && !!settings.ai.apiKey}`)。

- [ ] **Step 3: Tweaks.tsx provider/key/model + 按钮**

`Tweaks.tsx` 的 props 接口新增:
```ts
  onClassify?: () => void;
  classifying?: boolean;
  aiReady?: boolean;
```
在 `showEdges` row 之后(Tweaks.tsx:515 后)插入:
```tsx
          <div className="row">
            <div className="tweaks-metric">
              <span>{copy.tweaks.aiProvider}</span>
              <span className="tweaks-metric-hint">{copy.tweaks.aiProviderHint}</span>
            </div>
            <div className="toggle">
              <button type="button" className={settings.ai.provider === 'off' ? 'active' : ''}
                onClick={() => onChange({ ai: { ...settings.ai, provider: 'off' } })}>关闭</button>
              <button type="button" className={settings.ai.provider === 'claude' ? 'active' : ''}
                onClick={() => onChange({ ai: { ...settings.ai, provider: 'claude' } })}>Claude</button>
              <button type="button" className={settings.ai.provider === 'openai-compatible' ? 'active' : ''}
                onClick={() => onChange({ ai: { ...settings.ai, provider: 'openai-compatible' } })}>兼容端点</button>
            </div>
          </div>
          {settings.ai.provider !== 'off' && (
            <>
              <div className="row">
                <div className="tweaks-metric"><span>{copy.tweaks.aiApiKey}</span></div>
                <input type="password" value={settings.ai.apiKey}
                  onChange={(e) => onChange({ ai: { ...settings.ai, apiKey: e.target.value } })} />
              </div>
              {settings.ai.provider === 'openai-compatible' && (
                <div className="row">
                  <div className="tweaks-metric"><span>Base URL</span></div>
                  <input type="text" value={settings.ai.baseUrl}
                    onChange={(e) => onChange({ ai: { ...settings.ai, baseUrl: e.target.value } })} />
                </div>
              )}
              <div className="row">
                <div className="tweaks-metric"><span>{copy.tweaks.aiModel}</span></div>
                <input type="text" placeholder="claude-opus-4-8 / claude-haiku-4-5"
                  value={settings.ai.model}
                  onChange={(e) => onChange({ ai: { ...settings.ai, model: e.target.value } })} />
              </div>
              <div className="row">
                <button type="button" disabled={!aiReady || classifying} onClick={() => onClassify?.()}>
                  {classifying ? copy.tweaks.aiClassifying : copy.tweaks.aiClassify}
                </button>
              </div>
            </>
          )}
```

- [ ] **Step 4: 校验 + Commit**

Run: `npm run check`
Expected: 全过、build 成功。
```bash
git add src/i18n.ts src/components/Tweaks.tsx src/designs/Graph/Graph.tsx
git commit -m "feat(ai): manual classify trigger + provider/key/model settings UI"
```

- [ ] **Step 5: 真机验证(手动)**

构建并在 Chrome 加载 `dist/`,设置里选 Claude、填 key、点"用 AI 整理":
Run: `npm run build`
Expected: 分类完成后,节点按主题成簇、同簇连线、hover 同主题亮起;刷新后(缓存)立即带主题,不重复调用。

---

## Task 12: OpenAI 兼容 provider

**Files:**
- Modify: `src/services/ai/openaiCompatible.ts`(替换 Task 10 的占位)
- Test: `src/services/ai/openaiCompatible.test.ts`

- [ ] **Step 1: 写失败测试(注入假 fetch)**

`src/services/ai/openaiCompatible.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { OpenAICompatibleClassifier } from './openaiCompatible';

describe('OpenAICompatibleClassifier', () => {
  it('posts to {baseUrl}/chat/completions and parses JSON content', async () => {
    const body = { choices: [{ message: { content: JSON.stringify({ items: [{ id: '1', topics: ['dev'] }] }) } }] };
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    const c = new OpenAICompatibleClassifier({
      apiKey: 'k', baseUrl: 'https://api.example.com/v1', model: 'm', fetchFn,
    });
    const out = await c.classify([{ id: '1', title: 'GitHub', host: 'github.com' }]);
    expect(out.get('1')).toEqual({ topics: ['dev'] });
    expect(fetchFn.mock.calls[0][0]).toBe('https://api.example.com/v1/chat/completions');
  });

  it('returns empty map without calling fetch when no sites', async () => {
    const fetchFn = vi.fn();
    const c = new OpenAICompatibleClassifier({ apiKey: 'k', baseUrl: 'u', model: 'm', fetchFn });
    expect((await c.classify([])).size).toBe(0);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/ai/openaiCompatible.test.ts -v`
Expected: FAIL(占位返回空 Map,且无 `fetchFn` 选项)。

- [ ] **Step 3: 实现**

`src/services/ai/openaiCompatible.ts`:
```ts
import type { Classifier, ClassifyInput, ClassifyResult } from './types';

interface Opts {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Injectable for tests. */
  fetchFn?: typeof fetch;
}

const SYSTEM =
  'You label browser bookmarks with 1-3 short lowercase semantic topic tags. ' +
  'Reply ONLY with JSON: {"items":[{"id":string,"topics":string[]}]}.';

export class OpenAICompatibleClassifier implements Classifier {
  constructor(private opts: Opts) {}

  async classify(sites: ClassifyInput[]): Promise<Map<string, ClassifyResult>> {
    const out = new Map<string, ClassifyResult>();
    if (sites.length === 0) return out;
    const doFetch = this.opts.fetchFn ?? fetch;
    const list = sites.map((s) => ({ id: s.id, title: s.title, host: s.host }));

    const resp = await doFetch(`${this.opts.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.opts.apiKey}` },
      body: JSON.stringify({
        model: this.opts.model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Classify:\n${JSON.stringify(list)}` },
        ],
      }),
    });
    if (!resp.ok) throw new Error(`classify failed: ${resp.status}`);
    const data = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content ?? '{"items":[]}';
    const parsed = JSON.parse(content) as { items?: { id: string; topics: string[] }[] };
    for (const item of parsed.items ?? []) {
      out.set(item.id, { topics: (item.topics ?? []).slice(0, 3) });
    }
    return out;
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/services/ai/openaiCompatible.test.ts -v && npm run check`
Expected: PASS + build 成功。

- [ ] **Step 5: Commit**

```bash
git add src/services/ai/openaiCompatible.ts src/services/ai/openaiCompatible.test.ts
git commit -m "feat(ai): OpenAI-compatible classifier provider (BYOK)"
```

---

## Task 13(可选,最后灰度): 同主题力学吸引

> 仅在前述全部稳定、真机确认后再做。给力导向 sim 加一个"同 primary topic 互相轻微吸引"的项,
> 让主题簇在空间上抱团。改动点在 sim 力计算文件(搜索 `nodesRef` / 力更新循环)。
> 因其触及手感,**默认不做**,需要时单独开一个小 plan + A/B 手感对比。

---

## 自检(spec 覆盖)

| spec 要求 | 对应 task |
|---|---|
| 统一 provider 接口 + BYOK | Task 10(接口/工厂/Claude)、Task 12(兼容端点) |
| 语义标签 → 同主题聚簇 | Task 4(`computeTopicEdges`) |
| 手动触发 + 批量 + 缓存增量 | Task 3(缓存)、Task 11(orchestration) |
| 回退启发式 | Task 9 Step 2(`topicMap.size ? ... : computeConnectedEdges`)、`makeClassifier` 返回 null |
| 主题着色 | Task 5(hue)、Task 7(render)、Task 8(透传) |
| hover 语义邻域 | Task 6(邻域)、Task 9 Step 4 |
| 设置 UI + 隐私提示 | Task 11(Tweaks + i18n,文案含"发送标题+域名") |
| 仅发标题+域名 | Task 11 Step 2(`hostOf`)、Task 10 测试断言无 `https://` |
| 测试 | 各 task 均 TDD;纯函数 + provider mock |
| 力学同主题吸引(可选) | Task 13 |
