import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi } from 'vitest';
import { viewToWorld, worldToView, clampScale, zoomAt, desktopCamera, useCamera, type UseCamera } from './useCamera';

const cam = { scale: 1, tx: 0, ty: 0 };
const size = { width: 1000, height: 600 };

describe('viewToWorld / worldToView', () => {
  it('inverse at identity', () => {
    const [wx, wy] = viewToWorld(cam, 100, 80, size);
    const [vx, vy] = worldToView(cam, wx, wy, size);
    expect(vx).toBeCloseTo(100, 5);
    expect(vy).toBeCloseTo(80, 5);
  });

  it('respects pan', () => {
    const c = { scale: 1, tx: 50, ty: 25 };
    const [wx, wy] = viewToWorld(c, 500, 300, size);
    expect(wx).toBeCloseTo(-50, 5);
    expect(wy).toBeCloseTo(-25, 5);
  });

  it('respects scale', () => {
    const c = { scale: 2, tx: 0, ty: 0 };
    const [wx, wy] = viewToWorld(c, 600, 400, size);
    expect(wx).toBeCloseTo(50, 5);
    expect(wy).toBeCloseTo(50, 5);
  });
});

describe('clampScale', () => {
  it('clamps within bounds', () => {
    expect(clampScale(0.1)).toBe(0.3);
    expect(clampScale(5)).toBe(3);
    expect(clampScale(1)).toBe(1);
  });
});

describe('zoomAt', () => {
  it('keeps the anchor point fixed in world space', () => {
    const next = zoomAt(cam, 2, 600, 400, size);
    const [wx, wy] = viewToWorld(next, 600, 400, size);
    const [wxStart, wyStart] = viewToWorld(cam, 600, 400, size);
    expect(wx).toBeCloseTo(wxStart, 3);
    expect(wy).toBeCloseTo(wyStart, 3);
  });
});

it('does not emit redraws for wheel momentum at the scale limit', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let camera!: UseCamera;
  function Harness() { camera = useCamera({ scale: 3, tx: 20, ty: -30 }); return null; }
  const root = createRoot(document.createElement('div'));
  act(() => root.render(createElement(Harness)));
  try {
    const draw = vi.fn();
    camera.subscribe(draw);
    for (let i = 0; i < 100; i++) camera.wheelZoom(100 + i, 200, -40, size);
    expect(draw).not.toHaveBeenCalled();
    expect(camera.cameraRef.current).toEqual({ scale: 3, tx: 20, ty: -30 });
    const anchor = viewToWorld(camera.cameraRef.current, 100, 200, size);
    camera.wheelZoom(100, 200, 30, size);
    expect(draw).toHaveBeenCalledOnce();
    const nextAnchor = viewToWorld(camera.cameraRef.current, 100, 200, size);
    expect(nextAnchor[0]).toBeCloseTo(anchor[0]);
    expect(nextAnchor[1]).toBeCloseTo(anchor[1]);
  } finally { act(() => root.unmount()); vi.unstubAllGlobals(); }
});


describe('desktopCamera', () => {
  it('keeps the initial folder ring clear of the toolbar and dock', () => {
    const viewport = { width: 1280, height: 720 };
    const camera = desktopCamera(viewport);
    const [, top] = worldToView(camera, 0, -310, viewport);
    const [, bottom] = worldToView(camera, 0, 330, viewport);
    expect(top).toBeGreaterThan(90);
    expect(bottom).toBeLessThan(viewport.height - 85);
  });

  it('keeps the initial ring inside a narrow viewport', () => {
    const viewport = { width: 390, height: 844 };
    const camera = desktopCamera(viewport);
    const [left] = worldToView(camera, -310, 0, viewport);
    const [right] = worldToView(camera, 310, 0, viewport);
    expect(left).toBeGreaterThan(20);
    expect(right).toBeLessThan(viewport.width - 20);
  });
});
