import { colorCss, colorInk, hexToOklchHue } from '../../services/color';
import type { GroupColor, GroupColors } from '../../types';
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Bookmark,
  ChromeData,
  GraphEdge,
  GraphItem,
  Group,
  PinsMap,
  ResolvedTheme,
  Settings,
} from "../../types";
import { ActivityDock } from "../../components/ActivityDock";
import { BookmarkDialog } from "../../components/BookmarkDialog";
import { ContextMenu, type MenuItem } from "../../components/ContextMenu";
import { Favicon } from "../../components/Favicon";
import { GroupsPanel } from "../../components/GroupsPanel";
import {
  createBookmark,
  createFolder,
  moveBookmark,
  moveFolder,
  openUrl,
  removeBookmark,
  removeFolder,
  renameFolder,
  subscribeBookmarkChanges,
  updateBookmark,
} from "../../services/chromeApi";
import {
  clearGroupHue,
  loadGroupHues,
  setGroupHue,
  subscribeGroupHues,
} from "../../services/groupHues";
import {
  getSearchProvider,
  searchUrlForSettings,
} from "../../services/searchProviders";
import { copy } from "../../i18n";
import { Icon } from "../../components/Icon";
import { SearchProviderLogo } from "../../components/SearchProviderLogo";
import { useClock } from "../../hooks/useClock";
import "./graph-hud.css";
import { folderHue, pickDistinctHue } from "./folderHue";
import { GraphCanvas } from "./GraphCanvas";
import {
  addEdge as addEdgeFn,
  cleanOrphans as cleanOrphanEdges,
  loadEdges,
  removeEdge as removeEdgeFn,
  saveEdges,
} from "./edges";
import { focusNeighborhood as computeFocusNeighborhood } from "./focusNeighborhood";
import { cleanOrphanPins, loadPins, savePins, setPin, unsetPin } from "./pins";
import { suggestRelated } from "./relationSuggest";
import { loadTopicCache, mergeTopics } from "../../services/topicCache";
import { computeAutoEdges } from "./autoEdges";
import { computeTopicEdges } from "./topicEdges";
import { computeGroupEdges } from "./groupEdges";
import { countGroupBookmarks } from "./groupMetrics";
import { topicHueById as computeTopicHueById } from "./topicHue";
import { topicNeighborhood } from "./topicNeighborhood";
import { isPlainLetterKey, isSearchShortcutKey } from "./keyboardShortcuts";

interface Props {
  data: ChromeData;
  settings: Settings;
  resolvedTheme: ResolvedTheme;
  topicsVersion?: number;
  interactionBlocked?: boolean;
}

type SearchHit =
  | {
      kind: "bookmark";
      id: string;
      nodeId: string;
      name: string;
      subtitle: string;
      visits: number;
      bookmark: Bookmark;
      previewScopeId: string | null;
    }
  | {
      kind: "group";
      id: string;
      nodeId: string;
      name: string;
      subtitle: string;
      visits: number;
      group: Group;
      previewScopeId: string | null;
    };

const groupNodeId = (id: string) => `group:${id}`;

const isTextEntryElement = (el: HTMLElement | null): boolean => {
  if (!el) return false;
  if (el.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
};

export function Graph({ data, settings, resolvedTheme, topicsVersion, interactionBlocked = false }: Props) {
  const now = useClock();
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [pins, setPins] = useState<PinsMap>({});
  const [filter, setFilter] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Bookmark | null>(null);
  const [inlineCreating, setInlineCreating] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [groupHues, setGroupHues] = useState<GroupColors>({});
  const [topicMap, setTopicMap] = useState<Map<string, string[]>>(new Map());
  const [scopeGroupId, setScopeGroupId] = useState<string | null>(null);
  // Local-graph focus: when set, the canvas dims everything outside the
  // node's BFS neighborhood (depth 1 over manual edges). Entered via the
  // bookmark right-click menu or Alt+click; exited via ESC, the chip ×,
  // or selecting "退出聚焦" in the menu.
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [bmMenu, setBmMenu] = useState<{
    x: number;
    y: number;
    id: string;
    worldPos: { x: number; y: number };
  } | null>(null);
  const [edgeMenu, setEdgeMenu] = useState<{
    x: number;
    y: number;
    id: string;
  } | null>(null);
  const [groupMenu, setGroupMenu] = useState<{
    x: number;
    y: number;
    id: string;
  } | null>(null);
  const [canvasMenu, setCanvasMenu] = useState<{ x: number; y: number } | null>(
    null,
  );
  const filterRef = useRef<HTMLInputElement>(null);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    window.requestAnimationFrame(() => filterRef.current?.focus());
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setFilter("");
    filterRef.current?.blur();
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadGroupHues().then((m) => {
      if (!cancelled) setGroupHues(m);
    });
    const unsub = subscribeGroupHues((m) => {
      if (!cancelled) setGroupHues({ ...m });
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadEdges(), loadPins()]).then(([e, p]) => {
      if (!cancelled) {
        setEdges(e);
        setPins(p);
      }
    });
    const unsub = subscribeBookmarkChanges(() => {
      Promise.all([loadEdges(), loadPins()]).then(([e, p]) => {
        if (!cancelled) {
          setEdges(e);
          setPins(p);
        }
      });
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  // Clean orphans whenever bookmarks change.
  useEffect(() => {
    const validIds = new Set(data.bookmarks.map((b) => b.id));
    const cleanedEdges = cleanOrphanEdges(edges, validIds);
    const cleanedPins = cleanOrphanPins(pins, validIds);
    if (cleanedEdges.length !== edges.length) {
      setEdges(cleanedEdges);
      void saveEdges(cleanedEdges);
    }
    if (Object.keys(cleanedPins).length !== Object.keys(pins).length) {
      setPins(cleanedPins);
      void savePins(cleanedPins);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.bookmarks]);

  // Return to root if the current scope folder was deleted elsewhere.
  useEffect(() => {
    if (scopeGroupId && !data.groups.some((g) => g.id === scopeGroupId)) {
      setScopeGroupId(null);
    }
  }, [data.groups, scopeGroupId]);

  // Drop focus mode if the focused bookmark was deleted.
  useEffect(() => {
    if (focusedNodeId && !data.bookmarks.some((b) => b.id === focusedNodeId)) {
      setFocusedNodeId(null);
    }
  }, [data.bookmarks, focusedNodeId]);

  // BFS over manual edges from the focused node, depth 1. `null` while not
  // focused so the renderer can short-circuit.
  const focusNeighborhood = useMemo(() => {
    if (!focusedNodeId) return null;
    return computeFocusNeighborhood(edges, focusedNodeId, 1);
  }, [focusedNodeId, edges]);

  const canvasFocusSet = useMemo(
    () =>
      focusedNodeId
        ? topicMap.size
          ? topicNeighborhood(focusedNodeId, topicMap)
          : focusNeighborhood
        : null,
    [focusedNodeId, topicMap, focusNeighborhood],
  );
  const canvasFocusKind = focusedNodeId ? "node" : null;

  const focusedBookmark = useMemo(
    () =>
      focusedNodeId
        ? (data.bookmarks.find((b) => b.id === focusedNodeId) ?? null)
        : null,
    [focusedNodeId, data.bookmarks],
  );

  const scopeGroup = useMemo(
    () =>
      scopeGroupId
        ? (data.groups.find((g) => g.id === scopeGroupId) ?? null)
        : null,
    [scopeGroupId, data.groups],
  );

  // Curated host-cluster suggestions: same-cluster bookmarks not yet linked
  // to the focused node. Empty for niche hosts — the strip then disappears.
  const focusSuggestions = useMemo(
    () =>
      focusedBookmark
        ? suggestRelated(focusedBookmark, data.bookmarks, edges, 4)
        : [],
    [focusedBookmark, data.bookmarks, edges],
  );

  const closeGroupsDialog = useCallback(() => {
    setGroupsOpen(false);
    setInlineCreating(false);
  }, []);

  useEffect(() => {
    if (searchOpen) filterRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (interactionBlocked || e.defaultPrevented) return;
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest(".settings-window")) return;
      const typing = isTextEntryElement(active);
      if (e.key === "Escape") {
        if (searchOpen || filter.length > 0) {
          e.preventDefault();
          closeSearch();
        } else if (bmMenu) setBmMenu(null);
        else if (edgeMenu) setEdgeMenu(null);
        else if (groupMenu) setGroupMenu(null);
        else if (canvasMenu) setCanvasMenu(null);
        else if (groupsOpen) closeGroupsDialog();
        else if (focusedNodeId) setFocusedNodeId(null);
        else if (scopeGroupId) setScopeGroupId(null);
        else if (typing) active?.blur();
        return;
      }

      if (
        isSearchShortcutKey(e) &&
        !typing &&
        !adding &&
        !editing &&
        !groupsOpen &&
        !bmMenu &&
        !edgeMenu &&
        !groupMenu &&
        !canvasMenu
      ) {
        e.preventDefault();
        openSearch();
        return;
      }

      if (
        isPlainLetterKey(e) &&
        !typing &&
        !searchOpen &&
        !adding &&
        !editing &&
        !groupsOpen &&
        !bmMenu &&
        !edgeMenu &&
        !groupMenu &&
        !canvasMenu
      ) {
        e.preventDefault();
        setSearchOpen(true);
        setFilter(e.key);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [interactionBlocked,
    adding,
    bmMenu,
    canvasMenu,
    closeGroupsDialog,
    closeSearch,
    edgeMenu,
    editing,
    filter,
    focusedNodeId,
    groupMenu,
    groupsOpen,
    openSearch,
    scopeGroupId,
    searchOpen,
  ]);

  const onRequestEdge = (fromId: string, toId: string) => {
    const next = addEdgeFn(edges, fromId, toId);
    if (next !== edges) {
      setEdges(next);
      void saveEdges(next);
    }
  };

  const onPinToggle = (id: string, worldX: number, worldY: number) => {
    if (pins[id]) {
      const next = unsetPin(pins, id);
      setPins(next);
      void savePins(next);
    } else {
      const next = setPin(pins, id, worldX, worldY);
      setPins(next);
      void savePins(next);
    }
  };

  const buildBookmarkMenu = (
    id: string,
    worldPos: { x: number; y: number },
  ): MenuItem[] => {
    const bm = data.bookmarks.find((b) => b.id === id);
    if (!bm) return [];
    const isPinned = !!pins[id];
    const isFocused = focusedNodeId === id;
    return [
      { label: "在新标签页打开", icon: "external", onClick: () => openUrl(bm.url) },
      {
        label: copy.workspace.editBookmarkTitle + "…",
        icon: "edit",
        onClick: () => setEditing(bm),
      },
      {
        label: isFocused ? "退出聚焦" : "聚焦此节点",
        icon: "focus",
        separatorBefore: true,
        onClick: () => {
          setFocusedNodeId(isFocused ? null : id);
        },
      },
      {
        label: isPinned ? "取消固定" : "固定位置",
        icon: "pin",
        onClick: () => onPinToggle(id, worldPos.x, worldPos.y),
      },
      {
        label: copy.workspace.deleteBookmark,
        icon: "trash",
        separatorBefore: true,
        danger: true,
        onClick: () => void removeBookmark(id),
      },
    ];
  };

  const buildGroupMenu = (id: string): MenuItem[] => {
    const g = data.groups.find((x) => x.id === id);
    if (!g) return [];
    return [
      {
        label: `进入“${g.label}”`,
        icon: "folder",
        onClick: () => {
          setFocusedNodeId(null);
          setScopeGroupId(id);
        },
      },
      {
        label: copy.workspace.addBookmark,
        icon: "bookmark",
        separatorBefore: true,
        onClick: () => {
          setScopeGroupId(id);
          setAdding(true);
        },
      },
      {
        label: copy.workspace.newFolder,
        icon: "plus",
        onClick: () => {
          setScopeGroupId(id);
          setGroupsOpen(true);
          setInlineCreating(true);
        },
      },
      {
        label: "分组管理…",
        icon: "behavior",
        separatorBefore: true,
        onClick: () => {
          setScopeGroupId(id);
          setGroupsOpen(true);
        },
      },
    ];
  };

  const buildEdgeMenu = (id: string): MenuItem[] => {
    return [
      {
        label: "删除连接",
        icon: "trash",
        danger: true,
        onClick: () => {
          const next = removeEdgeFn(edges, id);
          setEdges(next);
          void saveEdges(next);
        },
      },
    ];
  };

  const buildCanvasMenu = (): MenuItem[] => {
    const parentId = scopeGroupId ?? data.barId;
    return [
      {
        label: copy.workspace.addBookmark,
        icon: "bookmark",
        onClick: () => setAdding(true),
      },
      {
        label: copy.workspace.newFolder,
        icon: "plus",
        disabled: !parentId,
        onClick: () => {
          setGroupsOpen(true);
          setInlineCreating(true);
        },
      },
      {
        label: "分组管理…",
        icon: "behavior",
        separatorBefore: true,
        onClick: () => setGroupsOpen(true),
      },
    ];
  };

  // Pre-pick a pleasant hue that isn't already used by any existing folder
  // so the inline-create swatch reads as "fresh" the moment it appears.
  const nextHue = useMemo(() => {
    const used = data.groups.map((g) => groupHues[g.id] ?? folderHue(g.id));
    return pickDistinctHue(used.map(color => typeof color === 'number' ? color : hexToOklchHue(color)).filter((hue): hue is number => hue !== null));
  }, [data.groups, groupHues]);

  const handleCommitCreate = async (name: string, color: GroupColor) => {
    const parentId = scopeGroupId ?? data.barId;
    if (!parentId) return;
    const newId = await createFolder(parentId, name);
    // Persist the color previewed in the creation form.
    if (newId && color !== folderHue(newId)) {
      await setGroupHue(newId, color);
    }
    setInlineCreating(false);
  };

  const filterQuery = filter.trim().toLowerCase();
  const searchActive = searchOpen || filter.length > 0;

  const scopeForParentId = (parentId: string): string | null =>
    parentId === data.barId ? null : parentId;

  const groupBookmarkCounts = useMemo(
    () => countGroupBookmarks(data.bookmarks, data.groups),
    [data.bookmarks, data.groups],
  );

  const toGroupNode = (g: Group): GraphItem => {
    const hue = groupHues[g.id] ?? folderHue(g.id);
    const count = groupBookmarkCounts.get(g.id) ?? 0;
    return {
      id: groupNodeId(g.id),
      parentId: g.id,
      nodeKind: "group",
      groupId: g.id,
      bookmarkCount: count,
      name: g.label,
      url: `newtab://group/${g.id}`,
      group: scopeGroup?.label ?? "首页",
      color: colorCss(hue, .56, .13),
      letter: g.label.trim().slice(0, 2) || "组",
      visits: 0,
      last: `${count}`,
    };
  };

  const searchHits = useMemo<SearchHit[]>(() => {
    if (!filterQuery) return [];
    const hits: SearchHit[] = [];
    for (const g of data.groups) {
      if (g.id === data.barId) continue;
      const hay = `${g.label}`.toLowerCase();
      if (hay.includes(filterQuery)) {
        hits.push({
          kind: "group",
          id: groupNodeId(g.id),
          nodeId: groupNodeId(g.id),
          name: g.label,
          subtitle: `分组 · ${groupBookmarkCounts.get(g.id) ?? 0} 个站点`,
          visits: groupBookmarkCounts.get(g.id) ?? 0,
          group: g,
          previewScopeId: g.parentGroupId,
        });
      }
    }
    for (const b of data.bookmarks) {
      const hay = `${b.name} ${b.url} ${b.group}`.toLowerCase();
      if (hay.includes(filterQuery)) {
        hits.push({
          kind: "bookmark",
          id: b.id,
          nodeId: b.id,
          name: b.name,
          subtitle: domainOf(b.url),
          visits: b.visits,
          bookmark: b,
          previewScopeId: scopeForParentId(b.parentId),
        });
      }
    }
    return hits.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "group" ? -1 : 1;
      return b.visits - a.visits;
    });
  }, [filterQuery, data.groups, data.bookmarks, data.barId, groupBookmarkCounts]);

  const MAX_RESULTS = 8;
  const visibleMatches = searchHits.slice(0, MAX_RESULTS);

  const [selectedIdx, setSelectedIdx] = useState(0);
  useEffect(() => {
    setSelectedIdx(0);
  }, [filterQuery]);

  const selectedHit =
    visibleMatches.length > 0
      ? (visibleMatches[Math.min(selectedIdx, visibleMatches.length - 1)] ??
        null)
      : null;
  const fallbackSearchProvider = getSearchProvider(settings);

  const effectiveScopeGroupId =
    filterQuery && selectedHit ? selectedHit.previewScopeId : scopeGroupId;
  const visibleGraphItems = useMemo<GraphItem[]>(() => {
    const childGroups = data.groups
      .filter(
        (g) => g.id !== data.barId && g.parentGroupId === effectiveScopeGroupId,
      )
      .map(toGroupNode);
    const parentId = effectiveScopeGroupId ?? data.barId;
    const looseBookmarks = parentId
      ? data.bookmarks
          .filter((b) => b.parentId === parentId)
          .map((b) => ({
            ...b,
            nodeKind: "bookmark" as const,
            topics: topicMap.get(b.id),
          }))
      : [];
    return [...childGroups, ...looseBookmarks];
  }, [
    data.groups,
    data.bookmarks,
    data.barId,
    effectiveScopeGroupId,
    groupHues,
    groupBookmarkCounts,
    topicMap,
  ]);

  useEffect(() => {
    let alive = true;
    loadTopicCache().then((cache) => {
      if (!alive) return;
      const sites = data.bookmarks.map((b) => ({
        id: b.id,
        title: b.name,
        url: b.url,
      }));
      setTopicMap(mergeTopics(sites, cache));
    });
    return () => {
      alive = false;
    };
  }, [topicsVersion, data.bookmarks]);

  // Folder membership connects the opened collection. At home, only explicit
  // links and known topic/site relationships connect nodes.
  const autoEdges = useMemo(
    () => {
      if (!settings.showEdges) return [];
      const relatedEdges = topicMap.size
        ? computeTopicEdges(visibleGraphItems, topicMap, edges)
        : computeAutoEdges(visibleGraphItems, edges);
      return [...relatedEdges, ...computeGroupEdges(
        visibleGraphItems, [...edges, ...relatedEdges], effectiveScopeGroupId,
      )];
    },
    [visibleGraphItems, edges, settings.showEdges, topicMap, effectiveScopeGroupId],
  );

  const topicHueById = useMemo(
    () =>
      topicMap.size ? computeTopicHueById(visibleGraphItems, topicMap) : null,
    [visibleGraphItems, topicMap],
  );

  const matchSet = useMemo(
    () => (filterQuery ? new Set(searchHits.map((h) => h.nodeId)) : null),
    [filterQuery, searchHits],
  );

  const focusMatchId = selectedHit?.nodeId ?? null;

  const resultsListRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = resultsListRef.current;
    if (!list) return;
    const el = list.children[selectedIdx] as HTMLElement | undefined;
    if (!el) return;
    const top = el.offsetTop;
    const bot = top + el.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bot > list.scrollTop + list.clientHeight)
      list.scrollTop = bot - list.clientHeight;
  }, [selectedIdx]);

  const openMatch = (hit: SearchHit) => {
    setScopeGroupId(hit.previewScopeId);
    if (hit.kind === "group") {
      setScopeGroupId(hit.group.id);
      setFocusedNodeId(null);
    } else {
      setFocusedNodeId(hit.bookmark.id);
      openUrl(hit.bookmark.url, settings.openInNewTab);
    }
    closeSearch();
  };

  const openSearchFallback = () => {
    if (!filterQuery) return;
    openUrl(
      searchUrlForSettings(filter.trim(), settings),
      settings.openInNewTab,
    );
    closeSearch();
  };

  const moveSearchSelection = (delta: -1 | 1) => {
    setSelectedIdx((i) => {
      if (visibleMatches.length === 0) return 0;
      return Math.min(visibleMatches.length - 1, Math.max(0, i + delta));
    });
  };

  const onFilterKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeSearch();
      return;
    }
    if (!filterQuery) return;
    const emacsPrevious =
      e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !e.shiftKey &&
      e.key.toLowerCase() === "p";
    const emacsNext =
      e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !e.shiftKey &&
      e.key.toLowerCase() === "n";
    if (e.key === "Enter") {
      e.preventDefault();
      if (selectedHit) openMatch(selectedHit);
      else openSearchFallback();
    } else if (e.key === "ArrowDown" || emacsNext) {
      e.preventDefault();
      moveSearchSelection(1);
    } else if (e.key === "ArrowUp" || emacsPrevious) {
      e.preventDefault();
      moveSearchSelection(-1);
    }
  };

  return (
    <div style={styles.root} className="graph-desktop">
      <header className="desktop-header">
        <div className="desktop-date">
          {now.toLocaleDateString("zh-CN", {
            month: "long",
            day: "numeric",
            weekday: "long",
          })}
        </div>
      </header>
      <GraphCanvas
        interactionBlocked={interactionBlocked || searchOpen || groupsOpen || adding || !!editing || !!bmMenu || !!edgeMenu || !!groupMenu || !!canvasMenu}
        bookmarks={visibleGraphItems}
        groups={data.groups as Group[]}
        edges={edges}
        autoEdges={autoEdges}
        topicHueById={topicHueById}
        showEdges={settings.showEdges}
        pins={pins}
        filterText={filter}
        filterMatches={matchSet}
        focusBookmarkId={focusMatchId ?? focusedNodeId}
        focusNeighborhood={filterQuery ? null : canvasFocusSet}
        focusKind={filterQuery ? null : canvasFocusKind}
        focusGroupId={null}
        highlightGroupId={null}
        hueOverrides={groupHues}
        reduceMotion={settings.reduceMotion}
        themeKey={resolvedTheme}
        onRequestEdge={onRequestEdge}
        onOpenBookmark={(id) => {
          const bm = data.bookmarks.find((b) => b.id === id);
          if (bm) openUrl(bm.url, settings.openInNewTab);
        }}
        onOpenGroup={(id) => {
          setFocusedNodeId(null);
          setFilter("");
          setSearchOpen(false);
          setScopeGroupId(id);
        }}
        onBookmarkMenu={(x, y, id, worldPos) =>
          setBmMenu({ x, y, id, worldPos })
        }
        onGroupMenu={(x, y, id) => setGroupMenu({ x, y, id })}
        onEdgeMenu={(x, y, id) => setEdgeMenu({ x, y, id })}
        onCanvasMenu={(x, y) => setCanvasMenu({ x, y })}
        onFocusNode={(id) => {
          setFocusedNodeId(id);
        }}
      />

      <button
        type="button"
        className="graph-search-launcher"
        onClick={openSearch}
        aria-label={copy.constellation.filterPlaceholder}
        title={copy.constellation.filterPlaceholder}
        aria-expanded={searchActive}
      >
        <span className="graph-search-launcher__icon" aria-hidden>
          <Icon name="search" size={18}/>
        </span>
      </button>

      {searchActive && (
        <div
          className="graph-search-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeSearch();
          }}
        >
          <div className="graph-search-popover" role="search" aria-label="搜索书签与分组">
            <div className="graph-floating-toolbar">
              <div className="graph-search-field">
                <input
                  ref={filterRef}
                  className="graph-search-input"
                  type="search"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  onKeyDown={onFilterKeyDown}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={copy.constellation.filterPlaceholder}
                  aria-label={copy.constellation.filterPlaceholder}
                  role="combobox"
                  aria-haspopup="listbox"
                  aria-expanded={filterQuery.length > 0}
                  aria-controls={filterQuery ? "graph-results-panel" : undefined}
                  aria-activedescendant={filterQuery ? `graph-result-${visibleMatches.length ? Math.min(selectedIdx, visibleMatches.length - 1) : 'fallback'}` : undefined}
                  aria-autocomplete="list"
                />
                {filter.length > 0 && (
                  <button
                    type="button"
                    className="graph-search-clear"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setFilter("");
                      filterRef.current?.focus();
                    }}
                    aria-label="清除搜索"
                  >
                    <ClearSearchIcon />
                  </button>
                )}
              </div>
              <button type="button" className="graph-search-dismiss" onClick={closeSearch} aria-label="关闭搜索">
                esc
              </button>
            </div>

            {!filterQuery && <div className="graph-search-empty">
              <span>搜索书签与分组</span>
              <p>输入名称、网址或分组，快速找到收藏。</p>
            </div>}

            {filterQuery && (
              <div
                id="graph-results-panel"
                className="graph-results-panel"
                role="listbox"
                aria-label="搜索结果"
              >
                <div
                  className="graph-results-list"
                  ref={resultsListRef}
                  onMouseDown={(e) => e.preventDefault()}
                >
                  {visibleMatches.length > 0 ? (
                    visibleMatches.map((hit, i) => (
                      <button
                        key={hit.id}
                        id={`graph-result-${i}`}
                        type="button"
                        role="option"
                        aria-selected={i === selectedIdx}
                        className="graph-results-item"
                        onMouseEnter={() => setSelectedIdx(i)}
                        onClick={() => openMatch(hit)}
                      >
                        {hit.kind === "bookmark" ? (
                          <Favicon
                            bookmark={hit.bookmark}
                            size={32}
                            fontSize={12}
                            radius={10}
                          />
                        ) : (
                          <span
                            className="graph-results-groupmark"
                            style={{
                              background: colorCss(groupHues[hit.group.id] ?? folderHue(hit.group.id), .62, .15),
                              color: colorInk(groupHues[hit.group.id] ?? folderHue(hit.group.id)),
                            }}
                            aria-hidden
                          >
                            <Icon name="folder" size={20} />
                          </span>
                        )}
                        <span className="graph-results-body">
                          <HighlightedName
                            text={hit.name}
                            query={filterQuery}
                          />
                          <span className="graph-results-domain">
                            {hit.subtitle}
                          </span>
                        </span>
                        <span className="graph-results-enterhint" aria-hidden>
                          <EnterKeyIcon title="" />
                        </span>
                      </button>
                    ))
                  ) : (
                    <button
                      type="button"
                      id="graph-result-fallback"
                      role="option"
                      aria-selected
                      className="graph-results-item graph-results-item--fallback"
                      onClick={openSearchFallback}
                    >
                      <span className="graph-results-favicon graph-results-favicon--provider" aria-hidden>
                        <SearchProviderLogo provider={fallbackSearchProvider.id} size={22} />
                      </span>
                      <span className="graph-results-body">
                        <span className="graph-results-name">
                          {fallbackSearchProvider.kind === "ask" ? "向" : "用"}{" "}
                          {fallbackSearchProvider.label}
                          {fallbackSearchProvider.kind === "ask"
                            ? " 提问 "
                            : " 搜索 "}
                          "<em>{filter.trim()}</em>"
                        </span>
                      </span>
                      <span className="graph-results-enterhint" aria-hidden>
                        <EnterKeyIcon title="" />
                      </span>
                    </button>
                  )}
                </div>
                <div className="graph-results-footer">
                  <span className="graph-results-summary">{searchHits.length ? `${searchHits.length} 个结果` : '搜索网络'}</span>
                  <span title="打开">
                    <kbd className="graph-kbd graph-kbd--icon">
                      <EnterKeyIcon title="" />
                    </kbd>
                    打开
                  </span>
                  <span title="上下选择，也支持 Ctrl+P / Ctrl+N">
                    <kbd className="graph-kbd">↑</kbd>
                    <kbd className="graph-kbd">↓</kbd>
                    选择
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating graph state chips stay visible without exposing search chrome. */}
      <div className="graph-hud-wrap">
        {focusedBookmark && (
          <div className="graph-focus-chip" role="status" aria-live="polite">
            <span className="graph-focus-chip__label">已聚焦</span>
            <Favicon
              bookmark={focusedBookmark}
              size={18}
              fontSize={9}
              radius={5}
            />
            <span
              className="graph-focus-chip__name"
              title={focusedBookmark.url}
            >
              {focusedBookmark.name}
            </span>
            <span
              className="graph-focus-chip__count"
              title="本地图节点数（含自身）"
            >
              {focusNeighborhood?.size ?? 1}
            </span>
            <button
              type="button"
              className="graph-focus-chip__close"
              onClick={() => setFocusedNodeId(null)}
              aria-label="退出聚焦"
              title="退出聚焦 (Esc)"
            >
              <ClearSearchIcon />
            </button>
          </div>
        )}

        {scopeGroup && (
          <div
            className="graph-focus-chip graph-focus-chip--group"
            role="status"
            aria-live="polite"
          >
            <button
              type="button"
              className="graph-group-back"
              onClick={() => {
                setFocusedNodeId(null);
                setScopeGroupId(scopeGroup.parentGroupId);
              }}
              aria-label="返回上一级"
              title="返回上一级 (Esc)"
            >
              <ChevronLeftIcon />
            </button>
            <span
              className="graph-focus-chip__swatch"
              style={{
                background: colorCss(groupHues[scopeGroup.id] ?? folderHue(scopeGroup.id), .62, .15),
                color: colorInk(groupHues[scopeGroup.id] ?? folderHue(scopeGroup.id)),
              }}
              aria-hidden
            ><Icon name="folder" size={19} /></span>
            <span className="graph-group-heading">
              <span className="graph-focus-chip__label">当前分组</span>
              <span className="graph-focus-chip__name" title={scopeGroup.label}>
                {scopeGroup.label}
              </span>
            </span>
            <span
              className="graph-focus-chip__count"
              title="当前层级内的节点数"
            >
              {visibleGraphItems.length}
            </span>
          </div>
        )}

        {focusedBookmark && focusSuggestions.length > 0 && (
          <div
            className="graph-focus-suggest"
            role="group"
            aria-label="建议关联"
          >
            <span className="graph-focus-suggest__label">建议关联</span>
            {focusSuggestions.map((b) => (
              <button
                key={b.id}
                type="button"
                className="graph-focus-suggest__pill"
                onClick={() => onRequestEdge(focusedBookmark.id, b.id)}
                title={`与 ${b.name} 建立关联`}
              >
                <Favicon bookmark={b} size={16} fontSize={9} radius={4} />
                <span className="graph-focus-suggest__name">{b.name}</span>
                <span className="graph-focus-suggest__plus" aria-hidden>
                  +
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {settings.showStrip && <ActivityDock
        bookmarks={data.bookmarks}
        recents={data.recents}
        openInNewTab={settings.openInNewTab}
        now={now}
        blocked={interactionBlocked || searchOpen || groupsOpen || adding || !!editing || !!bmMenu || !!edgeMenu || !!groupMenu || !!canvasMenu}
      />}

      {bmMenu && (
        <ContextMenu
          x={bmMenu.x}
          y={bmMenu.y}
          items={buildBookmarkMenu(bmMenu.id, bmMenu.worldPos)}
          onClose={() => setBmMenu(null)}
        />
      )}
      {edgeMenu && (
        <ContextMenu
          x={edgeMenu.x}
          y={edgeMenu.y}
          items={buildEdgeMenu(edgeMenu.id)}
          onClose={() => setEdgeMenu(null)}
        />
      )}
      {groupMenu && (
        <ContextMenu
          x={groupMenu.x}
          y={groupMenu.y}
          items={buildGroupMenu(groupMenu.id)}
          onClose={() => setGroupMenu(null)}
        />
      )}
      {canvasMenu && (
        <ContextMenu
          x={canvasMenu.x}
          y={canvasMenu.y}
          items={buildCanvasMenu()}
          onClose={() => setCanvasMenu(null)}
        />
      )}
      <BookmarkDialog
        open={adding}
        mode="create"
        groups={data.groups}
        looseGroupId={data.barId}
        hueOverrides={groupHues}
        defaultGroupId={scopeGroupId ?? data.barId ?? data.groups[0]?.id}
        onCancel={() => setAdding(false)}
        onSubmit={async ({ name, url, groupId }) => {
          setAdding(false);
          await createBookmark(groupId, name, url);
        }}
      />

      <BookmarkDialog
        open={!!editing}
        mode="edit"
        initial={
          editing
            ? {
                name: editing.name,
                url: editing.url,
                groupId: editing.parentId,
              }
            : undefined
        }
        groups={data.groups}
        looseGroupId={data.barId}
        hueOverrides={groupHues}
        onCancel={() => setEditing(null)}
        onSubmit={async ({ name, url, groupId }) => {
          if (!editing) return;
          const id = editing.id;
          setEditing(null);
          await updateBookmark(id, { title: name, url });
          if (groupId !== editing.parentId) {
            await moveBookmark(id, { parentId: groupId });
          }
        }}
      />

      {groupsOpen && (
        <div
          className="graph-groups-dialog-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeGroupsDialog();
          }}
        >
          <section
            className="graph-groups-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="graph-groups-dialog-title"
          >
            <div className="graph-groups-panel__head">
              <div className="graph-groups-panel__heading">
                <h2 id="graph-groups-dialog-title">分组管理</h2>
                <p>新分组将创建于 <span>{scopeGroup?.label ?? '首页'}</span></p>
              </div>
              <button
                type="button"
                className="graph-groups-panel__new"
                disabled={!data.barId || inlineCreating}
                onClick={() => setInlineCreating(true)}
              ><Icon name="plus" size={16} />新建分组</button>
              <button type="button" onClick={closeGroupsDialog} className="graph-groups-panel__collapse" aria-label="关闭分组管理" title="关闭">
                <ClearSearchIcon />
              </button>
            </div>
            <div className="graph-groups-panel__body">
              <GroupsPanel
                groups={data.groups}
                bookmarks={data.bookmarks}
                protectedId={data.barId}
                hueOverrides={groupHues}
                focusedId={scopeGroupId}
                onOpen={id => {
                  setFocusedNodeId(null);
                  setScopeGroupId(id);
                  closeGroupsDialog();
                }}
                onRename={(id, next) => void renameFolder(id, next)}
                onDelete={(id) => void removeFolder(id)}
                onChangeHue={(id, hue) => void setGroupHue(id, hue)}
                onResetHue={(id) => void clearGroupHue(id)}
                onMove={(id, dest) => void moveFolder(id, dest)}
                creating={inlineCreating}
                onCreatingChange={setInlineCreating}
                onCommitCreate={handleCommitCreate}
                nextHue={nextHue}
                createLocation={scopeGroup?.label ?? '首页'}
              />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function ChevronLeftIcon() { return <Icon name="chevron-left" size={14}/>; }

function EnterKeyIcon({
  title: tip,
  className,
}: {
  title: string;
  className?: string;
}) {
  return (
    <span
      className={className}
      title={tip}
      style={{ display: "inline-flex", alignItems: "center" }}
      aria-hidden
    >
      <Icon name="enter" size={14}/>
    </span>
  );
}

function ClearSearchIcon() { return <Icon name="close" size={13}/>; }

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Renders `text` with the (case-insensitive) `query` span highlighted via
 * <em>. Falls back to plain text when the query isn't literally present (it
 * might still match via other fields like URL or folder). This keeps the
 * dropdown readable while giving the user visual feedback on why each row
 * matched.
 */
function HighlightedName({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <span className="graph-results-name">{text}</span>;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(q.toLowerCase());
  if (idx < 0) return <span className="graph-results-name">{text}</span>;
  const pre = text.slice(0, idx);
  const hit = text.slice(idx, idx + q.length);
  const post = text.slice(idx + q.length);
  return (
    <span className="graph-results-name">
      {pre}
      <em>{hit}</em>
      {post}
    </span>
  );
}

const styles: Record<string, CSSProperties> = {
  root: {
    flex: 1,
    position: "relative",
    height: "100vh",
    width: "100%",
    overflow: "hidden",
    display: "flex",
  },
};
