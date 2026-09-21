import { useEffect, useRef, useState } from 'react';
import type { ChromeData, GroupProposal, Settings } from '../types';
import { makeGrouper } from '../services/ai/grouping';
import { selectScopedBookmarks, toProposal, applyMinGroupSize, buildApplyPlan } from '../services/grouping/plan';
import { applyGrouping, undoLastGrouping } from '../services/grouping/apply';
import { loadUndo } from '../services/grouping/store';
import { groupingErrorMessage } from '../services/grouping/errors';
import { hostOf } from '../designs/Graph/relationSuggest';
import { loadBookmarkData } from '../services/chromeApi';
import { inboxDescendants, readInbox, writableDestination } from '../services/capture';
import { withLocalLock } from '../services/localStore';
import { loadAiHistory, startAiHistory, snapshotGrouping, recordGroupingOperation, snapshotBookmark, folderSnapshot } from '../services/aiHistory';

export type GroupingStage = 'idle' | 'generating' | 'review' | 'applying' | 'complete' | 'undoing';
export interface GroupingSelection { ids: string[]; inboxId: string }
export interface GroupingWorkflow {
  selection?: GroupingSelection | null;
  select?: (selection: GroupingSelection | null) => boolean;
  stage: GroupingStage;
  proposal: GroupProposal | null;
  error: string | null;
  notice: string | null;
  canUndo: boolean;
  inputCount: number;
  result: { newFolders: number; movedBookmarks: number } | null;
  generate: () => Promise<void>;
  cancel: () => void;
  configure: () => void;
  review: () => void;
  change: (next: GroupProposal) => void;
  apply: () => Promise<void>;
  undo: () => Promise<void>;
}

export function useGrouping(data: ChromeData | null, settings: Settings, refresh: () => void, inboxId: string | null = null): GroupingWorkflow {
  const [selection, setSelection] = useState<GroupingSelection | null>(null);
  const inputSnapshot = useRef<ChromeData['bookmarks']>([]);
  const [stage, setStage] = useState<GroupingStage>('idle');
  const [proposal, setProposal] = useState<GroupProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [inputCount, setInputCount] = useState(0);
  const [result, setResult] = useState<GroupingWorkflow['result']>(null);
  const request = useRef<AbortController | null>(null);
  const mutating = useRef(false);
  const generationHistory = useRef<ReturnType<typeof startAiHistory> | null>(null);
  const proposalHistory = useRef<ReturnType<typeof startAiHistory>['record'] | null>(null);

  useEffect(() => {
    let alive = true;
    loadUndo().then(undo => { if (alive) setCanUndo(!!undo); }).catch(() => {});
    return () => {
      alive = false; request.current?.abort();
      void generationHistory.current?.finish('cancelled', '页面关闭，已停止生成，未移动书签。');
    };
  }, []);

  const generate = async () => {
    if (request.current || mutating.current || !data) return;
    const scoped = selection
      ? data.bookmarks.filter(bookmark => !bookmark.readOnly && bookmark.parentId === selection.inboxId && selection.ids.includes(bookmark.id))
      : selectScopedBookmarks(data, settings.grouping.scope);
    const excluded = inboxDescendants(data.groups, selection?.inboxId ?? inboxId);
    const availableGroups = data.groups.filter(group => !group.readOnly && !group.isRoot && !excluded.has(group.id));
    const grouper = makeGrouper(settings.ai, settings.grouping);
    if (!grouper || !scoped.length) {
      setError(!grouper ? '请先配置模型服务。' : selection ? '所选书签已离开收件箱，请返回收件箱重新选择。' : '当前范围没有需要整理的书签，可以切换到全部书签。');
      return;
    }
    const controller = new AbortController();
    const history = startAiHistory('proposal', settings.ai, selection ? '收件箱所选书签' : settings.grouping.scope === 'all' ? '全部书签' : '未分组书签', scoped.length);
    generationHistory.current = history;
    request.current = controller;
    setInputCount(scoped.length);
    setError(null); setNotice(null); setStage('generating');
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 90_000);
    try {
      const inputs = scoped.map(bookmark => ({
        id: bookmark.id, title: bookmark.name, host: hostOf(bookmark.url) ?? '',
        currentGroup: data.groups.find(group => group.id === bookmark.parentId)?.label,
      }));
      const raw = await grouper.group(inputs, availableGroups.map(group => group.label), { signal: controller.signal, maxRetries: 0 });
      controller.signal.throwIfAborted();
      const resolved = toProposal(raw, inputs.map(input => input.id), availableGroups, settings.grouping.reuseExisting);
      inputSnapshot.current = scoped.map(bookmark => ({ ...bookmark }));
      const next = applyMinGroupSize(resolved, settings.grouping.minGroupSize, settings.grouping.nameLanguage === 'en' ? 'Other' : '其他');
      history.record.grouping = snapshotGrouping(next, scoped, data, settings.grouping, false);
      proposalHistory.current = history.record;
      setProposal(next);
      setStage('review');
      await history.finish('success', `生成 ${next.groups.length} 个分组，${next.unassigned.length} 个书签保留原位；方案尚未应用。`);
    } catch (failure) {
      if (request.current !== controller) return;
      if (!controller.signal.aborted || timedOut) {
        const message = timedOut ? '模型响应超时，请稍后重试或选择响应更快的模型。' : groupingErrorMessage(failure);
        setError(message);
        setStage(proposal ? 'review' : 'idle');
        await history.finish('failed', message);
      }
    } finally {
      clearTimeout(timer);
      if (request.current === controller) request.current = null;
      if (generationHistory.current === history) generationHistory.current = null;
    }
  };
  const cancel = () => {
    request.current?.abort(); request.current = null;
    void generationHistory.current?.finish('cancelled', '已停止生成，书签保持原样。');
    generationHistory.current = null;
    setStage(proposal ? 'review' : 'idle');
    setNotice('已停止生成，书签保持原样。');
  };
  const apply = async () => {
    if (mutating.current || request.current || !proposal || !data?.barId) return;
    const barId = data.barId;
    const history = startAiHistory('grouping', settings.ai, proposalHistory.current?.scope ?? '整理方案', inputSnapshot.current.length);
    history.record.relatedId = proposalHistory.current?.id;
    // Model and preferences belong to the generated draft, even if settings changed later.
    if (proposalHistory.current) {
      history.record.provider = proposalHistory.current.provider;
      history.record.model = proposalHistory.current.model;
    }
    history.record.grouping = snapshotGrouping(proposal, data.bookmarks, data, proposalHistory.current?.grouping?.preferences ?? settings.grouping, true);
    mutating.current = true; setError(null); setStage('applying');
    try {
      await withLocalLock('capture', async () => {
        let bookmarks = data.bookmarks.filter(bookmark => !bookmark.readOnly);
        if (selection) {
          const fresh = await loadBookmarkData();
          const inbox = await readInbox(fresh);
          const excluded = inboxDescendants(fresh.groups, selection.inboxId);
          const changed = inputSnapshot.current.some(before => !fresh.bookmarks.some(now =>
            now.id === before.id && !now.readOnly && now.parentId === before.parentId && now.url === before.url));
          const invalidFolder = proposal.groups.some(group => group.existingFolderId &&
            (!writableDestination(fresh, group.existingFolderId) || excluded.has(group.existingFolderId)));
          if (!fresh.barId || fresh.barId !== barId || inbox?.id !== selection.inboxId || changed || invalidFolder) {
            const message = '书签或目标位置已变化，请重新生成方案后再应用。';
            setError(message); setStage('review'); await history.finish('failed', message); return;
          }
          const ids = new Set(inputSnapshot.current.map(bookmark => bookmark.id));
          bookmarks = fresh.bookmarks.filter(bookmark => ids.has(bookmark.id) && !bookmark.readOnly);
          history.record.grouping = snapshotGrouping(proposal, bookmarks, fresh, history.record.grouping!.preferences, true);
        }
        const plan = buildApplyPlan(proposal, bookmarks);
        if (!plan.moves.length) { setStage('review'); await history.finish('success', '当前方案无需移动书签。'); return; }
        const summary = await applyGrouping(plan, barId, { historyId: history.record.id, report: operation => recordGroupingOperation(history.record, operation) });
        setResult(summary); setProposal(null); setCanUndo(true); setStage('complete');
        refresh();
        await history.finish('success', `已移动 ${summary.movedBookmarks} 个书签，新建 ${summary.newFolders} 个文件夹。`);
      });
    } catch (failure) {
      setError(groupingErrorMessage(failure)); setStage('review');
      const incomplete = history.record.operations.some(operation => operation.status === 'failed' && ['rollback-move', 'remove-folder'].includes(operation.action));
      await history.finish(incomplete ? 'partial' : 'failed', incomplete ? '整理失败，部分位置未能恢复，请查看执行日志并检查书签。' : groupingErrorMessage(failure));
      refresh();
    } finally { mutating.current = false; }
  };
  const undo = async () => {
    if (mutating.current || request.current || !canUndo) return;
    mutating.current = true; setError(null); setStage('undoing');
    const history = startAiHistory('undo', settings.ai, '上次整理', 0);
    try {
      const undone = await withLocalLock('capture', async () => {
        const journal = await loadUndo();
        history.record.relatedId = journal?.historyId;
        history.record.inputCount = journal?.moved.length ?? 0;
        const original = journal?.historyId ? (await loadAiHistory().catch(() => [])).find(record => record.id === journal.historyId) : undefined;
        if (original?.grouping) {
          history.record.provider = original.provider; history.record.model = original.model;
          history.record.grouping = structuredClone(original.grouping);
          history.record.grouping.assignments = history.record.grouping.assignments.filter(item => journal?.moved.some(move => move.id === item.id)).map(item => ({ ...item, outcome: 'pending' }));
        } else if (journal && data) {
          history.record.grouping = { preferences: { ...settings.grouping }, folders: [], assignments: journal.moved.map(move => {
            const bookmark = data.bookmarks.find(item => item.id === move.id);
            return { ...(bookmark ? snapshotBookmark(bookmark) : { id: move.id, name: `书签 ${move.id}`, host: '' }),
              from: folderSnapshot(data, move.fromParentId), to: folderSnapshot(data, bookmark?.parentId ?? move.fromParentId), outcome: 'pending' };
          }) };
        }
        return undoLastGrouping({ report: operation => recordGroupingOperation(history.record, operation) });
      });
      setCanUndo(false); setResult(null); setProposal(null); setStage('idle');
      setNotice(undone ? '已撤销上次整理，书签已恢复到原位置。' : '没有可撤销的整理记录。');
      refresh();
      await history.finish('success', undone ? '已撤销上次整理，书签已恢复到原位置。' : '没有可撤销的整理记录。');
    } catch {
      setError('撤销未完成，请稍后重试。'); setStage(result ? 'complete' : 'idle');
      await history.finish('partial', '撤销未完成，失败的操作可以通过「撤销上次整理」继续重试。');
      refresh();
    } finally { mutating.current = false; }
  };
  return {
    selection,
    select: next => {
      if (request.current || mutating.current) return false;
      setSelection(next ? { ...next, ids: [...new Set(next.ids)] } : null);
      setProposal(null); setStage('idle'); setError(null); setNotice(null); setResult(null);
      return true;
    },
    stage, proposal, error, notice, canUndo, inputCount, result, generate, cancel, apply, undo,
    configure: () => { setStage('idle'); setError(null); setNotice(null); },
    review: () => { if (proposal) setStage('review'); },
    change: setProposal,
  };
}
