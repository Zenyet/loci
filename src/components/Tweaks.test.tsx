import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tweaks } from "./Tweaks";
import { DEFAULT_SETTINGS, type Settings } from "../types";
import { GOLDEN_GATE_BACKGROUND } from "../data/backgrounds";

vi.mock("../services/userBackgrounds", () => ({
  loadUserBackgrounds: vi.fn(async () => []),
  subscribeUserBackgrounds: vi.fn(() => () => {}),
  saveUserBackground: vi.fn(),
  removeUserBackground: vi.fn(),
  MAX_USER_BACKGROUNDS: 12,
}));

let container: HTMLDivElement;
let root: Root;
const onChange = vi.fn();
const onToggle = vi.fn();

async function render(settings: Settings = DEFAULT_SETTINGS, open = true) {
  await act(async () =>
    root.render(
      <Tweaks
        settings={settings}
        onChange={onChange}
        onToggle={onToggle}
        open={open}
      />,
    ),
  );
}
async function click(selector: string) {
  const target = container.querySelector<HTMLButtonElement>(selector);
  if (!target) throw new Error(`Missing control: ${selector}`);
  await act(async () => target.click());
}
async function navigate(label: string) {
  const target = [
    ...container.querySelectorAll<HTMLButtonElement>(".settings-nav button"),
  ].find((button) => button.textContent === label);
  if (!target) throw new Error(`Missing section: ${label}`);
  await act(async () => target.click());
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onChange.mockReset();
  onToggle.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("Settings window", () => {
  it("places the connection test inside the configured model service", async () => {
    await render({ ...DEFAULT_SETTINGS, ai: { provider: 'custom', apiKey: '', model: '', baseUrl: '' } });
    await navigate('智能整理');
    const service = container.querySelector('[aria-label="模型服务"]')!;
    expect(service.textContent).toContain('测试连接');
    expect(service.querySelector('[role="status"]')).not.toBeNull();
  });

  it("keeps navigation visible while changing sections", async () => {
    await render();
    await navigate("智能整理");
    expect(
      container.querySelector('[role="dialog"]')?.getAttribute("aria-label"),
    ).toBe("设置 · 智能整理");
    expect(container.querySelectorAll(".settings-nav button")).toHaveLength(6);
    await navigate("外观");
    expect(container.querySelector('[aria-label="主题模式"]')).not.toBeNull();
  });

  it("selects a built-in wallpaper when returning from a plain background without an image", async () => {
    await render({ ...DEFAULT_SETTINGS, bg: "flat", bgImage: null });
    await navigate("壁纸");
    await click(".settings-segmented button");
    expect(onChange).toHaveBeenCalledWith({
      bg: "image",
      bgImage: GOLDEN_GATE_BACKGROUND,
    });
  });

  it("connects accessible switches to the existing settings", async () => {
    await render();
    await navigate("通用");
    await click('[role="switch"][aria-label="显示书签连线"]');
    expect(onChange).toHaveBeenCalledWith({ showEdges: false });
  });

  it("traps focus at both ends, excluding the hidden upload input", async () => {
    await render();
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    const close = container.querySelector<HTMLElement>(
      '[aria-label="关闭设置"]',
    )!;
    const last = container.querySelector<HTMLElement>('[aria-label="青色"]')!;
    expect(document.activeElement).toBe(dialog);
    close.focus();
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          cancelable: true,
        }),
      ),
    );
    expect(document.activeElement).toBe(last);
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", cancelable: true }),
      ),
    );
    expect(document.activeElement).toBe(close);
  });

  it("closes on Escape and restores the prior focus and scrolling", async () => {
    await render(DEFAULT_SETTINGS, false);
    const trigger = container.querySelector<HTMLButtonElement>(".tweaks-fab")!;
    trigger.focus();
    await render();
    expect(document.body.style.overflow).toBe("hidden");
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
      ),
    );
    expect(onToggle).toHaveBeenCalledOnce();
    await render(DEFAULT_SETTINGS, false);
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe("");
  });
});

it('uses custom listboxes and consumes Escape before the window closes', async () => {
  await render();
  await navigate('智能整理');
  expect(container.querySelector('select')).toBeNull();
  await click('[role="combobox"][aria-label="服务提供商"]');
  const trigger = container.querySelector<HTMLElement>('[role="combobox"][aria-label="服务提供商"]')!;
  const dialog = container.querySelector('[role="dialog"]')!;
  expect(dialog.querySelector('[role="listbox"]')).not.toBeNull();
  await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(container.querySelector('[role="listbox"]')).toBeNull();
  expect(onToggle).not.toHaveBeenCalled();
});

it('selects a provider by keyboard and updates its model defaults', async () => {
  await render();
  await navigate('智能整理');
  const trigger = container.querySelector<HTMLElement>('[role="combobox"][aria-label="服务提供商"]')!;
  await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
  await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })));
  await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
  expect(onChange).toHaveBeenCalledWith({ ai: expect.objectContaining({ provider: 'anthropic', model: expect.any(String) }) });
  expect(container.querySelector('[role="listbox"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it('supports keyboard changes on the custom wallpaper slider', async () => {
  await render();
  await navigate('壁纸');
  const slider = container.querySelector<HTMLElement>('[role="slider"]')!;
  expect(container.querySelector('input[type="range"]')).toBeNull();
  await act(async () => slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true })));
  expect(onChange).toHaveBeenCalledWith({ bgImageDim: .8 });
});
