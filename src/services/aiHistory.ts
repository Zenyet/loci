import type { AiSettings, Bookmark, ChromeData, GroupingConfig, GroupProposal } from '../types';
import { DEFAULT_CLAUDE_MODEL } from './ai/types';
import { hostOf } from '../designs/Graph/relationSuggest';
import { readLocal, subscribeLocal, withLocalLock, writeLocal } from './localStore';

export const AI_HISTORY_KEY = 'newtab-ai-history';
export const AI_HISTORY_LIMIT = 50;
const MAX_HISTORY_BYTES = 2_000_000;
export type HistoryStatus = 'success' | 'partial' | 'failed' | 'cancelled';
export type HistoryKind = 'proposal' | 'grouping' | 'analysis' | 'undo';
export interface HistoryBookmark { id: string; name: string; host: string }
export interface HistoryFolder { id?: string; name: string }
export interface HistoryAssignment extends HistoryBookmark {
  from: HistoryFolder;
  to: HistoryFolder;
  outcome: 'planned' | 'pending' | 'moved' | 'kept' | 'failed' | 'restored' | 'restore-failed';
}
export interface GroupingOperation {
  action: 'create-folder' | 'move' | 'rollback-move' | 'remove-folder' | 'undo-move';
  status: 'success' | 'failed';
  id: string;
  name?: string;
  parentId?: string;
}
export interface HistoryAnalysis {
  requested: number;
  reused: number;
  bookmarks: (HistoryBookmark & { before: string[]; after: string[]; outcome: 'classified' | 'cached' | 'missing' | 'failed' })[];
  /** Global bookmark snapshot; the visible graph recalculates hubs within its current scope. */
  edges: { from: string; to: string; topic: string; change: 'added' | 'removed' | 'kept' }[];
}
export interface AiHistoryRecord {
  version: 1;
  id: string;
  kind: HistoryKind;
  status: HistoryStatus;
  startedAt: string;
  finishedAt: string;
  provider: string;
  model: string;
  scope: string;
  inputCount: number;
  summary: string;
  relatedId?: string;
  grouping?: { preferences: GroupingConfig; assignments: HistoryAssignment[]; folders: (HistoryFolder & { key: string; reused: boolean })[] };
  analysis?: HistoryAnalysis;
  operations: GroupingOperation[];
}

// Keep failed writes visible for the current page, and retry them with the next write.
const pending = new Map<string, AiHistoryRecord>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
export function hasUnsavedAiHistory() { return pending.size > 0; }
export function subscribeAiHistory(listener: () => void) {
  listeners.add(listener);
  const unsubscribe = subscribeLocal(AI_HISTORY_KEY, listener);
  return () => { listeners.delete(listener); unsubscribe(); };
}

export async function loadAiHistory(): Promise<AiHistoryRecord[]> {
  const stored = await readLocal<{ version: number; records: AiHistoryRecord[] }>(AI_HISTORY_KEY);
  const records = stored?.version === 1 && Array.isArray(stored.records) ? stored.records.filter(record =>
    record?.version === 1 && typeof record.id === 'string' && typeof record.startedAt === 'string' &&
    ['proposal', 'grouping', 'analysis', 'undo'].includes(record.kind) && Array.isArray(record.operations)) : [];
  return [...new Map([...records, ...pending.values()].map(record => [record.id, record])).values()]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.finishedAt.localeCompare(a.finishedAt));
}

/** A history failure must never turn a completed bookmark mutation into a retry. */
export async function saveAiHistory(record: AiHistoryRecord): Promise<void> {
  pending.set(record.id, structuredClone(record));
  try {
    await withLocalLock('ai-history', async () => {
      const snapshot = await loadAiHistory();
      const records = snapshot.slice(0, AI_HISTORY_LIMIT);
      while (records.length > 1 && new Blob([JSON.stringify(records)]).size > MAX_HISTORY_BYTES) records.pop();
      await writeLocal(AI_HISTORY_KEY, { version: 1, records });
      // Include entries evicted by retention, but preserve writes queued after this snapshot.
      for (const entry of snapshot) if (pending.get(entry.id) === entry) pending.delete(entry.id);
    });
  } catch { /* Current-page history and an explicit warning remain available. */ }
  notify();
}

export function startAiHistory(kind: HistoryKind, ai: AiSettings, scope: string, inputCount: number) {
  const record: AiHistoryRecord = {
    version: 1, id: crypto.randomUUID(), kind, status: 'success', startedAt: new Date().toISOString(), finishedAt: '',
    provider: ai.provider, model: ai.model || (ai.provider === 'anthropic' ? DEFAULT_CLAUDE_MODEL : '默认模型'),
    scope, inputCount, summary: '', operations: [],
  };
  let finished = false;
  return {
    record,
    finish: async (status: HistoryStatus, summary: string) => {
      if (finished) return;
      finished = true;
      record.status = status; record.summary = summary; record.finishedAt = new Date().toISOString();
      await saveAiHistory(record);
    },
  };
}

export function snapshotBookmark(bookmark: Bookmark): HistoryBookmark {
  return { id: bookmark.id, name: bookmark.name, host: hostOf(bookmark.url) ?? '' };
}

type HistoryData = Pick<ChromeData, 'bookmarks' | 'groups' | 'barId' | 'roots'>;

export function folderSnapshot(data: HistoryData, id: string): HistoryFolder {
  const parts: string[] = [];
  const seen = new Set<string>();
  let current: string | null = id;
  while (current && !seen.has(current)) {
    seen.add(current);
    const group = data.groups.find(item => item.id === current);
    if (!group) { parts.unshift(data.roots?.find(root => root.id === current)?.label ?? (current === data.barId ? '书签栏' : `文件夹 ${current}`)); break; }
    parts.unshift(group.label); current = group.parentGroupId;
  }
  return { id, name: parts.join(' / ') };
}

export function snapshotGrouping(proposal: GroupProposal, bookmarks: Bookmark[], data: HistoryData, preferences: GroupingConfig, applied: boolean): NonNullable<AiHistoryRecord['grouping']> {
  const groupByMember = new Map(proposal.groups.flatMap(group => group.memberIds.map(id => [id, group] as const)));
  const included = new Set([...groupByMember.keys(), ...proposal.unassigned]);
  return {
    preferences: { ...preferences },
    folders: proposal.groups.filter(group => group.memberIds.length).map(group => ({
      key: group.key, id: group.existingFolderId, name: group.existingFolderId ? folderSnapshot(data, group.existingFolderId).name : `${folderSnapshot(data, data.barId ?? '').name} / ${group.name}`, reused: !!group.existingFolderId,
    })),
    assignments: bookmarks.filter(bookmark => included.has(bookmark.id)).map(bookmark => {
      const group = groupByMember.get(bookmark.id);
      const from = folderSnapshot(data, bookmark.parentId);
      return {
        ...snapshotBookmark(bookmark), from,
        to: group ? group.existingFolderId ? folderSnapshot(data, group.existingFolderId) : { name: `${folderSnapshot(data, data.barId ?? '').name} / ${group.name}` } : { ...from },
        outcome: !group || group.existingFolderId === bookmark.parentId ? 'kept' : applied ? 'pending' : 'planned',
      };
    }),
  };
}

export function recordGroupingOperation(record: AiHistoryRecord, operation: GroupingOperation) {
  record.operations.push({ ...operation });
  const assignment = record.grouping?.assignments.find(item => item.id === operation.id);
  if (assignment && operation.action === 'move') {
    assignment.outcome = operation.status === 'success' ? 'moved' : 'failed';
    if (operation.status === 'success') assignment.to.id = operation.parentId;
  }
  if (assignment && (operation.action === 'rollback-move' || operation.action === 'undo-move')) {
    assignment.outcome = operation.status === 'success' ? 'restored' : 'restore-failed';
  }
  if (operation.action === 'create-folder' && operation.status === 'success') {
    const folder = record.grouping?.folders.find(item => item.key === operation.id);
    if (folder) folder.id = operation.parentId;
  }
}
