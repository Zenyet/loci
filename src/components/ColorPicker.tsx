import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import type { GroupColor } from '../types';
import { colorHex, hexToHsv, hsvToHex, normalizeHex, parseHex, rgbToHex, type HsvColor } from '../services/color';
import { Icon } from './Icon';
import './ColorPicker.css';

interface EyeDropperLike { open: () => Promise<{ sRGBHex: string }> }
type EyeDropperCtor = { new (): EyeDropperLike };
const PRESETS = ['#ef6464', '#f4a34f', '#e2c44c', '#62b87c', '#58b9c5', '#6491e8', '#ac7bdd', '#000000', '#808080', '#ffffff'] as const;

interface Props {
  value: GroupColor;
  onChange: (color: GroupColor) => void;
  onReset?: () => void;
  resetLabel?: string;
}

/** Full sRGB selection. HSV is only an editing coordinate system; storage is exact RGB. */
export function ColorPalette({ value, onChange, onReset, resetLabel = '恢复默认' }: Props) {
  const hex = colorHex(value);
  const [hsv, setHsv] = useState(() => hexToHsv(hex));
  const [hexDraft, setHexDraft] = useState(hex.toUpperCase());
  const [pickError, setPickError] = useState('');
  const lastEmitted = useRef(hex);
  const instructionsId = useId();
  const EyeDropper = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
  const rgb = parseHex(hex)!;

  useEffect(() => {
    // Keep the editing hue at black/grey, and avoid quantizing the thumb during a drag.
    if (hex !== lastEmitted.current) {
      const next = hexToHsv(hex);
      setHsv(previous => ({ ...next, h: next.s ? next.h : previous.h }));
      lastEmitted.current = hex;
    }
    setHexDraft(hex.toUpperCase());
  }, [hex]);

  const chooseHex = (next: `#${string}`) => {
    const nextHsv = hexToHsv(next);
    setHsv(previous => ({ ...nextHsv, h: nextHsv.s ? nextHsv.h : previous.h }));
    setHexDraft(next.toUpperCase());
    lastEmitted.current = next;
    onChange(next);
  };
  const chooseHsv = (next: HsvColor) => {
    setHsv(next);
    const nextHex = hsvToHex(next);
    lastEmitted.current = nextHex;
    onChange(nextHex);
  };
  const moveInPlane = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    chooseHsv({ ...hsv,
      s: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      v: 1 - Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    });
  };
  const commitHex = () => {
    const next = normalizeHex(hexDraft);
    if (next) chooseHex(next);
  };
  const pickFromScreen = async () => {
    if (!EyeDropper) return;
    setPickError('');
    try {
      const result = await new EyeDropper().open();
      const next = normalizeHex(result.sRGBHex);
      if (next) chooseHex(next);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setPickError('取色失败，请重试。');
    }
  };

  return <div className="color-palette">
    <div className="color-palette__presets" aria-label="常用颜色">
      {PRESETS.map(color => <button key={color} type="button" aria-label={`选择颜色 ${color.toUpperCase()}`} aria-pressed={hex === color}
        style={{ background: color }} onClick={() => chooseHex(color)} />)}
    </div>
    <div className="color-palette__plane" role="group" aria-label="饱和度和明度色板" aria-describedby={instructionsId} tabIndex={0}
      style={{ backgroundColor: hsvToHex({ h: hsv.h, s: 1, v: 1 }) }}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        moveInPlane(event);
      }}
      onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) moveInPlane(event); }}
      onPointerUp={event => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        moveInPlane(event);
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const step = event.shiftKey ? .1 : .01;
        chooseHsv({ ...hsv,
          s: Math.max(0, Math.min(1, hsv.s + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0))),
          v: Math.max(0, Math.min(1, hsv.v + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0))),
        });
      }}>
      <span className="color-palette__thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }} />
    </div>
    <span id={instructionsId} className="color-palette__sr-only">左右方向键调整饱和度，上下方向键调整明度，按住 Shift 加快调整。也可输入 RGB 数值。</span>
    <div className="color-palette__hue-row">
      <span className="color-palette__preview" style={{ background: hex }} aria-hidden="true" />
      <input className="color-palette__hue" aria-label="色相" type="range" min={0} max={360} step={.1} value={hsv.h}
        onChange={event => chooseHsv({ ...hsv, h: Number(event.target.value) })} />
      <span className="color-palette__degrees">{Math.round(hsv.h)}°</span>
    </div>
    <div className="color-palette__values">
      <label className="color-palette__hex">HEX
        <input aria-label="HEX 颜色" value={hexDraft} spellCheck={false} autoComplete="off" maxLength={7}
          aria-invalid={!normalizeHex(hexDraft)} onBlur={commitHex}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitHex(); } }}
          onChange={event => {
            const draft = event.target.value;
            setHexDraft(draft);
            const next = normalizeHex(draft);
            if (next && draft.replace(/^#/, '').length === 6) chooseHex(next);
          }} />
      </label>
      {(['R', 'G', 'B'] as const).map((channel, index) => <RgbChannel key={channel} label={channel} value={rgb[index]!} onChange={next => {
        const channels = [...rgb]; channels[index] = next; chooseHex(rgbToHex(channels));
      }} />)}
    </div>
    {!normalizeHex(hexDraft) && <span className="color-palette__error" role="status">请输入 3 位或 6 位 HEX 颜色。</span>}
    <div className="color-palette__footer">
      {EyeDropper && <button type="button" className="color-palette__eyedropper" onClick={() => void pickFromScreen()} aria-label="从屏幕取色"><Icon name="eyedropper" size={15} />取色</button>}
      {onReset && <button type="button" className="color-palette__reset" onClick={onReset}>{resetLabel}</button>}
    </div>
    {pickError && <span className="color-palette__error" role="status">{pickError}</span>}
  </div>;
}

function RgbChannel({ label, value, onChange }: { label: string; value: number; onChange: (next: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <label>{label}<input type="text" inputMode="numeric" aria-label={`RGB ${label}`} value={draft} maxLength={3}
    onBlur={() => setDraft(String(value))} onChange={event => {
      const next = event.target.value;
      if (!/^\d{0,3}$/.test(next)) return;
      setDraft(next);
      if (next !== '') onChange(Math.min(255, Number(next)));
    }} /></label>;
}
