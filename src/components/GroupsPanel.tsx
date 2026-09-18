import type { CSSProperties, DragEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Bookmark, Group } from '../types';
import { folderHue } from '../designs/Graph/folderHue';
import { HuePalette } from './ColorPicker';
import { InlineEdit } from './InlineEdit';
import { ConfirmDialog } from './ConfirmDialog';
import { ContextMenu } from './ContextMenu';
import { Modal } from './Modal';
import { TextInput } from './TextInput';
import { FolderIcon } from './FolderIcon';
import { Icon } from './Icon';
import './GroupsPanel.css';

interface Props {
  groups: Group[];
  bookmarks: Bookmark[];
  protectedId: string | null;
  hueOverrides: Record<string, number>;
  focusedId: string | null;
  onOpen: (id: string) => void;
  onRename: (id: string, next: string) => void;
  onDelete: (id: string) => void;
  onChangeHue: (id: string, hue: number) => void;
  onResetHue: (id: string) => void;
  onMove: (id: string, dest: { parentId: string; index: number }) => void;
  creating: boolean;
  onCreatingChange: (next: boolean) => void;
  onCommitCreate: (name: string) => Promise<void> | void;
  nextHue: number;
  createLocation: string;
}
type DropZone = 'before' | 'inside' | 'after';

/** A searchable folder list. Opening, editing, and reordering have distinct controls. */
export function GroupsPanel({
  groups, bookmarks, protectedId, hueOverrides, focusedId, onOpen,
  onRename, onDelete, onChangeHue, onResetHue, onMove,
  creating, onCreatingChange, onCommitCreate, nextHue, createLocation,
}: Props) {
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; zone: DropZone } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Group | null>(null);
  const [colorGroup, setColorGroup] = useState<Group | null>(null);
  const [menu, setMenu] = useState<{ group: Group; x: number; y: number } | null>(null);
  const [inlineName, setInlineName] = useState('');
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState('');
  useEffect(() => {
    setInlineName('');
    setCreateError('');
    if (creating) setQuery('');
  }, [creating]);

  const byId = useMemo(() => new Map(groups.map(group => [group.id, group])), [groups]);
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    for (const bookmark of bookmarks) result.set(bookmark.parentId, (result.get(bookmark.parentId) ?? 0) + 1);
    return result;
  }, [bookmarks]);
  const countFor = (id: string) => counts.get(id) ?? 0;
  const visibleGroups = groups.filter(group => group.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const totalBookmarks = groups.reduce((sum, group) => sum + countFor(group.id), 0);
  const siblingsOf = (parentId: string | null) => groups.filter(group => group.parentGroupId === parentId);
  const isDescendantOf = (id: string, ancestorId: string): boolean => {
    const seen = new Set<string>();
    let cursor: string | null = id;
    while (cursor && !seen.has(cursor)) {
      if (cursor === ancestorId) return true;
      seen.add(cursor);
      cursor = byId.get(cursor)?.parentGroupId ?? null;
    }
    return false;
  };
  const confirmDeleteMessage = (group: Group) => {
    const descendants = groups.filter(candidate => isDescendantOf(candidate.id, group.id));
    const bookmarksCount = descendants.reduce((sum, candidate) => sum + countFor(candidate.id), 0);
    return `确认删除“${group.label}”？其中的 ${bookmarksCount} 个书签${descendants.length > 1 ? `和 ${descendants.length - 1} 个子分组` : ''}也会一并移除。`;
  };
  const onRowDragStart = (e: DragEvent<HTMLElement>, g: Group) => {
    if (g.id === protectedId) return;
    setDragId(g.id);
    e.dataTransfer.effectAllowed = 'move';
    // Some browsers need a non-empty payload to actually start the drag.
    e.dataTransfer.setData('text/plain', g.id);
  };

  const zoneFor = (y: number, top: number, height: number): DropZone => {
    const rel = (y - top) / height;
    if (rel < 0.28) return 'before';
    if (rel > 0.72) return 'after';
    return 'inside';
  };

  const onRowDragOver = (e: DragEvent<HTMLElement>, g: Group) => {
    if (!dragId || dragId === g.id) return;
    // Block dropping a group into one of its descendants.
    if (isDescendantOf(g.id, dragId)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    let zone = zoneFor(e.clientY, rect.top, rect.height);
    // You can't nest *inside* the virtual "置顶" row — it's not a real
    // folder in our UI sense. Collapse inside→after for it.
    if (g.id === protectedId && zone === 'inside') zone = 'after';
    if (!dropTarget || dropTarget.id !== g.id || dropTarget.zone !== zone) {
      setDropTarget({ id: g.id, zone });
    }
  };

  const onRowDrop = (e: DragEvent<HTMLElement>, g: Group) => {
    if (!dragId || dragId === g.id || !protectedId) {
      resetDrag();
      return;
    }
    if (isDescendantOf(g.id, dragId)) {
      resetDrag();
      return;
    }
    e.preventDefault();
    const zone = dropTarget?.zone ?? 'before';

    if (zone === 'inside') {
      // Nest dragged group as a child of `g`. Insert at the end of its
      // current children — felt like the most forgiving default.
      const destParent = g.id;
      const siblingsAfter = siblingsOf(g.id).filter((x) => x.id !== dragId);
      onMove(dragId, { parentId: destParent, index: siblingsAfter.length });
      resetDrag();
      return;
    }

    // Reorder: insert before/after `g` within g's parent. Compute the index
    // after removing the dragged group from its old position (chrome.move
    // uses remove-then-insert semantics).
    const destParentGroupId = g.parentGroupId; // may be null (top-level)
    const destParent =
      destParentGroupId === null ? protectedId : destParentGroupId;
    const destSiblings = siblingsOf(destParentGroupId);
    const withoutDragged = destSiblings.filter((x) => x.id !== dragId);
    const anchorPos = withoutDragged.findIndex((x) => x.id === g.id);
    if (anchorPos < 0) {
      resetDrag();
      return;
    }
    const index = zone === 'before' ? anchorPos : anchorPos + 1;

    const fromParentGroupId =
      groups.find((x) => x.id === dragId)?.parentGroupId ?? null;
    const fromSiblings = siblingsOf(fromParentGroupId);
    const fromIdx = fromSiblings.findIndex((x) => x.id === dragId);
    const sameParent = fromParentGroupId === destParentGroupId;
    if (sameParent && fromIdx === index) {
      resetDrag();
      return;
    }
    onMove(dragId, { parentId: destParent, index });
    resetDrag();
  };

  const resetDrag = () => {
    setDragId(null);
    setDropTarget(null);
  };

  const submitInline = async () => {
    const name = inlineName.trim();
    if (!name || saving) return;
    setSaving(true);
    setCreateError('');
    try {
      await onCommitCreate(name);
    } catch {
      setCreateError('未能创建分组，请重试。');
    } finally {
      setSaving(false);
    }
  };

  return <div className="groups-browser" onKeyDown={event => {
    if (event.key === 'Escape' && (colorGroup || pendingDelete)) {
      event.preventDefault();
      event.stopPropagation();
      setColorGroup(null);
      setPendingDelete(null);
    }
  }}>
    <div className="groups-browser__toolbar">
      <TextInput aria-label="查找分组" placeholder="查找分组" value={query} onChange={setQuery} />
      <span className="groups-browser__total">{query.trim() ? `${visibleGroups.length} / ${groups.length}` : groups.length} 个分组</span>
    </div>
    <div className="groups-browser__columns" aria-hidden="true"><span>名称</span><span>书签</span><span /></div>
    <div className="groups-browser__list">
      {creating && <form className="groups-create" onSubmit={event => { event.preventDefault(); void submitInline(); }} onKeyDown={event => {
        if (event.key === 'Escape' && !saving) {
          event.preventDefault(); event.stopPropagation(); onCreatingChange(false);
        }
      }}>
        <FolderIcon hue={nextHue} size={40} />
        <div className="groups-create__field">
          <TextInput autoFocus aria-label="新分组名称" placeholder="输入分组名称" value={inlineName} onChange={setInlineName} disabled={saving} />
          <span>{createError || `创建于 ${createLocation}`}</span>
        </div>
        <button type="submit" className="groups-create__submit" disabled={!inlineName.trim() || saving}>{saving ? '创建中…' : '创建'}</button>
        <button type="button" className="groups-row__more" aria-label="取消新建分组" disabled={saving} onClick={() => onCreatingChange(false)}><Icon name="close" size={16} /></button>
      </form>}
      {visibleGroups.map(group => {
        const isProtected = group.id === protectedId;
        const isEditing = editingId === group.id;
        const isCurrent = focusedId === group.id;
        const hue = hueOverrides[group.id] ?? folderHue(group.id);
        const indicator = dropTarget?.id === group.id ? dropTarget.zone : undefined;
        const children = groups.filter(child => child.parentGroupId === group.id).length;
        const parentLabel = group.parentGroupId ? byId.get(group.parentGroupId)?.label ?? '子分组' : '首页';
        return <div
          key={group.id}
          className="groups-row"
          data-current={isCurrent || undefined}
          data-drop={indicator}
          data-dragging={dragId === group.id || undefined}
          style={{ '--group-indent': `${query ? 0 : Math.min(group.depth, 8) * 18}px` } as CSSProperties}
          onDragOver={event => onRowDragOver(event, group)}
          onDrop={event => onRowDrop(event, group)}
          onContextMenu={event => { if (isProtected) return; event.preventDefault(); setMenu({ group, x: event.clientX, y: event.clientY }); }}
        >
          <span className="groups-row__grip" draggable={!isProtected && !isEditing && !query.trim()} onDragStart={event => onRowDragStart(event, group)} onDragEnd={resetDrag} aria-hidden="true" title="拖动以排序或移入其他分组">
            {!isProtected && <Icon name="grip" size={14} />}
          </span>
          <FolderIcon hue={hue} />
          {isEditing ? <div className="groups-row__editing" onKeyDown={event => event.stopPropagation()}>
            <InlineEdit value={group.label} placeholder="分组名称" style={{ width: '100%', padding: '7px 9px', borderRadius: 9, fontSize: 13 }} onSubmit={next => { setEditingId(null); onRename(group.id, next); }} onCancel={() => setEditingId(null)} />
          </div> : <button type="button" className="groups-row__open" onClick={() => onOpen(group.id)} aria-label={`打开分组 ${group.label}`}>
            <span className="groups-row__name">{group.label}{isCurrent && <span className="groups-row__current">正在浏览</span>}</span>
            <span className="groups-row__meta">{parentLabel}{children > 0 && ` · ${children} 个子分组`}</span>
          </button>}
          <span className="groups-row__count">{countFor(group.id)}</span>
          <button type="button" className="groups-row__more" disabled={isProtected} aria-label={`${group.label}的更多操作`} aria-haspopup="menu" aria-expanded={menu?.group.id === group.id} onClick={event => {
            const rect = event.currentTarget.getBoundingClientRect();
            setMenu({ group, x: rect.right - 220, y: rect.bottom + 5 });
          }}><Icon name="more" size={18} /></button>
        </div>;
      })}
      {!visibleGroups.length && !creating && <div className="groups-browser__empty">
        <FolderIcon hue={260} size={52} />
        <strong>{query ? '没有匹配的分组' : '还没有分组'}</strong>
        <span>{query ? '换个名称试试，或清除搜索查看全部。' : '点击右上角“新建分组”，开始整理收藏。'}</span>
        {query && <button type="button" onClick={() => setQuery('')}>清除搜索</button>}
      </div>}
    </div>
    <div className="groups-browser__footer"><span>{totalBookmarks} 个书签</span><span>拖动左侧手柄，调整分组层级</span></div>

    {menu && createPortal(<ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
      { label: '重命名', icon: 'edit', onClick: () => setEditingId(menu.group.id) },
      { label: '更改颜色', icon: 'look', onClick: () => setColorGroup(menu.group) },
      { label: '删除分组', icon: 'trash', danger: true, separatorBefore: true, onClick: () => setPendingDelete(menu.group) },
    ]} />, document.body)}
    {createPortal(<ConfirmDialog open={!!pendingDelete} title="删除分组" message={pendingDelete ? confirmDeleteMessage(pendingDelete) : ''} danger confirmLabel="删除" onConfirm={() => { if (pendingDelete) onDelete(pendingDelete.id); setPendingDelete(null); }} onCancel={() => setPendingDelete(null)} />, document.body)}
    {colorGroup && createPortal(<Modal open title={`“${colorGroup.label}”的颜色`} width={330} onClose={() => setColorGroup(null)}>
      <HuePalette value={hueOverrides[colorGroup.id] ?? folderHue(colorGroup.id)} onChange={hue => onChangeHue(colorGroup.id, hue)} onReset={() => onResetHue(colorGroup.id)} resetLabel="恢复默认" />
      <div className="dialog-actions"><button autoFocus type="button" className="dialog-button dialog-button--primary" onClick={() => setColorGroup(null)}>完成</button></div>
    </Modal>, document.body)}
  </div>;
}
