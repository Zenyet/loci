import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupsPanel } from './GroupsPanel';
import type { Bookmark, Group, GroupColor } from '../types';

const groups: Group[] = [
  { id: 'work', label: '工作', parentGroupId: null, depth: 0 },
  { id: 'docs', label: '文档', parentGroupId: 'work', depth: 1 },
  { id: 'tools', label: '工具', parentGroupId: null, depth: 0 },
];
const bookmarks = [
  { id: 'a', parentId: 'work' }, { id: 'b', parentId: 'work' },
  { id: 'c', parentId: 'docs' }, { id: 'd', parentId: 'tools' },
] as Bookmark[];
const open = vi.fn(), rename = vi.fn(), remove = vi.fn(), changeHue = vi.fn(), move = vi.fn();
const commit = vi.fn<(name: string, color: GroupColor) => Promise<void>>();
let root: Root;
let container: HTMLDivElement;
function Harness({ create = false }: { create?: boolean }) {
  const [creating, setCreating] = useState(create);
  return <GroupsPanel groups={groups} bookmarks={bookmarks} protectedId="root" hueOverrides={{}} focusedId="tools"
    onOpen={open} onRename={rename} onDelete={remove} onChangeHue={changeHue} onResetHue={vi.fn()} onMove={move}
    creating={creating} onCreatingChange={setCreating} onCommitCreate={async (name, color) => { await commit(name, color); setCreating(false); }}
    nextHue={140} createLocation="首页" />;
}
async function render(create = false) { await act(async () => root.render(<Harness create={create} />)); }
async function clickLabel(label: string) {
  const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  expect(button).not.toBeNull();
  await act(async () => button.click());
}
async function clickText(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === label)!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
async function input(label: string, value: string) {
  const el = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function escape() {
  await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  commit.mockResolvedValue(undefined);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Folder manager', () => {
  it('filters folders by name, reports the result count and opens the chosen folder directly', async () => {
    await render();
    await input('查找分组', '工具');
    expect(container.querySelectorAll('.groups-row')).toHaveLength(1);
    expect(container.querySelector('.groups-browser__total')?.textContent).toBe('1 / 3 个分组');
    await clickLabel('打开分组 工具');
    expect(open).toHaveBeenCalledWith('tools');
    expect(rename).not.toHaveBeenCalled();
  });

  it('shows an empty search state and restores the complete list', async () => {
    await render();
    await input('查找分组', '不存在');
    expect(container.textContent).toContain('没有匹配的分组');
    await clickText('清除搜索');
    expect(container.querySelectorAll('.groups-row')).toHaveLength(3);
  });

  it('opens a separate color editor and consumes Escape before the manager closes', async () => {
    await render();
    await clickLabel('工具的更多操作');
    await clickText('更改颜色');
    const globalKey = vi.fn(); window.addEventListener('keydown', globalKey);
    try {
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      expect(document.activeElement?.textContent).toBe('完成');
      await escape();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(globalKey).not.toHaveBeenCalled();
      expect(container.querySelectorAll('.groups-row')).toHaveLength(3);
    } finally { window.removeEventListener('keydown', globalKey); }
  });

  it('keeps deleting separate from opening and includes descendant bookmarks in the confirmation', async () => {
    await render();
    await clickLabel('工作的更多操作');
    await clickText('删除分组');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('3 个书签和 1 个子分组');
    expect(remove).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    await clickText('取消');
    expect(remove).not.toHaveBeenCalled();
  });

  it('creates a trimmed name with an explicit submit', async () => {
    await render(true);
    await input('新分组名称', '  灵感  ');
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(commit).toHaveBeenCalledWith('灵感', 140);
    expect(container.querySelector('form')).toBeNull();
  });

  it('keeps the name while choosing an exact new-folder color and submits that color', async () => {
    await render(true);
    await input('新分组名称', '  灵感  ');
    await clickLabel('选择新分组颜色');
    await input('HEX 颜色', '#102030');
    await escape();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('选择新分组颜色');
    expect(container.querySelector<HTMLInputElement>('[aria-label="新分组名称"]')!.value).toBe('  灵感  ');
    expect(container.querySelector('stop[offset=".18"]')?.getAttribute('stop-color')).toBe('#102030');
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(commit).toHaveBeenCalledWith('灵感', '#102030');
  });

  it('sends neutral colors unchanged when recoloring an existing group', async () => {
    await render();
    await clickLabel('工具的更多操作');
    await clickText('更改颜色');
    await clickLabel('选择颜色 #000000');
    expect(changeHue).toHaveBeenLastCalledWith('tools', '#000000');
    await input('HEX 颜色', '#ffffff');
    expect(changeHue).toHaveBeenLastCalledWith('tools', '#ffffff');
  });

  it('keeps the new-folder input and displays an error when creation fails', async () => {
    commit.mockRejectedValue(new Error('storage unavailable'));
    await render(true);
    await input('新分组名称', '灵感');
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(container.textContent).toContain('未能创建分组，请重试。');
    expect(container.querySelector<HTMLInputElement>('[aria-label="新分组名称"]')!.value).toBe('灵感');
    await clickLabel('取消新建分组');
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelectorAll('.groups-row')).toHaveLength(3);
  });

  it('renames from the action menu without opening the folder', async () => {
    await render();
    await clickLabel('工作的更多操作');
    await clickText('重命名');
    const field = container.querySelector<HTMLInputElement>('.groups-row__editing input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, '项目');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    expect(rename).toHaveBeenCalledWith('work', '项目');
    expect(open).not.toHaveBeenCalled();
  });

  it('moves from the drag handle while preventing nesting a folder inside its descendant', async () => {
    await render();
    const rows = container.querySelectorAll<HTMLElement>('.groups-row');
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 500, bottom: 100, width: 500, height: 100, toJSON: () => {},
    });
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    const dispatchDrag = async (target: Element, type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { dataTransfer: { value: dataTransfer }, clientY: { value: 50 } });
      await act(async () => target.dispatchEvent(event));
    };
    await dispatchDrag(rows[0]!.querySelector('.groups-row__grip')!, 'dragstart');
    await dispatchDrag(rows[1]!, 'dragover');
    await dispatchDrag(rows[1]!, 'drop');
    expect(move).not.toHaveBeenCalled();
    await dispatchDrag(rows[0]!.querySelector('.groups-row__grip')!, 'dragstart');
    await dispatchDrag(rows[2]!, 'dragover');
    await dispatchDrag(rows[2]!, 'drop');
    expect(move).toHaveBeenCalledWith('work', { parentId: 'tools', index: 0 });
  });
});
