import { GOLDEN_GATE_BACKGROUND } from "./data/backgrounds";

/** Legacy automatic OKLCH hue, or an exact user-selected sRGB hex color. */
export type GroupColor = number | `#${string}`;
export type GroupColors = Record<string, GroupColor>;

export interface Group {
  id: string;
  label: string;
  /** ID of this group's parent folder, or `null` if it sits directly under
   *  the bookmarks bar root. Lets the UI render a nested tree while the
   *  underlying list stays flat. */
  parentGroupId: string | null;
  /** 0 for top-level, 1 for subgroups of a top-level, etc. Pre-computed to
   *  avoid re-walking the parent chain at render time. */
  depth: number;
  rootId?: string;
  isRoot?: boolean;
  readOnly?: boolean;
}

export interface Bookmark {
  id: string;
  parentId: string;
  name: string;
  url: string;
  group: string;
  color: string;
  letter: string;
  visits: number;
  last: string;
  rootId?: string;
  readOnly?: boolean;
}

export interface BookmarkRoot {
  id: string;
  label: string;
  readOnly: boolean;
}

export type WidgetId = 'clock' | 'weather' | 'todos' | 'market' | 'notes' | 'focus' | 'revisit';
export type DesktopWidgetId = WidgetId | 'calendar';
export type WidgetSize = 'small' | 'medium' | 'large';
export interface WidgetPlacement { x: number; y: number; size: WidgetSize; coordinateSpace?: 'viewport' }
export type WidgetToolId = Exclude<WidgetId, 'clock' | 'weather'>;
export interface MarketInstrument {
  kind: 'index' | 'stock';
  code: string;
  name: string;
}
export interface WeatherCity {
  id: number;
  name: string;
  region: string;
  country: string;
  latitude: number;
  longitude: number;
}
export interface WidgetSettings {
  version: 1;
  order: WidgetId[];
  pinned: WidgetToolId[];
  clock: { enabled: boolean; hour12: boolean };
  weather: { enabled: boolean; city: WeatherCity | null; unit: 'celsius' | 'fahrenheit' };
  todos: { enabled: boolean };
  notes: { enabled: boolean };
  focus: { enabled: boolean; minutes: number };
  revisit: { enabled: boolean; folderId: string };
  market: {
    enabled: boolean;
    /** Personal Tushare credential, stored in local settings only. */
    token: string;
    watchlist: MarketInstrument[];
    summary: string;
    colors: 'red-up' | 'green-up' | 'mono';
  };
  calendar: { enabled: boolean; showLunar: boolean; showHolidays: boolean };
  desktop: { appearance: 'auto' | 'light' | 'dark' | 'tinted'; layout: Partial<Record<DesktopWidgetId, WidgetPlacement>> };
}

export interface GraphItem extends Bookmark {
  /** Graph-only node kind. Plain bookmarks omit this in persisted data and are
   *  treated as bookmark nodes by default. */
  nodeKind?: "bookmark" | "group";
  /** Real folder id for synthetic group nodes. */
  groupId?: string;
  /** Saved site count including descendant folders; drives group size and caption. */
  bookmarkCount?: number;
  /** AI-assigned semantic topics; topics[0] is the primary cluster key. */
  topics?: string[];
}

export interface HistoryItem {
  title: string;
  url: string;
  at: string;
  lastVisitTime: number;
}

export interface Todo {
  id: string;
  done: boolean;
  text: string;
  tag: "work" | "life";
}

export interface Quote {
  text: string;
  by: string;
}

export type ResolvedTheme = "dark" | "light";
export type Theme = ResolvedTheme | "system";
export type Density = "cozy" | "compact";
export type BgPattern = "flat" | "grain" | "grid" | "image";
export type SearchProviderId =
  | "google"
  | "bing"
  | "baidu"
  | "duckduckgo"
  | "perplexity"
  | "chatgpt"
  | "claude"
  | "custom";

export type AiProvider =
  | "off"
  | "anthropic"
  | "openai"
  | "google"
  | "deepseek"
  | "alibaba"
  | "moonshot"
  | "zhipu"
  | "baichuan"
  | "minimax"
  | "openrouter"
  | "cloudflare"
  | "groq"
  | "custom";

export interface AiSettings {
  provider: AiProvider;
  /** BYOK API key (stored locally only). */
  apiKey: string;
  /** Base URL for openai-compatible endpoints. */
  baseUrl: string;
  /** Model id; '' means provider default (claude → claude-opus-4-8). */
  model: string;
}

export type GroupGranularity = "coarse" | "balanced" | "fine";
export type GroupNameLanguage = "auto" | "zh" | "en";
export type GroupScope = "ungrouped" | "all";

export interface GroupingConfig {
  granularity: GroupGranularity;
  /** 成员数小于此值的组合并进"其他"。 */
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
  historyId?: string;
  moved: { id: string; fromParentId: string }[];
  createdFolderIds: string[];
}

export interface Settings {
  widgets: WidgetSettings;
  theme: Theme;
  accentHue: number;
  density: Density;
  bg: BgPattern;
  /** Only used when `bg === 'image'`. A durable local image reference, built-in path, gradient or remote URL. */
  bgImage: string | null;
  /** 0..1. Darkening overlay on top of the background image so foreground
   *  text stays legible. */
  bgImageDim: number;
  bingWallpaper: boolean;
  /** Shorter force-graph and search zoom animations. */
  reduceMotion: boolean;
  /** Draw explicit links and relationships (opened folder / topic / host / domain). */
  showEdges: boolean;
  /** Open bookmark URLs in a new tab; if false, navigate the current tab. */
  openInNewTab: boolean;
  /** Fallback target used when graph search has no bookmark matches. */
  searchProvider: SearchProviderId;
  /** Label shown for the custom fallback search / ask target. */
  customSearchName: string;
  /** URL template for custom fallback queries. Use `{query}` as placeholder. */
  customSearchUrl: string;
  /** AI semantic-classification provider config (BYOK). */
  ai: AiSettings;
  /** AI 分组配置(BYOK)。 */
  grouping: GroupingConfig;
}

export const DEFAULT_SETTINGS: Settings = {
  widgets: {
    version: 1,
    order: ['clock', 'weather', 'todos', 'market', 'notes', 'focus', 'revisit'],
    pinned: ['todos'],
    clock: { enabled: false, hour12: false },
    weather: { enabled: false, city: null, unit: 'celsius' },
    todos: { enabled: false },
    notes: { enabled: false },
    focus: { enabled: false, minutes: 25 },
    revisit: { enabled: false, folderId: '' },
    market: { enabled: false, token: '', watchlist: [], summary: 'index:000001.SH', colors: 'red-up' },
    calendar: { enabled: true, showLunar: true, showHolidays: true },
    desktop: { appearance: 'auto', layout: {} },
  },
  theme: "light",
  accentHue: 260,
  density: "cozy",
  bg: "image",
  bgImage: GOLDEN_GATE_BACKGROUND,
  bgImageDim: 0.12,
  bingWallpaper: false,
  reduceMotion: false,
  showEdges: true,
  openInNewTab: true,
  searchProvider: "google",
  customSearchName: "自定义",
  customSearchUrl: "https://www.google.com/search?q={query}",
  ai: { provider: "off", apiKey: "", baseUrl: "", model: "" },
  grouping: {
    granularity: "balanced",
    minGroupSize: 2,
    nameLanguage: "auto",
    scope: "ungrouped",
    reuseExisting: true,
  },
};

export interface ChromeData {
  roots?: BookmarkRoot[];
  bookmarks: Bookmark[];
  recents: HistoryItem[];
  groups: Group[];
  /** ID of the bookmarks bar root (parent for new top-level folders). */
  barId: string | null;
  source: "chrome" | "fallback";
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  /** 'manual' = 用户 Shift 拖拽建立、可右键删除；'auto' = 从书签派生、仅显示。 */
  kind: "manual" | "auto";
  label?: string;
}

export interface GraphPin {
  x: number;
  y: number;
}

export type PinsMap = Record<string, GraphPin>;

export interface Camera {
  scale: number;
  tx: number;
  ty: number;
}

export interface GraphNode extends GraphItem {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx?: number | null;
  fy?: number | null;
  radius: number;
  groupHue: GroupColor;
}
