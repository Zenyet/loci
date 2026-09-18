import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';
import './ContextMenu.css';

export interface MenuItem {
  label: string;
  onClick: () => void;
  icon?: IconName;
  separatorBefore?: boolean;
  danger?: boolean;
  disabled?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const positionMenu = () => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({
        left: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
        top: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
      });
    };
    positionMenu();
    window.addEventListener('resize', positionMenu);
    return () => window.removeEventListener('resize', positionMenu);
  }, [x, y, items.length]);

  useEffect(() => {
    ref.current?.focus();
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeRef.current();
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, []);

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      aria-label="操作菜单"
      tabIndex={-1}
      style={position}
      onContextMenu={e => e.preventDefault()}
      onKeyDown={e => {
        if (e.key === 'Escape' || e.key === 'Tab') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
          return;
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        e.stopPropagation();
        const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        if (!buttons.length) return;
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1
          : current < 0 ? (e.key === 'ArrowDown' ? 0 : buttons.length - 1)
          : (current + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}
    >
      {items.map((item, index) => (
        <Fragment key={index}>
          {item.separatorBefore && index > 0 && <div className="context-menu__separator" role="separator" />}
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="context-menu__item"
            data-danger={item.danger || undefined}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              item.onClick();
              onClose();
            }}
          >
            <span className="context-menu__icon">{item.icon && <Icon name={item.icon} size={17} />}</span>
            <span>{item.label}</span>
          </button>
        </Fragment>
      ))}
    </div>
  );
}
