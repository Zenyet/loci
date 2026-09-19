import { colorCss, colorInk } from '../services/color';
import type { GroupColor, GroupColors } from '../types';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Group } from '../types';
import { folderHue } from '../designs/Graph/folderHue';
import './GroupSelect.css';
import { Icon } from './Icon';

interface Props {
  value: string;
  groups: Group[];
  looseGroupId?: string | null;
  hueOverrides?: GroupColors;
  onChange: (id: string) => void;
}

interface Option {
  id: string;
  label: string;
  meta: string;
  depth: number;
  hue: GroupColor | null;
  loose: boolean;
}

export function GroupSelect({
  value,
  groups,
  looseGroupId,
  hueOverrides,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState({ upward: false, maxHeight: 280 });

  const options = useMemo<Option[]>(() => {
    const byId = new Map(groups.map((g) => [g.id, g] as const));
    const rows: Option[] = [];
    if (looseGroupId) {
      rows.push({
        id: looseGroupId,
        label: '未分组',
        meta: '书签栏直属',
        depth: 0,
        hue: null,
        loose: true,
      });
    }
    for (const g of groups.filter(group => !group.readOnly)) {
      const parentLabel = g.parentGroupId
        ? byId.get(g.parentGroupId)?.label ?? '子分组'
        : '顶层分组';
      rows.push({
        id: g.id,
        label: g.label,
        meta: parentLabel,
        depth: g.depth,
        hue: hueOverrides?.[g.id] ?? folderHue(g.id),
        loose: false,
      });
    }
    return rows;
  }, [groups, hueOverrides, looseGroupId]);

  const selected = options.find((o) => o.id === value) ?? options[0] ?? null;

  useLayoutEffect(() => {
    if (!open) return;
    const placeMenu = () => {
      const anchor = buttonRef.current?.getBoundingClientRect();
      if (!anchor || !menuRef.current) return;
      const below = window.innerHeight - anchor.bottom - 14;
      const above = anchor.top - 14;
      const needed = Math.min(280, menuRef.current.scrollHeight);
      const upward = below < needed && above > below;
      setPlacement({ upward, maxHeight: Math.max(80, Math.min(280, upward ? above : below)) });
    };
    placeMenu();
    window.addEventListener('resize', placeMenu);
    return () => window.removeEventListener('resize', placeMenu);
  }, [open, options.length]);

  useEffect(() => {
    const menu = menuRef.current;
    const active = menu?.querySelector<HTMLElement>('[data-active="true"]');
    if (!open || !menu || !active) return;
    const bounds = menu.getBoundingClientRect();
    const item = active.getBoundingClientRect();
    if (item.top < bounds.top) menu.scrollTop -= bounds.top - item.top;
    else if (item.bottom > bounds.bottom) menu.scrollTop += item.bottom - bounds.bottom;
  }, [open, activeIndex]);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = Math.max(0, options.findIndex((o) => o.id === value));
    setActiveIndex(selectedIndex);
  }, [open, options, value]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  const choose = (id: string) => {
    onChange(id);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (options.length === 0) return;
    if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const active = options[activeIndex];
      if (active) choose(active.id);
    }
  };

  return (
    <div className="group-select" ref={rootRef} onKeyDown={e => {
      if (open && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
    }}>
      <button
        ref={buttonRef}
        type="button"
        className="group-select__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="bookmark-group-select-list"
        disabled={options.length === 0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
      >
        <GroupMark option={selected} />
        <span className="group-select__main">
          <span className="group-select__label">
            {selected?.label ?? '没有可选分组'}
          </span>
          {selected && <span className="group-select__meta">{selected.meta}</span>}
        </span>
        <ChevronIcon />
      </button>

      {open && (
        <div
          ref={menuRef}
          id="bookmark-group-select-list"
          className="group-select__menu"
          style={{
            top: placement.upward ? 'auto' : 'calc(100% + 6px)',
            bottom: placement.upward ? 'calc(100% + 6px)' : 'auto',
            maxHeight: placement.maxHeight,
          }}
          role="listbox"
          aria-label="选择书签分组"
        >
          {options.length > 0 ? (
            options.map((option, index) => (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={option.id === value}
                data-active={index === activeIndex}
                className="group-select__option"
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(option.id)}
                style={{ paddingLeft: 8 + option.depth * 14 }}
              >
                <GroupMark option={option} />
                <span className="group-select__main">
                  <span className="group-select__label">{option.label}</span>
                  <span className="group-select__meta">{option.meta}</span>
                </span>
              </button>
            ))
          ) : (
            <div className="group-select__empty">没有可用分组</div>
          )}
        </div>
      )}
    </div>
  );
}

function GroupMark({ option }: { option: Option | null }) {
  if (!option || option.loose || option.hue === null) {
    return <span className="group-select__mark group-select__mark--loose" aria-hidden><Icon name="bookmark" size={16} /></span>;
  }
  return (
    <span
      className="group-select__mark"
      style={{ background: colorCss(option.hue, .62, .15), color: colorInk(option.hue) }}
      aria-hidden
    ><Icon name="folder" size={17} /></span>
  );
}

function ChevronIcon() {
  return <Icon name="chevron-down" size={14} className="group-select__chevron" />;
}
