import { describe, expect, it } from 'vitest';
import { colorCss, colorHex, colorInk, hexToHsv, hsvToHex, hexToOklchHue, normalizeHex, parseHex, rgbToHex } from './color';

describe('parseHex', () => {
  it('accepts 6-digit hex', () => {
    expect(parseHex('#ff0000')).toEqual([255, 0, 0]);
  });
  it('accepts 3-digit hex', () => {
    expect(parseHex('#f00')).toEqual([255, 0, 0]);
  });
  it('accepts without leading hash', () => {
    expect(parseHex('00ff00')).toEqual([0, 255, 0]);
  });
  it('rejects garbage', () => {
    expect(parseHex('not-a-color')).toBeNull();
    expect(parseHex('')).toBeNull();
    expect(parseHex('#zzzzzz')).toBeNull();
    expect(parseHex('#1z2z3z')).toBeNull();
  });
});

describe('full RGB colors', () => {
  it('normalizes exact colors and preserves black, white, and gray', () => {
    expect(normalizeHex(' #AbC ')).toBe('#aabbcc');
    for (const hex of ['#000000', '#ffffff', '#808080', '#123456'] as const) {
      expect(colorCss(hex)).toBe(hex);
      expect(colorHex(hex)).toBe(hex);
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
    expect(colorCss(140)).toBe('oklch(0.74 0.17 140)');
    expect(colorHex(140)).toMatch(/^#[\da-f]{6}$/);
    expect(colorInk('#ffffff')).toBe('#000');
    expect(colorInk('#000000')).toBe('#fff');
  });

  it('round trips colors throughout the RGB cube without losing channel precision', () => {
    for (let r = 0; r <= 255; r += 17) for (let g = 0; g <= 255; g += 17) for (let b = 0; b <= 255; b += 17) {
      const hex = rgbToHex([r, g, b]);
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
  });

  it('maps the color-plane corners to white, a pure hue, and black', () => {
    expect(hsvToHex({ h: 120, s: 0, v: 1 })).toBe('#ffffff');
    expect(hsvToHex({ h: 120, s: 1, v: 1 })).toBe('#00ff00');
    expect(hsvToHex({ h: 120, s: 1, v: 0 })).toBe('#000000');
    expect(hsvToHex({ h: 120, s: 0, v: .5 })).toBe('#808080');
  });
});

describe('hexToOklchHue', () => {
  it('returns null for near-greys', () => {
    expect(hexToOklchHue('#ffffff')).toBeNull();
    expect(hexToOklchHue('#808080')).toBeNull();
    expect(hexToOklchHue('#000000')).toBeNull();
  });

  it('returns a hue in [0, 360) for chromatic colors', () => {
    const red = hexToOklchHue('#ff0000');
    const green = hexToOklchHue('#00ff00');
    const blue = hexToOklchHue('#0000ff');
    for (const h of [red, green, blue]) {
      expect(h).not.toBeNull();
      expect(h!).toBeGreaterThanOrEqual(0);
      expect(h!).toBeLessThan(360);
    }
  });

  it('maps primary colors into expected OKLCH sectors', () => {
    // Reference OKLCH hues (Björn Ottosson):
    //   red   ~29°
    //   green ~142°
    //   blue  ~264°
    const red = hexToOklchHue('#ff0000')!;
    const green = hexToOklchHue('#00ff00')!;
    const blue = hexToOklchHue('#0000ff')!;
    expect(red).toBeGreaterThan(15);
    expect(red).toBeLessThan(45);
    expect(green).toBeGreaterThan(125);
    expect(green).toBeLessThan(160);
    expect(blue).toBeGreaterThan(245);
    expect(blue).toBeLessThan(285);
  });
});
