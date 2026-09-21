import { useEffect, useId, useState, type ReactNode } from 'react';
import { AI_HISTORY_LIMIT, hasUnsavedAiHistory, loadAiHistory, subscribeAiHistory, type AiHistoryRecord, type GroupingOperation, type HistoryKind } from '../services/aiHistory';
import { getProviderConfig } from '../data/aiProviders';
import { Icon } from './Icon';
import { TextInput } from './TextInput';
import './AiHistory.css';

const kindLabels: Record<HistoryKind, string> = { proposal: '生成整理方案', grouping: '应用整理', analysis: '分析连线', undo: '撤销整理' };
const statusLabels = { success: '已完成', partial: '部分完成', failed: '未完成', cancelled: '已停止' };
const outcomes = { planned: '计划移动', pending: '未执行', moved: '已移动', kept: '保留原位', failed: '移动失败', restored: '已恢复原位', 'restore-failed': '恢复失败' };
const topicOutcomes = { classified: '新分析', cached: '复用已有主题', missing: '未返回有效主题', failed: '未完成分析' };
const edgeLabels = { added: '新增', removed: '移除', kept: '保留' };
function time(value: string) { return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); }

export function AiHistory() {
  const [records, setRecords] = useState<AiHistoryRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [unsaved, setUnsaved] = useState(false);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(10);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const prefix = useId();
  useEffect(() => {
    let alive = true;
    let version = 0;
    const reload = () => {
      const run = ++version;
      void loadAiHistory().then(items => {
        if (alive && run === version) { setRecords(items); setReady(true); setError(''); setUnsaved(hasUnsavedAiHistory()); }
      }).catch(() => { if (alive && run === version) { setError('历史记录暂时无法读取，请重试。'); setReady(true); } });
    };
    const unsubscribe = subscribeAiHistory(reload); reload();
    return () => { alive = false; unsubscribe(); };
  }, [revision]);
  const search = query.trim().toLocaleLowerCase();
  const filtered = records.filter(record => (filter === 'all' || (filter === 'analysis' ? record.kind === 'analysis' : record.kind !== 'analysis')) &&
    (!search || JSON.stringify([kindLabels[record.kind], record.summary, record.model, record.scope, record.grouping, record.analysis]).toLocaleLowerCase().includes(search)));
  const reveal = (id: string) => { setFilter('all'); setQuery(''); setLimit(AI_HISTORY_LIMIT); setExpanded(id); };
  useEffect(() => {
    if (!expanded) return;
    const element = document.getElementById(`${prefix}-${expanded}`);
    element?.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
    element?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }, [expanded, prefix]);

  return <section className="ai-history" aria-label="智能整理执行历史">
    <div className="ai-section-heading"><div><h3>每一次处理，都有迹可循</h3><p className="ai-help">查看当时的分配、主题与执行结果。</p></div><span>{records.length} 条记录</span></div>
    <div className="ai-history-tools">
      <div className="ai-history-filters" role="group" aria-label="历史类型">
        {([['all', '全部'], ['grouping', '整理'], ['analysis', '分析连线']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => { setFilter(value); setLimit(10); }}>{label}</button>)}
      </div>
      <TextInput value={query} onChange={value => { setQuery(value); setLimit(10); }} aria-label="搜索执行历史" placeholder="搜索书签、分组、主题" leading={<Icon name="search" size={14} />} />
    </div>
    {unsaved && <p className="ai-feedback ai-feedback--error" role="alert">部分历史未能保存到本地，当前页面仍可查看；关闭页面后可能丢失。请检查存储空间。</p>}
    {error && <div className="ai-feedback ai-feedback--error" role="alert"><span>{error}</span><button type="button" onClick={() => setRevision(value => value + 1)}>重试</button></div>}
    {!ready ? <p className="ai-empty-inline" role="status">正在读取历史…</p> : !filtered.length && !error ? <div className="ai-history-empty"><Icon name="history" size={28} /><strong>{records.length ? '没有匹配的记录' : '还没有执行记录'}</strong><p>{records.length ? '试试其他类型或搜索词。' : '生成方案、应用整理或分析主题后，结果会自动记录在这里。'}</p></div> : null}
    <div className="ai-history-list">
      {filtered.slice(0, limit).map(record => {
        const open = expanded === record.id;
        const undone = record.kind === 'grouping' && records.some(item => item.kind === 'undo' && item.relatedId === record.id && item.status === 'success');
        const related = record.relatedId && records.find(item => item.id === record.relatedId);
        return <article className="ai-history-record" key={record.id} id={`${prefix}-${record.id}`}>
          <button type="button" className="ai-history-summary" aria-expanded={open} aria-controls={`${prefix}-${record.id}-detail`} onClick={() => setExpanded(open ? null : record.id)}>
            <span className="ai-history-symbol"><Icon name={record.kind === 'analysis' ? 'link' : record.kind === 'undo' ? 'history' : 'folder'} size={18} /></span>
            <span className="ai-history-copy"><span className="ai-history-title">{kindLabels[record.kind]}<span className="ai-history-status" data-status={record.status}>{undone ? '已撤销' : statusLabels[record.status]}</span></span><time dateTime={record.startedAt}>{time(record.startedAt)} · {record.inputCount} 个书签</time><span className="ai-history-description">{record.summary}</span></span>
            <Icon name="chevron-down" size={14} />
          </button>
          {open && <div id={`${prefix}-${record.id}-detail`} className="ai-history-detail">
            <dl className="ai-history-meta"><div><dt>执行范围</dt><dd>{record.scope}</dd></div><div><dt>模型</dt><dd>{getProviderConfig(record.provider)?.name ?? record.provider} · {record.model}</dd></div><div><dt>完成时间</dt><dd>{time(record.finishedAt)}</dd></div></dl>
            {related && <button type="button" className="ai-text-button" onClick={() => reveal(related.id)}>查看{record.kind === 'undo' ? '对应整理' : '来源方案'}<Icon name="arrow" size={12} /></button>}
            <HistoryDetail key={record.id} record={record} />
          </div>}
        </article>;
      })}
    </div>
    {filtered.length > limit && <button type="button" className="settings-button ai-history-more" onClick={() => setLimit(value => value + 10)}>查看更多记录（剩余 {filtered.length - limit} 条）</button>}
    <p className="ai-help">历史仅保存在本机，最多保留最近 {AI_HISTORY_LIMIT} 条；超过约 2 MB 时自动移除较早记录。详情保留执行时的快照，不随书签改名而变化。</p>
  </section>;
}

function HistoryDetail({ record }: { record: AiHistoryRecord }) {
  const grouping = record.grouping;
  const analysis = record.analysis;
  const names = new Map(analysis?.bookmarks.map(bookmark => [bookmark.id, bookmark.name]) ?? []);
  return <>
    {grouping && <>
      {record.kind !== 'undo' && <p className="ai-help">{({ coarse: '精简分组', balanced: '均衡分组', fine: '细致分组' })[grouping.preferences.granularity]} · 少于 {grouping.preferences.minGroupSize} 个成员合并 · {grouping.preferences.reuseExisting ? '优先复用已有文件夹' : '创建新的文件夹'}{record.kind === 'proposal' ? '。这是生成时的方案，尚未移动书签。' : '。以下是确认应用时的方案与实际执行结果。'}</p>}
      {!!grouping.folders.length && <DetailList title="分组去向" count={grouping.folders.length} render={limit => grouping.folders.slice(0, limit).map(folder => <div className="ai-history-folder" key={folder.key}><Icon name="folder" size={14} /><span>{folder.name}</span><small>{folder.reused ? '复用已有' : record.kind === 'proposal' ? '计划新建' : folder.id ? '已创建' : '未创建'}</small></div>)} />}
      <DetailList title={record.kind === 'undo' ? '恢复明细' : '书签分配'} count={grouping.assignments.length} render={limit => grouping.assignments.slice(0, limit).map(item => <div className="ai-history-item" key={item.id}><div><strong>{item.name}</strong><small>{item.host} · ID {item.id}</small></div><span className="ai-history-path">{record.kind === 'undo' ? item.to.name : item.from.name}<span aria-hidden="true"> → </span>{record.kind === 'undo' ? item.from.name : item.to.name}</span><small className="ai-history-outcome">{outcomes[item.outcome]}</small></div>)} />
    </>}
    {analysis && <>
      <p className="ai-help">本次请求分析 {analysis.requested} 个书签，复用 {analysis.reused} 个已有结果。第一个主题决定连线分组。</p>
      <DetailList title="主题分配" count={analysis.bookmarks.length} render={limit => analysis.bookmarks.slice(0, limit).map(item => <div className="ai-history-item" key={item.id}><div><strong>{item.name}</strong><small>{item.host} · ID {item.id}</small></div><span className="ai-history-path">{item.before.join(' / ') || '未分析'}<span aria-hidden="true"> → </span>{item.after.join(' / ') || '暂无主题'}</span><small className="ai-history-outcome">{topicOutcomes[item.outcome]}</small></div>)} />
      <p className="ai-help">连线依据：主主题相同的书签，连接到该主题中访问最多的书签；访问次数相同时按 ID 排序，已有手动连线不重复生成。以下为执行时全部书签的主题连线快照；图谱会按当前可见范围重新计算，不包含站点、文件夹或手动连线。</p>
      <DetailList title="主题连线" count={analysis.edges.length} empty={record.status === 'failed' ? '分析未完成，本次未计算新的连线结果。' : '没有主题连线。同一主主题至少需要两个书签，已有手动连线会跳过。'} render={limit => analysis.edges.slice(0, limit).map((edge, index) => <div className="ai-history-edge" key={index}><span className="ai-history-edge-change" data-change={edge.change}>{edgeLabels[edge.change]}</span><span><strong>{names.get(edge.from) ?? edge.from} ↔ {names.get(edge.to) ?? edge.to}</strong><small>共同主主题：{edge.topic}</small></span></div>)} />
    </>}
    {!!record.operations.length && <DetailList title="执行日志" count={record.operations.length} render={limit => record.operations.slice(0, limit).map((operation, index) => <div className="ai-history-log" key={index}><span>{String(index + 1).padStart(2, '0')}</span><span>{operationLabel(operation, record)}</span><small data-failed={operation.status === 'failed' || undefined}>{operation.status === 'success' ? '成功' : '失败'}</small></div>)} />}
  </>;
}

function DetailList({ title, count, render, empty = '没有相关明细。' }: { title: string; count: number; render: (limit: number) => ReactNode; empty?: string }) {
  const [limit, setLimit] = useState(30);
  return <section className="ai-history-section"><h4>{title}<span>{count}</span></h4>{count ? render(limit) : <p className="ai-help">{empty}</p>}{count > limit && <button type="button" className="ai-text-button" onClick={() => setLimit(value => value + 30)}>展开更多{title}（剩余 {count - limit} 条）</button>}</section>;
}

function operationLabel(operation: GroupingOperation, record: AiHistoryRecord) {
  const bookmark = record.grouping?.assignments.find(item => item.id === operation.id);
  if (operation.action === 'create-folder') return `新建文件夹「${operation.name ?? operation.id}」`;
  if (operation.action === 'remove-folder') return `移除文件夹「${record.grouping?.folders.find(folder => folder.id === operation.id)?.name ?? operation.id}」`;
  const target = operation.action === 'move' ? bookmark?.to.name : bookmark?.from.name;
  return `${operation.action === 'move' ? '移动' : operation.action === 'rollback-move' ? '回滚' : '恢复'}「${bookmark?.name ?? operation.id}」→ ${target ?? operation.parentId}`;
}
