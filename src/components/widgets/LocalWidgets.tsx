import { useMemo, useState } from 'react';
import type { ChromeData, WidgetSettings } from '../../types';
import type { useNotes } from '../../hooks/useNotes';
import type { useFocus } from '../../hooks/useFocus';
import type { useTodos } from '../../hooks/useTodos';
import { useWidgetRecord } from '../../hooks/useWidgetRecord';
import { dailyBookmarkIndex, revisitBookmarks } from '../../services/revisit';
import { focusLabel, focusRemaining } from '../../services/focus';
import { GroupSelect } from '../GroupSelect';
import { Select } from '../Select';
import { TextArea, TextInput } from '../TextInput';
import { Icon } from '../Icon';

export function NotesWidget({ notes, todos }: { notes: ReturnType<typeof useNotes>; todos: ReturnType<typeof useTodos> }) {
  const [message, setMessage] = useState('');
  const [selection, setSelection] = useState('');
  const candidate = selection.trim() || notes.text.split('\n').find(line => line.trim())?.trim() || '';
  return <div className="notes-widget">
    <h2>留住这一刻的想法</h2>
    <TextArea aria-label="便签内容" placeholder="随手记一句…" value={notes.text} maxLength={5000} disabled={!notes.ready} onChange={value => { notes.edit(value); setMessage(''); setSelection(''); }} onSelect={event => { const el = event.currentTarget; setSelection(el.value.slice(el.selectionStart, el.selectionEnd)); }} />
    <div className="widget-actions"><button type="button" className="widget-primary" disabled={!candidate || !todos.ready || todos.pending} onClick={async () => {
      if (candidate.length > 500) { setMessage('待办最多 500 字，请选择一段更短的内容。'); return; }
      if (todos.todos.some(todo => !todo.done && todo.text === candidate)) { setMessage('这条内容已经在待办中。'); return; }
      if (await todos.add(candidate)) setMessage('已加入今日待办，便签原文已保留。');
    }}>{selection.trim() ? '选中内容转为待办' : '首行转为待办'}</button><button type="button" className="widget-text-button" disabled={!notes.text} onClick={async () => {
      try { await navigator.clipboard.writeText(notes.text); setMessage('已复制便签。'); } catch { setMessage('复制失败，请选中文字后复制。'); }
    }}>复制</button></div>
    <div className="todo-footer"><small role="status">{notes.error ? '尚未保存' : !notes.ready ? '读取中…' : notes.saving ? '保存中…' : '已保存到本机'}</small><small>{notes.text.length} / 5000</small></div>
    {notes.error && <p className="widget-error" role="alert">{notes.error}<button type="button" className="widget-text-button" onClick={() => void notes.retry()}>重试保存</button></p>}
    {todos.error && <p className="widget-error" role="alert">{todos.error}</p>}
    {message && <p className="widget-note" role="status">{message}</p>}
  </div>;
}
export function FocusWidget({ focus, todos, minutes, onMinutes }: { focus: ReturnType<typeof useFocus>; todos: ReturnType<typeof useTodos>; minutes: number; onMinutes: (minutes: number) => void }) {
  const [duration, setDuration] = useState(String(minutes));
  const [message, setMessage] = useState('');
  const remaining = focusRemaining(focus.value, focus.now);
  const running = !!focus.value.endAt && remaining > 0;
  const task = todos.todos.find(todo => todo.id === focus.value.taskId);
  const editable = focus.ready && !focus.pending;
  return <div className="focus-widget">
    <div className="widget-segment" role="group" aria-label="计时模式">{(['focus', 'break'] as const).map(mode => <button type="button" key={mode} aria-pressed={focus.value.mode === mode} disabled={!editable || running} onClick={() => void focus.reset(minutes, mode)}>{mode === 'focus' ? `专注 ${minutes} 分钟` : '休息 5 分钟'}</button>)}</div>
    <div className="focus-time" aria-label={`剩余 ${focusLabel(focus.value, focus.now)}`}>{focusLabel(focus.value, focus.now)}</div>
    <p className="widget-note" role="status">{remaining === 0 ? '这一轮已结束，休息一下吧。' : running ? '给眼前这件事一点完整的时间。' : '准备好了，就从这一刻开始。'}</p>
    <Select label="关联待办" value={task ? task.id : ''} disabled={!editable || running || !todos.ready} onChange={taskId => void focus.update(value => ({ ...value, taskId }))} options={[{ value: '', label: '不关联待办' }, ...todos.todos.filter(todo => !todo.done || todo.id === task?.id).map(todo => ({ value: todo.id, label: `${todo.done ? '已完成 · ' : ''}${todo.text}` }))]} />
    <div className="widget-actions"><button type="button" className="widget-primary" disabled={!editable} onClick={() => void focus.toggle(minutes)}>{running ? '暂停' : remaining === 0 ? '再来一轮' : remaining < focus.value.duration ? '继续' : '开始'}</button><button type="button" className="widget-text-button" disabled={!editable} onClick={() => void focus.reset(minutes)}>重新计时</button>{remaining === 0 && task && !task.done && <button type="button" className="widget-text-button" disabled={todos.pending} onClick={() => void todos.toggle(task.id)}>完成关联待办</button>}</div>
    <form className="focus-duration" onSubmit={event => { event.preventDefault(); const next = Number(duration); if (!Number.isInteger(next) || next < 1 || next > 180) { setMessage('请输入 1–180 的整数分钟。'); return; } onMinutes(next); void focus.reset(next); setMessage('已更新专注时长。'); }}>
      <label htmlFor="widget-focus-minutes">自定义专注时长</label><TextInput id="widget-focus-minutes" aria-label="专注分钟数" type="number" min={1} max={180} step={1} value={duration} onChange={setDuration} disabled={!editable || running} /><span>分钟</span><button type="submit" className="widget-text-button" disabled={!editable || running}>应用</button>
    </form>
    <p className="widget-note">刷新后按结束时间恢复。关闭全部新标签页后不发送系统提醒。</p>
    {(focus.error || todos.error) && <p className="widget-error" role="alert">{focus.error || todos.error}</p>}{message && <p className="widget-note" role="status">{message}</p>}
  </div>;
}
const normalizeSkipped = (raw: unknown): { date: string; ids: string[] } => {
  const data = raw as { date?: unknown; ids?: unknown } | null;
  return { date: typeof data?.date === 'string' ? data.date : '', ids: Array.isArray(data?.ids) ? data.ids.filter((id): id is string => typeof id === 'string').slice(-1000) : [] };
};
export function RevisitWidget({ data, config, onChange, now }: { data?: ChromeData; config: WidgetSettings['revisit']; onChange: (folderId: string) => void; now: Date }) {
  const [offset, setOffset] = useState(0);
  const skipped = useWidgetRecord('loci-revisit-skipped-v1', normalizeSkipped);
  const date = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  const candidates = useMemo(() => revisitBookmarks(data?.bookmarks ?? [], data?.groups ?? [], config.folderId).filter(item => skipped.value.date !== date || !skipped.value.ids.includes(item.id)), [data, config.folderId, skipped.value, date]);
  const bookmark = candidates[(dailyBookmarkIndex(now, candidates.length) + offset) % candidates.length];
  const missingFolder = !!config.folderId && !data?.groups.some(group => group.id === config.folderId);
  return <div className="revisit-widget">
    <div className="revisit-source"><span className="widget-note">回访范围</span><button type="button" className="widget-text-button" aria-pressed={!config.folderId} onClick={() => { onChange(''); setOffset(0); }}>所有收藏</button></div>
    <GroupSelect value={config.folderId} groups={data?.groups ?? []} label="回访文件夹" placeholder="选择一个文件夹" onChange={folderId => { onChange(folderId); setOffset(0); }} />
    {missingFolder && <p className="widget-error" role="status">原文件夹已不可用，请重新选择或使用所有收藏。</p>}
    {bookmark && skipped.ready ? <article className="revisit-story"><span className="widget-eyebrow">今日回访 · {candidates.length} 条可选</span><h2>{bookmark.name || new URL(bookmark.url).hostname}</h2><p>{new URL(bookmark.url).hostname}</p><div className="widget-actions"><a className="widget-primary" href={bookmark.url} target="_blank" rel="noreferrer">打开收藏 <Icon name="external" size={13} /></a><button type="button" className="widget-text-button" disabled={candidates.length < 2} onClick={() => setOffset(value => value + 1)}>换一条</button><button type="button" className="widget-text-button" disabled={skipped.pending} onClick={() => void skipped.update(value => ({ date, ids: [...(value.date === date ? value.ids : []), bookmark.id] }))}>今天不再显示</button></div></article>
      : <div className="widget-empty"><Icon name="bookmark" size={32} /><p>{!data || !skipped.ready ? '正在读取收藏…' : '这个范围暂时没有可回访的收藏。'}</p></div>}
    <p className="widget-note">包含文件夹里的子文件夹。每日换一条，只在本机挑选；不会改动原书签。</p>
    {skipped.error && <p className="widget-error" role="alert">{skipped.error}</p>}
  </div>;
}
