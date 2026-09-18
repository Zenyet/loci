# AI 语义聚类 + 语义邻域 hover — 设计文档

- 日期:2026-06-10
- 分支:`feat/graph-node-edge-redesign`
- 状态:已通过 brainstorming 评审,待用户复核 spec

## 1. 背景与问题

Loci 是一个把 Chrome 书签渲染成 Canvas 力导向图的新标签页扩展。当前的连线逻辑
(`computeConnectedEdges`)把每个节点连进一张连通图,但中心是"随便找的最高访问量节点",
**边没有真正的语义关系**;hover 也只是周围变暗。用户希望:

1. 节点之间是**有意义的关联**,而不是机械的星形。
2. **可配置的统一 AI provider 接口(BYOK)**——可选 provider 或填自己的 key。
3. AI 对站点做**语义主题分类**,据此聚类、连接、着色。
4. hover 升级为**语义邻域高亮**(同主题簇亮起,其余变暗)。

## 2. 已确认的核心决策(brainstorming 产出)

| 决策点 | 选择 |
|---|---|
| AI 运行位置 | 可配置的统一 provider 接口 + BYOK(默认 Claude,支持 OpenAI 兼容端点) |
| AI 产出 | 语义主题标签 → 同主题聚簇 |
| hover | 语义邻域高亮 |
| 主题如何重塑图 | **方案 A:主题取代文件夹成为聚类维度**(簇内星形 + 主题 hub 互联,按主题着色) |

## 3. 目标 / 非目标

**目标**
- 一个 `Classifier` provider 接口,默认 `ClaudeClassifier`,可切 OpenAI 兼容端点。
- 手动触发的批量语义分类,结果缓存 + 增量更新。
- 基于主题的连边/着色/聚类(方案 A),取代当前的 `computeConnectedEdges` 作为主路径。
- hover 语义邻域高亮,复用已有的缓动 dimming 基建。
- 无 key / 未分类时优雅回退到现有启发式连边,功能不退化。

**非目标(本期不做)**
- 不在每次开新标签时自动调 AI(成本/隐私/延迟)。
- 不做服务端代理;BYOK 浏览器直连。
- 不做 C 方案的"文件夹/主题双视图切换"(留作后续)。
- 不持久化 AI 生成的边到书签数据(与现有 auto edges 一样,display-only,派生)。

## 4. 架构

### 4.1 Provider 接口("暴露的接口")

```ts
// 输入只含分类所需的最小字段;输出每站 1-3 个主题标签
interface ClassifyInput { id: string; title: string; host: string }
interface ClassifyResult { topics: string[] }      // 第一个为主主题(primary)

interface Classifier {
  /** 批量分类。实现负责一次或分批调用底层模型,返回 id → 主题。 */
  classify(sites: ClassifyInput[]): Promise<Map<string, ClassifyResult>>;
}
```

实现:
- **`ClaudeClassifier`(默认旗舰)**
  - 官方 `@anthropic-ai/sdk`,`new Anthropic({ apiKey, dangerouslyAllowBrowser: true })`。
  - 模型默认 **`claude-opus-4-8`**(可配)。结构化输出:用 zod schema +
    `messages.parse` / `output_config.format`,模型直接产出受约束 JSON,免手动解析。
  - 大批量时分批(见 4.3),必要时走流式以避免超时;轻量分类一般单请求即可。
- **`OpenAICompatibleClassifier`**
  - 填 `baseUrl` + `apiKey` + `model`,走 OpenAI 兼容端点(raw fetch)。
  - 覆盖"选 provider / 自定义 BYOK"。

### 4.2 设置项(`chrome.storage.local`)

`Settings` 新增:

```ts
ai: {
  provider: 'claude' | 'openai-compatible' | 'off';   // 默认 'off'(零配置不破坏现状)
  apiKey: string;            // BYOK
  baseUrl?: string;          // openai-compatible 用
  model?: string;            // 默认按 provider 取:claude → 'claude-opus-4-8'
}
```

- 设置 UI 在 Tweaks 面板新增一段:provider 选择、key 输入、model 选择。
- model 下拉默认 Opus 4.8;并列出 **Haiku 4.5**(更便宜、分类够用)作为可选项——
  由用户自行选择,不替用户默认降级。
- key 仅存本地;UI 明确提示"分类时会把书签标题 + 域名发送给所选服务商"。

### 4.3 分类管线

1. **手动触发**:工具/设置里"用 AI 整理"按钮。不在渲染热路径自动调。
2. **批量**:收集 `visibleGraphItems` 中 `nodeKind === 'bookmark'` 的 `{id,title,host}`,
   一次(或分批)调 `classify`。
3. **缓存 + 增量**:结果按 `hash(id + title + url)` 存 `chrome.storage`(独立 key);
   下次只对新增 / 改名 / 改 URL 的书签补分类,命中缓存的跳过。
4. **回退**:`provider==='off'` / 无 key / 尚无分类结果 → 用现有 `computeConnectedEdges`。

隐私:只发标题 + host(不发完整路径 / query),且仅手动触发。

### 4.4 主题 → 图(方案 A)

新增纯函数 `computeTopicEdges(sites, topicMap, manualEdges)`:
- 按每站的**主主题**(primary topic)分簇。
- **簇内**:星形连到该簇访问量最高的站点(local hub)。
- **簇间**:把各主题 hub 连到一个全局 hub(主题之主题),保证整图连通。
- 不 shadow 已有 manual edge(沿用 `edgeId` + `seen` 去重)。
- 输出 `kind:'auto'` 的 display-only 边(与现状一致,不进物理 / 命中测试)。

着色:节点与边按主题色着色(主题 → hue 的稳定映射,复用 OkLCh 思路)。
布局:同主题节点加一点吸引力,自然抱团(对力学的小幅调整,可灰度)。

`Graph.tsx` 中 `autoEdges` memo 改为:有主题结果就用 `computeTopicEdges`,否则
`computeConnectedEdges`。

### 4.5 hover = 语义邻域

- 复用已有的 `hoverProgress` 缓动 + spotlight dimming 基建。
- 把"邻域"的定义从"边相邻 / 文件夹"改为"**同主题簇**":hover 一个节点 →
  同主题成员 + 连接它们的边亮起,其余缓动变暗到 ~35%。
- reduceMotion 时瞬切(沿用现状)。

## 5. 数据模型 / 类型

- `GraphItem` 增加可选 `topics?: string[]`(运行时注入,不持久化到书签)。
- 主题缓存结构:`Record<hash, { topics: string[]; at: string }>`,存独立 storage key。
- 边仍是 `GraphEdge { id, from, to, kind:'auto' }`,不新增持久字段。

## 6. 安全 / 隐私

- BYOK,key 仅 `chrome.storage.local`,不外传第三方(除所选模型服务商)。
- 仅发标题 + 域名,仅手动触发,UI 明确告知。
- 浏览器直连需 `dangerouslyAllowBrowser` + 直连 header;对个人扩展可接受。
- 失败(401/429/网络)有 typed 错误处理与用户可见提示,并回退到启发式连边。

## 7. 测试策略(Vitest)

- `computeTopicEdges`:聚类正确、连通性(BFS)、不 shadow manual、空/单节点边界。
- 缓存 diff:新增/改名触发重分类,命中跳过。
- provider 在接口后 mock,不打真网络;`ClaudeClassifier` 的 JSON schema 解析用 mock 响应测。
- 主题 → hue 映射稳定性(同 seed 同色)。
- 回退路径:无结果时等价于 `computeConnectedEdges`。

## 8. 风险 / 待定

- 主题粒度:太细则簇碎、太粗则糊。初版让模型产 1-3 个、取 primary 聚类,实测再调 prompt。
- 成本:Opus 4.8 批量分类对大量书签可能偏贵;Haiku 4.5 选项缓解,缓存 + 增量是主要手段。
- 浏览器直连 CORS 在某些兼容端点可能不放行——OpenAI 兼容路径需实测,失败给清晰提示。
- 力学吸引力调参可能影响现有手感,灰度并可关。

## 9. 分阶段实现建议(交由 writing-plans 细化)

1. 类型 + 设置项 + Tweaks UI(provider/key/model)。
2. `Classifier` 接口 + `ClaudeClassifier` + 缓存/增量 + 手动触发按钮。
3. `computeTopicEdges` + 主题着色 + `Graph.tsx` 接线 + 回退。
4. hover 语义邻域(邻域定义切换)。
5. `OpenAICompatibleClassifier`。
6. 力学同主题吸引力(可选,最后灰度)。
