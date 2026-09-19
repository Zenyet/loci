import { folderPath, INBOX_DESTINATION, type BookmarkData } from '../services/capture';
import { Select, type SelectOption } from './Select';

interface Props {
  data: BookmarkData | null;
  value: string;
  onChange: (value: string) => void;
  label: string;
  exclude?: Set<string>;
  includeInbox?: boolean;
  disabled?: boolean;
}

export function FolderSelect({ data, value, onChange, label, exclude = new Set<string>(), includeInbox = false, disabled = false }: Props) {
  const options: SelectOption[] = includeInbox ? [{ value: INBOX_DESTINATION, label: '收件箱 · 稍后整理' }] : [];
  if (data) {
    if (data.barId && !exclude.has(data.barId)) options.push({ value: data.barId, label: folderPath(data, data.barId) });
    for (const group of data.groups) {
      if (!group.readOnly && !exclude.has(group.id)) options.push({ value: group.id, label: folderPath(data, group.id) });
    }
  }
  return <Select className="folder-select-trigger" label={label} value={value} onChange={onChange}
    options={options} placeholder="选择文件夹…" disabled={disabled || !data} />;
}
