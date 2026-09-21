import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AiHistory } from './AiHistory';
import { DEFAULT_SETTINGS } from '../types';
import { startAiHistory } from '../services/aiHistory';

let root: Root, container: HTMLDivElement;
async function click(name: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === name || item.textContent?.startsWith(name));
  if (!button) throw new Error(`Missing ${name}`);
  await act(async () => button.click());
}
beforeEach(() => {
  localStorage.clear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it('shows the empty state and updates when a run finishes while history is open', async () => {
  await act(async () => root.render(<AiHistory />));
  expect(container.textContent).toContain('还没有执行记录');
  await act(async () => { await startAiHistory('proposal', DEFAULT_SETTINGS.ai, '未分组书签', 3).finish('cancelled', '已停止生成'); });
  expect(container.textContent).toContain('已停止生成');
  expect(container.textContent).toContain('1 条记录');
});

it('filters, searches historical bookmark snapshots, expands details and follows the source proposal', async () => {
  const proposal = startAiHistory('proposal', DEFAULT_SETTINGS.ai, '全部书签', 1);
  proposal.record.grouping = { preferences: DEFAULT_SETTINGS.grouping, folders: [{ key: 'g0', name: '开发', reused: false }], assignments: [{ id: 'a', name: 'GitHub', host: 'github.com', from: { name: '书签栏' }, to: { name: '开发' }, outcome: 'planned' }] };
  await proposal.finish('success', '生成 1 个分组');
  const grouping = startAiHistory('grouping', DEFAULT_SETTINGS.ai, '全部书签', 1);
  grouping.record.relatedId = proposal.record.id;
  grouping.record.grouping = structuredClone(proposal.record.grouping);
  grouping.record.grouping.assignments[0]!.outcome = 'moved';
  await grouping.finish('success', '已移动 1 个书签');
  const analysis = startAiHistory('analysis', DEFAULT_SETTINGS.ai, '全部书签', 2);
  analysis.record.analysis = { requested: 2, reused: 0, bookmarks: [{ id: 'a', name: 'GitHub', host: 'github.com', before: [], after: ['开发'], outcome: 'classified' }, { id: 'b', name: 'MDN', host: 'mdn.com', before: [], after: ['开发'], outcome: 'classified' }], edges: [{ from: 'a', to: 'b', topic: '开发', change: 'added' }] };
  await analysis.finish('success', '新增 1 条连线');
  await act(async () => root.render(<AiHistory />));
  expect(container.querySelectorAll('article')).toHaveLength(3);
  await click('分析连线');
  expect(container.querySelectorAll('article')).toHaveLength(1);
  await act(async () => container.querySelector<HTMLButtonElement>('.ai-history-summary')!.click());
  expect(container.textContent).toContain('GitHub ↔ MDN');
  expect(container.textContent).toContain('共同主主题：开发');
  expect(container.querySelector('.ai-history-summary')!.getAttribute('aria-expanded')).toBe('true');
  await click('整理');
  const search = container.querySelector<HTMLInputElement>('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'GitHub');
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(container.querySelectorAll('article')).toHaveLength(2);
  await click('应用整理');
  expect(container.textContent).toContain('已移动');
  await click('查看来源方案');
  expect(container.querySelector('.ai-history-summary[aria-expanded="true"]')!.textContent).toContain('生成整理方案');
  expect(container.textContent).toContain('计划移动');
  expect(container.querySelector('select')).toBeNull();
  await act(async () => root.unmount()); root = createRoot(container);
  await act(async () => root.render(<AiHistory />));
  expect(container.querySelectorAll('article')).toHaveLength(3);
});
