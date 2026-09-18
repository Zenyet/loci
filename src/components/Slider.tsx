import {
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import "./FormControls.css";

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}
export function Slider({ label, value, min, max, step, onChange }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const commit = (next: number) =>
    onChange(
      Number(
        Math.min(
          max,
          Math.max(min, min + Math.round((next - min) / step) * step),
        ).toFixed(6),
      ),
    );
  const fromPointer = (event: PointerEvent) => {
    const rect = trackRef.current!.getBoundingClientRect();
    if (rect.width)
      commit(min + ((event.clientX - rect.left) / rect.width) * (max - min));
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const changes: Record<string, number> = {
      ArrowRight: value + step,
      ArrowUp: value + step,
      ArrowLeft: value - step,
      ArrowDown: value - step,
      PageUp: value + step * 5,
      PageDown: value - step * 5,
      Home: min,
      End: max,
    };
    if (event.key in changes) {
      event.preventDefault();
      event.stopPropagation();
      commit(changes[event.key]);
    }
  };
  return (
    <div className="ui-slider-control">
      <div
        ref={trackRef}
        className="ui-slider"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${Math.round(value * 100)}%`}
        style={
          {
            "--slider-progress": `${((value - min) / (max - min)) * 100}%`,
          } as CSSProperties
        }
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          dragging.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          fromPointer(event);
        }}
        onPointerMove={(event) => {
          if (dragging.current === event.pointerId) fromPointer(event);
        }}
        onPointerUp={(event) => {
          if (dragging.current === event.pointerId) {
            dragging.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => {
          dragging.current = null;
        }}
        onLostPointerCapture={() => {
          dragging.current = null;
        }}
      >
        <span className="ui-slider-track">
          <span />
        </span>
        <span className="ui-slider-thumb" />
      </div>
      <span className="ui-slider-value" aria-hidden="true">
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}
