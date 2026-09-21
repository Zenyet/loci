import type { ChangeEvent, CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import type { BgPattern, ChromeData, Settings, Theme } from "../types";
import {
  BUILTIN_BACKGROUNDS,
  backgroundImageCssValue,
  GOLDEN_GATE_BACKGROUND,
} from "../data/backgrounds";
import {
  loadUserBackgrounds,
  MAX_USER_BACKGROUNDS,
  removeUserBackground,
  saveUserBackground,
  subscribeUserBackgrounds,
  type UserBackground,
} from "../services/userBackgrounds";
import {
  DEFAULT_CUSTOM_SEARCH_URL,
  SEARCH_PROVIDERS,
} from "../services/searchProviders";
import { SettingRow, SettingGroup, Switch } from "./SettingsControls";
import { AiOrganizer } from "./AiOrganizer";
import type { GroupingWorkflow } from "../hooks/useGrouping";
import { Icon } from "./Icon";
import { PreferenceIcon } from "./PreferenceIcon";
import { SearchProviderLogo } from "./SearchProviderLogo";
import { WidgetSettings } from './widgets/WidgetSettings';
import { useSurfaceDismiss } from '../hooks/useSurfaceDismiss';
import { TextInput } from "./TextInput";
import { Slider } from "./Slider";
import "./Tweaks.css";

interface Props {
  requestedSection?: { section: 'widgets' | 'ai'; revision: number };
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  open: boolean;
  onToggle: () => void;
  onClassify?: () => Promise<string | void>;
  classifying?: boolean;
  aiReady?: boolean;
  data?: ChromeData;
  groupingFlow?: GroupingWorkflow;
}

type Section = "look" | "wallpaper" | "search" | "behavior" | "ai" | "widgets";

const SECTIONS: {
  id: Section;
  title: string;
  keywords: string;
}[] = [
  {
    id: "look",
    title: "外观",
    keywords: "主题 浅色 深色 系统 强调色 色调",
  },
  {
    id: "wallpaper",
    title: "壁纸",
    keywords: "背景 图片 上传 纯色 网格 颗粒",
  },
  {
    id: "search",
    title: "搜索",
    keywords: "搜索引擎 Google Bing 百度 Baidu DuckDuckGo Perplexity ChatGPT Claude 自定义 链接",
  },
  {
    id: "behavior",
    title: "通用",
    keywords: "行为 动效 连线 底栏 新标签页 打开方式",
  },
  { id: "widgets", title: "小组件", keywords: "天气 城市 时间 时钟 日期 日历 农历 节假日 调休 待办 小组件" },
  {
    id: "ai",
    title: "智能整理",
    keywords: "AI 模型 API Provider 分组 语言",
  },
];
const THEMES: { id: Theme; label: string }[] = [
  { id: "light", label: "浅色" },
  { id: "dark", label: "深色" },
  { id: "system", label: "自动" },
];
const BACKGROUNDS: { id: BgPattern; label: string }[] = [
  { id: "image", label: "壁纸" },
  { id: "flat", label: "纯色" },
  { id: "grain", label: "颗粒" },
  { id: "grid", label: "网格" },
];
const ACCENTS = [
  { hue: 260, label: "蓝色" },
  { hue: 295, label: "紫色" },
  { hue: 350, label: "粉色" },
  { hue: 25, label: "红色" },
  { hue: 55, label: "橙色" },
  { hue: 90, label: "黄色" },
  { hue: 150, label: "绿色" },
  { hue: 210, label: "青色" },
];
const MAX_IMAGE_SIDE = 2400;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

function DesktopPreview({ settings }: { settings: Settings }) {
  const bg =
    settings.bg === "image" && settings.bgImage
      ? backgroundImageCssValue(settings.bgImage)
      : undefined;
  return (
    <div
      className="desktop-preview"
      data-background={settings.bg}
      style={{ backgroundImage: bg }}
      aria-hidden="true"
    >
      <div className="preview-menubar">
        <span>◈ &nbsp; Loci</span>
        <span>书签的另一种可能</span>
      </div>
      <div className="preview-window">
        <div className="preview-window-sidebar">
          <i />
          <i />
          <i />
          <i />
        </div>
        <div className="preview-window-content">
          <span />
          <div className="preview-nodes">
            <i />
            <i />
            <i />
          </div>
          <b />
          <b />
        </div>
      </div>
      <div className="preview-dock">
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}

export function Tweaks({
  requestedSection,
  settings,
  onChange,
  open,
  onToggle,
  onClassify,
  classifying,
  aiReady,
  data,
  groupingFlow,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onToggle);
  closeRef.current = onToggle;
  const [section, setSection] = useState<Section>("look");
  useSurfaceDismiss('settings', open, () => {});
  useEffect(() => { if (requestedSection) setSection(requestedSection.section); }, [requestedSection]);
  const [query, setQuery] = useState("");
  const [urlDraft, setUrlDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [userBgs, setUserBgs] = useState<UserBackground[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadUserBackgrounds()
      .then((list) => {
        if (!cancelled) setUserBgs(list);
      })
      .catch(() => {
        if (!cancelled) setError("无法读取已保存的壁纸，请稍后重试。");
      });
    const unsub = subscribeUserBackgrounds((list) => {
      if (!cancelled) setUserBgs([...list]);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key === "Tab") {
        const focusables = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>("*") ?? [],
        ).filter(
          (element) =>
            element.tabIndex >= 0 &&
            !element.matches(":disabled") &&
            !element.hidden &&
            (!element.checkVisibility || element.checkVisibility()),
        );
        if (!focusables?.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === dialogRef.current)
        ) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
      previousFocus?.focus();
    };
  }, [open]);

  const filteredSections = SECTIONS.filter((item) =>
    `${item.title} ${item.keywords}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const currentSection = SECTIONS.find((item) => item.id === section)!;
  const navigate = (next: Section) => {
    setSection(next);
    setError(null);
  };
  const applyImage = (value: string) => {
    onChange({ bg: "image", bgImage: value });
    setError(null);
  };
  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (!file.type.startsWith("image/")) throw new Error("请选择图片文件。");
      const compressed = await compressImage(file, MAX_IMAGE_SIDE);
      if (compressed.length > MAX_IMAGE_BYTES)
        throw new Error("图片压缩后仍超过 3 MB，请换一张较小的图片。");
      applyImage(compressed);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "图片无法读取，请换一张试试。",
      );
    }
  };
  const applyUrl = () => {
    try {
      const url = new URL(urlDraft.trim());
      if (!["https:", "http:"].includes(url.protocol)) throw new Error();
      applyImage(url.href);
      setUrlDraft("");
    } catch {
      setError("请输入以 https:// 或 http:// 开头的图片链接。");
    }
  };
  const canSavePreset =
    !!settings.bgImage &&
    !userBgs.some((bg) => bg.value === settings.bgImage) &&
    !BUILTIN_BACKGROUNDS.some((bg) => bg.value === settings.bgImage) &&
    userBgs.length < MAX_USER_BACKGROUNDS;
  const savePreset = async () => {
    if (!settings.bgImage || !canSavePreset) return;
    const label = window.prompt(
      "给这张壁纸取个名字",
      `我的壁纸 ${userBgs.length + 1}`,
    );
    if (label === null || !label.trim()) return;
    try {
      await saveUserBackground({
        label: label.trim(),
        value: settings.bgImage,
      });
    } catch {
      setError("壁纸保存失败，可能是本地空间不足。");
    }
  };
  const wallpaperName =
    [...BUILTIN_BACKGROUNDS, ...userBgs].find(
      (bg) => bg.value === settings.bgImage,
    )?.label ?? "自定义壁纸";

  return (
    <>
      <button
        type="button"
        className="tweaks-fab"
        onClick={onToggle}
        title="设置"
        aria-label="设置"
        aria-expanded={open}
      >
        <span className="desktop-control-icon" aria-hidden><Icon name="settings" /></span>
      </button>
      {open && (
        <div className="settings-overlay" onClick={onToggle}>
          <div
            className="settings-window"
            role="dialog"
            aria-modal="true"
            aria-label={`设置 · ${currentSection.title}`}
            tabIndex={-1}
            ref={dialogRef}
            onClick={(event) => event.stopPropagation()}
          >
            <aside className="settings-sidebar">
              <div className="settings-window-controls">
                <button
                  type="button"
                  className="window-close"
                  onClick={onToggle}
                  aria-label="关闭设置"
                >
                  <Icon name="close" size={10} />
                </button>
                <span className="window-caption">设置</span>
              </div>
              <div className="settings-search">
                <TextInput
                  leading={<Icon name="search" size={15} />}
                  aria-label="搜索设置"
                  placeholder="搜索设置"
                  value={query}
                  onChange={setQuery}
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="清除设置搜索"
                  >
                    <Icon name="close" size={12} />
                  </button>
                )}
              </div>
              <div className="settings-nav-label">偏好设置</div>
              <nav className="settings-nav" aria-label="设置分类">
                {filteredSections.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={`settings-nav-item${section === item.id ? " is-selected" : ""}`}
                    aria-current={section === item.id ? "page" : undefined}
                    onClick={() => navigate(item.id)}
                  >
                    <PreferenceIcon name={item.id} />
                    <span>{item.title}</span>
                    <Icon name="arrow" size={12} />
                  </button>
                ))}
                {!filteredSections.length && (
                  <p className="settings-no-results">没有相关设置</p>
                )}
              </nav>
              <div className="settings-sidebar-footer">
                <span className="settings-local-dot" />
                设置即时生效<span>v0.1</span>
              </div>
            </aside>
            <main className="settings-main">
              <div className="settings-content" key={section} data-section={section}>
                {section === "look" && (
                  <>
                    <div className="settings-preview-card">
                      <DesktopPreview settings={settings} />
                      <div className="settings-preview-caption">
                        <span>
                          <strong>你的 Loci</strong>
                          <small>
                            {settings.bg === "image"
                              ? wallpaperName
                              : BACKGROUNDS.find((bg) => bg.id === settings.bg)
                                  ?.label}{" "}
                            ·{" "}
                            {
                              THEMES.find(
                                (theme) => theme.id === settings.theme,
                              )?.label
                            }
                            外观
                          </small>
                        </span>
                        <button
                          type="button"
                          className="settings-text-button"
                          onClick={() => navigate("wallpaper")}
                        >
                          更换壁纸 <Icon name="arrow" size={12} />
                        </button>
                      </div>
                    </div>
                    <SettingGroup title="主题模式">
                      <div
                        className="theme-options"
                        role="group"
                        aria-label="主题模式"
                      >
                        {THEMES.map((theme) => (
                          <button
                            type="button"
                            className={`theme-option${settings.theme === theme.id ? " is-selected" : ""}`}
                            key={theme.id}
                            aria-pressed={settings.theme === theme.id}
                            onClick={() => onChange({ theme: theme.id })}
                          >
                            <span
                              className={`theme-mini theme-mini--${theme.id}`}
                            >
                              <span className="theme-mini-sidebar">
                                <i />
                                <i />
                                <i />
                              </span>
                              <span className="theme-mini-page">
                                <i />
                                <i />
                                <i />
                              </span>
                            </span>
                            <span className="theme-option-label">
                              {theme.label}
                              <span className="settings-radio">
                                {settings.theme === theme.id && (
                                  <Icon name="check" size={10} />
                                )}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </SettingGroup>
                    <SettingGroup
                      title="个性化"
                      note={
                        settings.theme === "system"
                          ? "自动模式会随系统切换浅色与深色外观。"
                          : "主题与强调色会应用到整个工作空间。"
                      }
                    >
                      <SettingRow
                        title="强调色"
                        hint="选中项、按钮与焦点的颜色"
                      >
                        <div
                          className="accent-options"
                          role="group"
                          aria-label="强调色"
                        >
                          {ACCENTS.map((accent) => (
                            <button
                              type="button"
                              key={accent.hue}
                              className="accent-option"
                              style={
                                {
                                  "--swatch": `oklch(0.64 0.19 ${accent.hue})`,
                                } as CSSProperties
                              }
                              title={accent.label}
                              aria-label={accent.label}
                              aria-pressed={settings.accentHue === accent.hue}
                              onClick={() =>
                                onChange({ accentHue: accent.hue })
                              }
                            >
                              {settings.accentHue === accent.hue && (
                                <Icon name="check" size={12} />
                              )}
                            </button>
                          ))}
                        </div>
                      </SettingRow>
                    </SettingGroup>
                  </>
                )}
                {section === "wallpaper" && (
                  <>
                    <SettingGroup title="背景风格">
                      <SettingRow title="显示方式">
                        <div
                          className="settings-segmented"
                          role="group"
                          aria-label="背景风格"
                        >
                          {BACKGROUNDS.map((bg) => (
                            <button
                              type="button"
                              key={bg.id}
                              aria-pressed={settings.bg === bg.id}
                              onClick={() =>
                                onChange({
                                  bg: bg.id,
                                  ...(bg.id === "image" && !settings.bgImage
                                    ? { bgImage: GOLDEN_GATE_BACKGROUND }
                                    : {}),
                                })
                              }
                            >
                              {bg.label}
                            </button>
                          ))}
                        </div>
                      </SettingRow>
                    </SettingGroup>
                    {settings.bg === "image" && (
                      <>
                        <section
                          className="settings-group"
                          aria-label="精选壁纸"
                        >
                          <h3>
                            精选壁纸 <span>为 Loci 精选</span>
                          </h3>
                          <div className="wallpaper-grid">
                            {BUILTIN_BACKGROUNDS.map((bg) => (
                              <button
                                type="button"
                                key={bg.id}
                                className={`wallpaper-option${settings.bgImage === bg.value ? " is-selected" : ""}`}
                                aria-label={bg.label}
                                aria-pressed={settings.bgImage === bg.value}
                                onClick={() => applyImage(bg.value)}
                              >
                                <span
                                  className="wallpaper-swatch"
                                  style={{
                                    backgroundImage: backgroundImageCssValue(
                                      bg.value,
                                    ),
                                  }}
                                >
                                  {settings.bgImage === bg.value && (
                                    <span className="wallpaper-check">
                                      <Icon name="check" size={12} />
                                    </span>
                                  )}
                                </span>
                                <span>{bg.label}</span>
                              </button>
                            ))}
                          </div>
                        </section>
                        {userBgs.length > 0 && (
                          <section
                            className="settings-group"
                            aria-label="我的壁纸"
                          >
                            <h3>
                              我的壁纸{" "}
                              <span>
                                {userBgs.length} / {MAX_USER_BACKGROUNDS}
                              </span>
                            </h3>
                            <div className="wallpaper-grid">
                              {userBgs.map((bg) => (
                                <div className="wallpaper-saved" key={bg.id}>
                                  <button
                                    type="button"
                                    className={`wallpaper-option${settings.bgImage === bg.value ? " is-selected" : ""}`}
                                    aria-pressed={settings.bgImage === bg.value}
                                    onClick={() => applyImage(bg.value)}
                                  >
                                    <span
                                      className="wallpaper-swatch"
                                      style={{
                                        backgroundImage:
                                          backgroundImageCssValue(bg.value),
                                      }}
                                    />
                                    <span>{bg.label}</span>
                                  </button>
                                  <button
                                    type="button"
                                    className="wallpaper-remove"
                                    aria-label={`删除壁纸 ${bg.label}`}
                                    onClick={async () => {
                                      if (
                                        window.confirm(`删除「${bg.label}」？`)
                                      ) {
                                        try {
                                          await removeUserBackground(bg.id);
                                        } catch {
                                          setError("删除失败，请重试。");
                                        }
                                      }
                                    }}
                                  >
                                    <Icon name="close" size={11} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </section>
                        )}
                        <SettingGroup title="自定义壁纸">
                          <SettingRow
                            title="使用自己的图片"
                            hint="支持 JPG、PNG、WebP 等图片"
                          >
                            <button
                              type="button"
                              className="settings-button"
                              onClick={() => fileRef.current?.click()}
                            >
                              <Icon name="upload" size={14} />
                              选择图片
                            </button>
                          </SettingRow>
                          <div className="settings-url-row">
                            <Icon name="link" size={15} />
                            <TextInput
                              aria-label="壁纸图片链接"
                              placeholder="粘贴图片链接…"
                              type="url"
                              value={urlDraft}
                              onChange={(value) => setUrlDraft(value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") applyUrl();
                              }}
                            />
                            <button
                              type="button"
                              className="settings-button"
                              disabled={!urlDraft.trim()}
                              onClick={applyUrl}
                            >
                              应用
                            </button>
                          </div>
                          {canSavePreset && (
                            <SettingRow title="收藏这张壁纸">
                              <button
                                type="button"
                                className="settings-button"
                                onClick={() => void savePreset()}
                              >
                                保存到我的壁纸
                              </button>
                            </SettingRow>
                          )}
                          <SettingRow
                            title="柔化壁纸"
                            hint="降低背景对比，让书签更清晰"
                          >
                            <Slider
                              label="柔化壁纸"
                              min={0}
                              max={0.8}
                              step={0.05}
                              value={settings.bgImageDim}
                              onChange={(value) =>
                                onChange({ bgImageDim: value })
                              }
                            />
                          </SettingRow>
                        </SettingGroup>
                      </>
                    )}
                  </>
                )}
                {section === "search" && (
                  <>
                    <div className="settings-feature-note">
                      <PreferenceIcon name="search" />
                      <div>
                        <strong>随想，随搜。</strong>
                        <p>
                          直接输入文字，或按 <kbd>⌘ / Ctrl K</kbd> 搜索书签。
                        </p>
                      </div>
                    </div>
                    <SettingGroup
                      title="默认搜索目标"
                      note="没有匹配的书签时，按 Enter 使用选定的搜索引擎或 AI 助手。"
                    >
                      <div className="search-provider-list">
                        {SEARCH_PROVIDERS.map((provider) => (
                          <button
                            type="button"
                            key={provider.id}
                            className="search-provider-option"
                            aria-pressed={
                              settings.searchProvider === provider.id
                            }
                            onClick={() =>
                              onChange({ searchProvider: provider.id })
                            }
                          >
                            <span className="search-provider-logo" aria-hidden>
                              <SearchProviderLogo provider={provider.id} />
                            </span>
                            <span className="search-provider-copy">
                              <strong>{provider.label}</strong>
                              <small>{provider.description}</small>
                            </span>
                            <span className="search-provider-kind">
                              {provider.kind === "ask" ? "AI 助手" : "搜索引擎"}
                            </span>
                            <span className="settings-radio">
                              {settings.searchProvider === provider.id && (
                                <Icon name="check" size={10} />
                              )}
                            </span>
                          </button>
                        ))}
                        <button
                          type="button"
                          className="search-provider-option"
                          aria-pressed={settings.searchProvider === "custom"}
                          onClick={() =>
                            onChange({
                              searchProvider: "custom",
                              customSearchUrl:
                                settings.customSearchUrl ||
                                DEFAULT_CUSTOM_SEARCH_URL,
                            })
                          }
                        >
                          <span className="search-provider-logo" aria-hidden>
                            <SearchProviderLogo provider="custom" size={22} />
                          </span>
                          <span className="search-provider-copy">
                            <strong>自定义</strong>
                            <small>使用你喜欢的搜索服务</small>
                          </span>
                          <span className="settings-radio">
                            {settings.searchProvider === "custom" && (
                              <Icon name="check" size={10} />
                            )}
                          </span>
                        </button>
                      </div>
                    </SettingGroup>
                    {settings.searchProvider === "custom" && (
                      <SettingGroup
                        title="自定义搜索"
                        note="在链接中使用 {query} 代表搜索词。"
                      >
                        <label className="settings-field">
                          显示名称
                          <TextInput
                            value={settings.customSearchName}
                            onChange={(value) =>
                              onChange({ customSearchName: value })
                            }
                          />
                        </label>
                        <label className="settings-field">
                          链接模板
                          <TextInput
                            value={settings.customSearchUrl}
                            placeholder="https://example.com/search?q={query}"
                            onChange={(value) =>
                              onChange({ customSearchUrl: value })
                            }
                          />
                        </label>
                      </SettingGroup>
                    )}
                  </>
                )}
                {section === "behavior" && (
                  <>
                    <SettingGroup title="工作空间">
                      <SettingRow
                        title="显示常用与最近访问"
                        hint="在底部快速回到常用站点"
                      >
                        <Switch
                          label="显示常用与最近访问"
                          checked={settings.showStrip}
                          onChange={(showStrip) => onChange({ showStrip })}
                        />
                      </SettingRow>
                      <SettingRow
                        title="显示书签连线"
                        hint="在图谱中呈现站点之间的关联"
                      >
                        <Switch
                          label="显示书签连线"
                          checked={settings.showEdges}
                          onChange={(showEdges) => onChange({ showEdges })}
                        />
                      </SettingRow>
                    </SettingGroup>
                    <SettingGroup title="浏览与交互">
                      <SettingRow
                        title="在新标签页打开"
                        hint="打开书签时保留当前工作空间"
                      >
                        <Switch
                          label="在新标签页打开"
                          checked={settings.openInNewTab}
                          onChange={(openInNewTab) =>
                            onChange({ openInNewTab })
                          }
                        />
                      </SettingRow>
                      <SettingRow
                        title="减少动态效果"
                        hint="缩短图谱移动与搜索聚焦动画"
                      >
                        <Switch
                          label="减少动态效果"
                          checked={settings.reduceMotion}
                          onChange={(reduceMotion) =>
                            onChange({ reduceMotion })
                          }
                        />
                      </SettingRow>
                    </SettingGroup>
                    <SettingGroup title="顺手的小技巧">
                      <SettingRow title="搜索书签">
                        <kbd>⌘ / Ctrl K</kbd>
                      </SettingRow>
                      <SettingRow title="创建书签或分组">
                        <span className="settings-value">右键空白处</span>
                      </SettingRow>
                      <SettingRow title="建立书签关联">
                        <span className="settings-value">Shift + 拖拽</span>
                      </SettingRow>
                      <SettingRow title="重置图谱视角">
                        <span className="settings-value">双击空白处</span>
                      </SettingRow>
                    </SettingGroup>
                  </>
                )}
                {section === "widgets" && <WidgetSettings value={settings.widgets} onChange={widgets => onChange({ widgets })} />}
                {section === "ai" && (
                  <AiOrganizer settings={settings} onChange={onChange} data={data}
                    flow={groupingFlow} aiReady={aiReady} onClassify={onClassify} classifying={classifying} />
                )}
                {error && (
                  <p className="settings-error" role="alert">
                    {error}
                  </p>
                )}
              </div>
            </main>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={onFile}
              hidden
            />
          </div>
        </div>
      )}
    </>
  );
}
/**
 * Resize + re-encode a user-selected image to fit under our storage budget.
 * We cap the longest side at `maxSide` and encode JPEG at 0.85 quality; the
 * resulting data URL typically lands under a megabyte for 1080p-ish photos.
 */
async function compressImage(file: File, maxSide: number): Promise<string> {
  const dataUrl = await fileToDataUrl(file);
  const img = await dataUrlToImage(dataUrl);
  const { width, height } = img;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  if (scale >= 1 && file.size <= MAX_IMAGE_BYTES) {
    return dataUrl;
  }
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.85);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

function dataUrlToImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode failed"));
    img.src = src;
  });
}
