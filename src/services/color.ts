/**
 * sRGB picker helpers and compatibility with automatic OKLCH folder hues.
 *
 * Math follows Björn Ottosson's OKLab reference:
 *   https://bottosson.github.io/posts/oklab/
 */
import type { GroupColor } from '../types';

function srgbChannelToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearRgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}

/**
 * Parse a `#rrggbb` / `#rgb` string into [0..255] triple. Returns null when
 * the input doesn't match a recognisable hex pattern.
 */
export function parseHex(hex: string): [number, number, number] | null {
  const clean = hex.trim().replace(/^#/, '');
  if (!/^(?:[\da-f]{3}|[\da-f]{6})$/i.test(clean)) return null;
  if (clean.length === 3) {
    const r = parseInt(clean[0]! + clean[0]!, 16);
    const g = parseInt(clean[1]! + clean[1]!, 16);
    const b = parseInt(clean[2]! + clean[2]!, 16);
    if ([r, g, b].some(Number.isNaN)) return null;
    return [r, g, b];
  }
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if ([r, g, b].some(Number.isNaN)) return null;
    return [r, g, b];
  }
  return null;
}

/**
 * Convert an sRGB hex colour (`#rrggbb`) to an OKLCH hue in [0, 360).
 * Returns null when the hex is unparseable or the colour is so unsaturated
 * that hue is meaningless (very near-grey).
 */
export function hexToOklchHue(hex: string): number | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r8, g8, b8] = rgb;
  const r = srgbChannelToLinear(r8);
  const g = srgbChannelToLinear(g8);
  const b = srgbChannelToLinear(b8);
  const [, a, bb] = linearRgbToOklab(r, g, b);
  const chroma = Math.sqrt(a * a + bb * bb);
  if (chroma < 0.002) return null; // basically grey — no meaningful hue.
  let h = (Math.atan2(bb, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return h;
}

const clamp = (value: number, max = 1) => Math.max(0, Math.min(max, value));

export function rgbToHex(rgb: readonly number[]): `#${string}` {
  return `#${rgb.map(channel => Math.round(clamp(channel, 255)).toString(16).padStart(2, '0')).join('')}`;
}

export function normalizeHex(value: string): `#${string}` | null {
  const rgb = parseHex(value);
  return rgb ? rgbToHex(rgb) : null;
}

/** Preserve exact custom colors; L/C only style the legacy automatic palette. */
export function colorCss(color: GroupColor, lightness = .74, chroma = .17): string {
  return typeof color === 'string' ? color : `oklch(${lightness} ${chroma} ${color})`;
}

/** Keep folder glyphs readable on very light or dark custom swatches. */
export function colorInk(color: GroupColor): string {
  if (typeof color === 'number') return '#fff';
  const [r, g, b] = (parseHex(color) ?? [0, 0, 0]).map(srgbChannelToLinear) as [number, number, number];
  return .2126 * r + .7152 * g + .0722 * b > .179 ? '#000' : '#fff';
}

/** Mix in sRGB for folder shading. Returning hex also works in canvas gradients. */
export function mixHex(hex: string, target: number, amount: number): `#${string}` {
  return rgbToHex((parseHex(hex) ?? [0, 0, 0]).map(channel => channel + (target - channel) * clamp(amount)));
}

export function colorHex(color: GroupColor): `#${string}` {
  if (typeof color === 'string') return normalizeHex(color) ?? '#000000';
  const angle = color * Math.PI / 180;
  const a = .17 * Math.cos(angle), b = .17 * Math.sin(angle);
  const l = (.74 + .3963377774 * a + .2158037573 * b) ** 3;
  const m = (.74 - .1055613458 * a - .0638541728 * b) ** 3;
  const s = (.74 - .0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + .2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s,
    -.0041960863 * l - .7034186147 * m + 1.707614701 * s,
  ];
  return rgbToHex(linear.map(channel => 255 * (channel <= .0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - .055)));
}

export interface HsvColor { h: number; s: number; v: number }

export function hexToHsv(hex: string): HsvColor {
  const [r, g, b] = (parseHex(hex) ?? [0, 0, 0]).map(channel => channel / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let h = 0;
  if (delta) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
  }
  return { h: (h * 60 + 360) % 360, s: max ? delta / max : 0, v: max };
}

export function hsvToHex({ h, s, v }: HsvColor): `#${string}` {
  const hue = ((h % 360) + 360) % 360 / 60;
  const c = clamp(v) * clamp(s), x = c * (1 - Math.abs(hue % 2 - 1)), m = clamp(v) - c;
  const channels = hue < 1 ? [c, x, 0] : hue < 2 ? [x, c, 0] : hue < 3 ? [0, c, x]
    : hue < 4 ? [0, x, c] : hue < 5 ? [x, 0, c] : [c, 0, x];
  return rgbToHex(channels.map(channel => (channel + m) * 255));
}
