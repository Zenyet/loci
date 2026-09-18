import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import "./FormControls.css";

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}
interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  label: string;
  placeholder?: string;
  disabled?: boolean;
}

/** A keyboard-operated listbox. The menu stays inside the modal's focus boundary. */
export function Select({
  value,
  onChange,
  options,
  label,
  placeholder = "请选择",
  disabled = false,
}: SelectProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState<{
    host: HTMLElement;
    style: CSSProperties;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ text: "", at: 0 });
  const revealActive = useRef(false);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const reveal = () => {
    revealActive.current = true;
    setActive(Math.max(0, selectedIndex));
    setOpen(true);
  };
  const choose = (index: number) => {
    if (options[index]) onChange(options[index].value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const trigger = triggerRef.current;
    const host =
      trigger.closest<HTMLElement>('[role="dialog"]') ?? document.body;
    const update = () => {
      const anchor = trigger.getBoundingClientRect();
      const boundary =
        host === document.body
          ? {
              left: 0,
              top: 0,
              width: window.innerWidth,
              height: window.innerHeight,
            }
          : host.getBoundingClientRect();
      const width = Math.min(Math.max(anchor.width, 242), boundary.width - 24);
      const below = boundary.top + boundary.height - anchor.bottom - 16;
      const above = anchor.top - boundary.top - 16;
      const upward =
        below < Math.min(220, options.length * 42 + 12) && above > below;
      const height = Math.min(294, upward ? above : below);
      setPlacement({
        host,
        style: {
          position: host === document.body ? "fixed" : "absolute",
          width,
          left: Math.max(
            12,
            Math.min(
              anchor.right - boundary.left - width,
              boundary.width - width - 12,
            ),
          ),
          top: upward ? undefined : anchor.bottom - boundary.top + 6,
          bottom: upward
            ? boundary.top + boundary.height - anchor.top + 6
            : undefined,
          maxHeight: Math.max(80, height),
        },
      });
    };
    update();
    window.addEventListener("resize", update);
    const onScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) update();
    };
    document.addEventListener("scroll", onScroll, true);
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!trigger.contains(target) && !menuRef.current?.contains(target))
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => {
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("pointerdown", outside, true);
    };
  }, [open, options.length]);

  useEffect(() => {
    const menu = menuRef.current;
    if (!open || !menu || !revealActive.current) return;
    const option = menu.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!option) return;
    revealActive.current = false;
    const optionBounds = option.getBoundingClientRect();
    const bounds = menu.getBoundingClientRect();
    if (optionBounds.top < bounds.top) menu.scrollTop -= bounds.top - optionBounds.top;
    else if (optionBounds.bottom > bounds.bottom) menu.scrollTop += optionBounds.bottom - bounds.bottom;
  }, [active, open, !!placement]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (
      ["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (!open) {
        reveal();
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        choose(active);
        return;
      }
      revealActive.current = true;
      if (event.key === "Home") setActive(0);
      else if (event.key === "End") setActive(options.length - 1);
      else
        setActive(
          (index) =>
            (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) %
            options.length,
        );
      return;
    }
    if (
      event.key.length === 1 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      event.stopPropagation();
      const now = Date.now();
      const text =
        (now - typeahead.current.at > 600 ? "" : typeahead.current.text) +
        event.key.toLowerCase();
      typeahead.current = { text, at: now };
      const index = options.findIndex((option) =>
        option.label.toLowerCase().startsWith(text),
      );
      if (index >= 0) {
        revealActive.current = true;
        setActive(index);
        setOpen(true);
      }
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="ui-select-trigger"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : reveal())}
        onKeyDown={onKeyDown}
        onBlur={(event) => {
          if (!menuRef.current?.contains(event.relatedTarget as Node))
            setOpen(false);
        }}
      >
        <span>{options[selectedIndex]?.label ?? placeholder}</span>
        <span className="ui-select-chevron">
          <Icon name="chevrons" size={14} />
        </span>
      </button>
      {open &&
        placement &&
        createPortal(
          <div
            ref={menuRef}
            id={id}
            role="listbox"
            aria-label={label}
            className="ui-select-menu"
            style={placement.style}
            onPointerDown={(event) => event.preventDefault()}
          >
            {options.map((option, index) => (
              <div
                key={option.value}
                id={`${id}-${index}`}
                role="option"
                aria-selected={value === option.value}
                data-index={index}
                data-active={active === index || undefined}
                className="ui-select-option"
                onPointerMove={() => { revealActive.current = false; setActive(index); }}
                onClick={() => choose(index)}
              >
                <span className="ui-select-option-mark">
                  {value === option.value && <Icon name="check" size={14} />}
                </span>
                <span>
                  <strong>{option.label}</strong>
                  {option.description && <small>{option.description}</small>}
                </span>
              </div>
            ))}
          </div>,
          placement.host,
        )}
    </>
  );
}
