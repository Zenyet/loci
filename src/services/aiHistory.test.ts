import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Bookmark, type ChromeData } from '../types';
import { applyGrouping, undoLastGrouping } from './grouping/apply';
import { loadUndo } from './grouping/store';
import { buildApplyPlan } from './grouping/plan';
import { loadAiHistory, startAiHistory, saveAiHistory, snapshotGrouping, recordGroupingOperation, hasUnsavedAiHistory, AI_HISTORY_KEY, AI_HISTORY_LIMIT } from './aiHistory';

const bookmark = (id: string): Bookmark => ({ id, parentId: 'bar', name: `书签 ${id}`, url: `https://${id}.example/private?q=secret`, group: '', color: '', letter: '', visits: 0, last: '' });
const data: ChromeData = { bookmarks: [bookmark('a'), bookmark('b'), bookmark('c')], groups: [{ id: 'work', label: '工作', parentGroupId: null, depth: 0 }], barId: 'bar', recents: [], source: 'fallback' };
const proposal = { groups: [{ key: 'g0', name: '开发', memberIds: ['a', 'b'] }], unassigned: ['c'] };
const ai = { ...DEFAULT_SETTINGS.ai, provider: 'custom' as const, apiKey: 'never-save-this-secret', baseUrl: 'https://secret-endpoint', model: 'test-model' };
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('AI execution history', () => {
  it('persists immutable snapshots without credentials or full bookmark URLs', async () => {
    const run = startAiHistory('proposal', ai, '全部书签', 3);
    run.record.grouping = snapshotGrouping(proposal, data.bookmarks, data, DEFAULT_SETTINGS.grouping, false);
    await run.finish('success', '已生成方案');
    run.record.grouping.assignments[0]!.name = 'changed later';
    const records = await loadAiHistory();
    expect(records[0]!.grouping!.assignments[0]).toMatchObject({ name: '书签 a', host: 'a.example', from: { id: 'bar', name: '书签栏' }, to: { name: '书签栏 / 开发' }, outcome: 'planned' });
    expect(records[0]!.grouping!.assignments[2]!.outcome).toBe('kept');
    const serialized = localStorage.getItem(AI_HISTORY_KEY)!;
    expect(serialized).not.toContain(ai.apiKey); expect(serialized).not.toContain(ai.baseUrl); expect(serialized).not.toContain('?q=');
    await run.finish('failed', 'late response');
    expect(await loadAiHistory()).toHaveLength(1);
    expect((await loadAiHistory())[0]!.status).toBe('success');
  });

  it('serializes concurrent writes and retains the newest records', async () => {
    const runs = Array.from({ length: AI_HISTORY_LIMIT + 5 }, (_, index) => {
      const run = startAiHistory('analysis', ai, '全部书签', 0);
      run.record.startedAt = new Date(1_000_000 + index * 1000).toISOString(); return run;
    });
    await Promise.all(runs.map(run => run.finish('success', '复用结果')));
    const records = await loadAiHistory();
    expect(records).toHaveLength(AI_HISTORY_LIMIT);
    expect(records[0]!.id).toBe(runs.at(-1)!.record.id);
    expect(records.at(-1)!.id).toBe(runs[5]!.record.id);
    expect(hasUnsavedAiHistory()).toBe(false);
  });

  it('keeps a failed history write readable and retries it without rejecting the completed operation', async () => {
    const run = startAiHistory('grouping', ai, '全部书签', 1);
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    await expect(run.finish('success', '已移动')).resolves.toBeUndefined();
    expect(hasUnsavedAiHistory()).toBe(true);
    expect((await loadAiHistory())[0]!.summary).toBe('已移动');
    write.mockRestore();
    await startAiHistory('analysis', ai, '全部书签', 0).finish('success', '复用结果');
    expect(hasUnsavedAiHistory()).toBe(false);
    expect((await loadAiHistory()).some(item => item.id === run.record.id)).toBe(true);
  });

  it('records actual moves, failed rollback, and correlates retryable undo with its original run', async () => {
    const run = startAiHistory('grouping', ai, '全部书签', 3);
    run.record.grouping = snapshotGrouping(proposal, data.bookmarks, data, DEFAULT_SETTINGS.grouping, true);
    const deps = {
      createFolder: vi.fn().mockResolvedValue('new-folder'),
      moveBookmark: vi.fn().mockResolvedValue(undefined),
      removeFolder: vi.fn().mockResolvedValue(undefined),
      historyId: run.record.id,
      report: (operation: Parameters<typeof recordGroupingOperation>[1]) => recordGroupingOperation(run.record, operation),
    };
    await applyGrouping(buildApplyPlan(proposal, data.bookmarks), 'bar', deps);
    await run.finish('success', '已整理');
    expect((await loadUndo())!.historyId).toBe(run.record.id);
    expect(run.record.grouping.assignments.map(item => item.outcome)).toEqual(['moved', 'moved', 'kept']);
    expect(run.record.grouping.folders[0]!.id).toBe('new-folder');
    const events: Parameters<typeof recordGroupingOperation>[1][] = [];
    deps.moveBookmark.mockRejectedValueOnce(new Error('unavailable'));
    await expect(undoLastGrouping({ ...deps, report: event => events.push(event) })).rejects.toThrow();
    expect((await loadUndo())!.historyId).toBe(run.record.id);
    expect(events[0]).toMatchObject({ action: 'undo-move', status: 'failed', id: 'a' });
    await undoLastGrouping(deps);
    expect(await loadUndo()).toBeNull();

    const failure = startAiHistory('grouping', ai, '全部书签', 3);
    failure.record.grouping = snapshotGrouping(proposal, data.bookmarks, data, DEFAULT_SETTINGS.grouping, true);
    deps.moveBookmark.mockReset().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('move failed')).mockRejectedValueOnce(new Error('rollback failed'));
    deps.removeFolder.mockRejectedValueOnce(new Error('not empty'));
    await expect(applyGrouping(buildApplyPlan(proposal, data.bookmarks), 'bar', { ...deps, report: operation => recordGroupingOperation(failure.record, operation) })).rejects.toThrow();
    expect(failure.record.grouping.assignments.map(item => item.outcome)).toEqual(['restore-failed', 'failed', 'kept']);
    expect(failure.record.operations.map(item => `${item.action}:${item.status}`)).toEqual(['create-folder:success', 'move:success', 'move:failed', 'rollback-move:failed', 'remove-folder:failed']);
  });

  it('loads from extension storage and tolerates unsupported stored history versions', async () => {
    const stored: Record<string, unknown> = {};
    vi.stubGlobal('chrome', { storage: { local: { get: vi.fn(async () => stored), set: vi.fn(async (value: object) => Object.assign(stored, value)) } } });
    try {
      const run = startAiHistory('analysis', ai, '全部书签', 0);
      await saveAiHistory({ ...run.record, finishedAt: new Date().toISOString() });
      expect((await loadAiHistory())[0]!.id).toBe(run.record.id);
      stored[AI_HISTORY_KEY] = { version: 2, records: null };
      expect(await loadAiHistory()).toEqual([]);
    } finally { vi.unstubAllGlobals(); }
  });
});
