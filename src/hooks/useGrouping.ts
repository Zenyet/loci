import { useEffect, useRef, useState } from 'react';
import type { ChromeData, GroupProposal, Settings } from '../types';
import { makeGrouper } from '../services/ai/grouping';
import { selectScopedBookmarks, toProposal, applyMinGroupSize, buildApplyPlan } from '../services/grouping/plan';
import { applyGrouping, undoLastGrouping } from '../services/grouping/apply';
import { loadUndo } from '../services/grouping/store';
import { groupingErrorMessage } from '../services/grouping/errors';
import { hostOf } from '../designs/Graph/relationSuggest';

export type GroupingStage = 'idle' | 'generating' | 'review' | 'applying' | 'complete' | 'undoing';
export interface GroupingWorkflow {
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

export function useGrouping(data: ChromeData | null, settings: Settings, refresh: () => void): GroupingWorkflow {
  const [stage, setStage] = useState<GroupingStage>('idle');
  const [proposal, setProposal] = useState<GroupProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [inputCount, setInputCount] = useState(0);
  const [result, setResult] = useState<GroupingWorkflow['result']>(null);
  const request = useRef<AbortController | null>(null);
  const mutating = useRef(false);

  useEffect(() => {
    let alive = true;
    loadUndo().then(undo => { if (alive) setCanUndo(!!undo); }).catch(() => {});
    return () => { alive = false; request.current?.abort(); };
  }, []);

  const generate = async () => {
    if (request.current || mutating.current || !data) return;
    const scoped = selectScopedBookmarks(data, settings.grouping.scope);
    const grouper = makeGrouper(settings.ai, settings.grouping);
    if (!grouper || !scoped.length) {
      setError(!grouper ? '请先配置模型服务。' : '当前范围没有需要整理的书签，可以切换到全部书签。');
      return;
    }
    const controller = new AbortController();
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
      const raw = await grouper.group(inputs, data.groups.map(group => group.label), { signal: controller.signal, maxRetries: 0 });
      if (controller.signal.aborted) return;
      const resolved = toProposal(raw, inputs.map(input => input.id), data.groups, settings.grouping.reuseExisting);
      setProposal(applyMinGroupSize(resolved, settings.grouping.minGroupSize, settings.grouping.nameLanguage === 'en' ? 'Other' : '其他'));
      setStage('review');
    } catch (failure) {
      if (request.current !== controller) return;
      if (!controller.signal.aborted || timedOut) {
        setError(timedOut ? '模型响应超时，请稍后重试或选择响应更快的模型。' : groupingErrorMessage(failure));
        setStage(proposal ? 'review' : 'idle');
      }
    } finally {
      clearTimeout(timer);
      if (request.current === controller) request.current = null;
    }
  };
  const cancel = () => {
    request.current?.abort(); request.current = null;
    setStage(proposal ? 'review' : 'idle');
    setNotice('已停止生成，书签保持原样。');
  };
  const apply = async () => {
    if (mutating.current || request.current || !proposal || !data?.barId) return;
    const plan = buildApplyPlan(proposal, data.bookmarks);
    if (!plan.moves.length) return;
    mutating.current = true; setError(null); setStage('applying');
    try {
      const summary = await applyGrouping(plan, data.barId);
      setResult(summary); setProposal(null); setCanUndo(true); setStage('complete');
      refresh();
    } catch (failure) {
      setError(groupingErrorMessage(failure)); setStage('review');
    } finally { mutating.current = false; }
  };
  const undo = async () => {
    if (mutating.current || request.current || !canUndo) return;
    mutating.current = true; setError(null); setStage('undoing');
    try {
      const undone = await undoLastGrouping();
      setCanUndo(false); setResult(null); setProposal(null); setStage('idle');
      setNotice(undone ? '已撤销上次整理，书签已恢复到原位置。' : '没有可撤销的整理记录。');
      refresh();
    } catch {
      setError('撤销未完成，请稍后重试。'); setStage(result ? 'complete' : 'idle');
    } finally { mutating.current = false; }
  };
  return {
    stage, proposal, error, notice, canUndo, inputCount, result, generate, cancel, apply, undo,
    configure: () => { setStage('idle'); setError(null); setNotice(null); },
    review: () => { if (proposal) setStage('review'); },
    change: setProposal,
  };
}
