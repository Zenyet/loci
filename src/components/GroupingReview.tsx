import { useMemo, useState } from 'react';
import type { Bookmark, GroupProposal } from '../types';
import { InlineEdit } from './InlineEdit';
import { FolderIcon } from './FolderIcon';
import { Icon } from './Icon';
import { Select } from './Select';
import { TextInput } from './TextInput';
import { moveMember, renameGroup, deleteGroup } from '../services/grouping/plan';
import { hostOf } from '../designs/Graph/relationSuggest';

interface Props { proposal: GroupProposal; bookmarks: Bookmark[]; onChange: (next: GroupProposal) => void }

/** An editable draft inside Settings. Nothing is written until Apply. */
export function GroupingReview({ proposal, bookmarks, onChange }: Props) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const byId = useMemo(() => new Map(bookmarks.map(bookmark => [bookmark.id, bookmark])), [bookmarks]);
  const filter = query.trim().toLowerCase();
  const matches = (id: string) => {
    const bookmark = byId.get(id);
    return !filter || `${bookmark?.name} ${bookmark?.url}`.toLowerCase().includes(filter);
  };
  const groups = proposal.groups.filter(group => !filter || group.name.toLowerCase().includes(filter) || group.memberIds.some(matches));
  const targets = proposal.groups.map(group => ({ value: group.key, label: group.name }));
  const toggle = (key: string) => setExpanded(current => {
    const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next;
  });
  const memberList = (ids: string[], key: string | null) => <div className="ai-members">
    {ids.map(id => {
      const bookmark = byId.get(id);
      return <div className="ai-member" key={id}>
        <span className="ai-member-mark"><Icon name="bookmark" size={15} /></span>
        <span className="ai-member-copy"><span>{bookmark?.name ?? '书签已移除'}</span><small>{bookmark ? hostOf(bookmark.url) : ''}</small></span>
        <Select label={`移动 ${bookmark?.name ?? id}`} value={key ?? '__keep__'}
          options={[...targets, { value: '__keep__', label: '保留原位' }]}
          onChange={value => onChange(moveMember(proposal, id, value === '__keep__' ? null : value))} />
      </div>;
    })}
    {!ids.length && <p className="ai-empty-inline">将书签移到这里，创建你自己的分组。</p>}
  </div>;
  return <div className="ai-review">
    <div className="ai-review-tools">
      <TextInput aria-label="查找方案中的分组或书签" placeholder="查找分组或书签" value={query} onChange={setQuery} />
      <button type="button" className="settings-button" onClick={() => {
        const key = `manual-${crypto.randomUUID()}`;
        onChange({ ...proposal, groups: [...proposal.groups, { key, name: '新分组', memberIds: [] }] });
        setQuery(''); setEditingKey(key); setExpanded(current => new Set([...current, key]));
      }}><Icon name="plus" size={14} />添加分组</button>
    </div>
    <div className="ai-proposal-list">
      {groups.map((group, index) => {
        const isOpen = expanded.has(group.key) || !!filter || editingKey === group.key;
        const visibleIds = filter && !group.name.toLowerCase().includes(filter) ? group.memberIds.filter(matches) : group.memberIds;
        return <section className="ai-proposal-group" key={group.key}>
          <div className="ai-proposal-head">
            <FolderIcon hue={150 + (index * 53) % 230} size={36} />
            {editingKey === group.key ? <div className="ai-proposal-name">
              <InlineEdit value={group.name} onSubmit={name => { onChange(renameGroup(proposal, group.key, name)); setEditingKey(null); }} onCancel={() => setEditingKey(null)} />
            </div> : <button type="button" className="ai-proposal-title" aria-expanded={isOpen} onClick={() => toggle(group.key)}>
              <span>{group.name}<small>{group.memberIds.length}</small></span>
              <small>{isOpen ? group.existingFolderId ? '归入已有文件夹' : '创建新文件夹' : group.memberIds.slice(0, 3).map(id => byId.get(id)?.name ?? id).join(' · ') || '空分组'}</small>
            </button>}
            <span className="ai-folder-kind">{group.existingFolderId ? '已有' : '新建'}</span>
            <div className="ai-proposal-actions">
              <button type="button" aria-label={`重命名 ${group.name}`} onClick={() => setEditingKey(group.key)}><Icon name="edit" size={15} /></button>
              <button type="button" aria-label={`移除分组 ${group.name}`} title="移除建议分组，书签保留原位" onClick={() => onChange(deleteGroup(proposal, group.key))}><Icon name="close" size={15} /></button>
            </div>
          </div>
          {isOpen && memberList(visibleIds, group.key)}
        </section>;
      })}
      {proposal.unassigned.length > 0 && <section className="ai-proposal-group ai-proposal-group--kept">
        <div className="ai-proposal-head"><span className="ai-keep-icon"><Icon name="bookmark" size={20} /></span>
          <button type="button" className="ai-proposal-title" aria-expanded={expanded.has('__keep__') || !!filter} onClick={() => toggle('__keep__')}><span>保留原位<small>{proposal.unassigned.length}</small></span><small>这些书签不会被移动，也可以手动选择分组</small></button>
        </div>
        {(expanded.has('__keep__') || !!filter) && memberList(proposal.unassigned.filter(matches), null)}
      </section>}
      {!groups.length && !proposal.unassigned.length && <p className="ai-empty-inline">{filter ? '没有找到匹配的分组或书签。' : '还没有建议分组，可以添加分组或重新生成。'}</p>}
    </div>
    <p className="ai-help">点击分组展开书签；可重命名、调整归属，或移除建议分组。</p>
  </div>;
}
