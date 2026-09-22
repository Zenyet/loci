import type { WidgetToolId } from '../../types';
import type { IconName } from '../Icon';

export const WIDGET_CATALOG: Record<WidgetToolId | 'clock', { title: string; description: string; icon: IconName; category: string }> = {
  clock: { title: '时间与天气', description: '时间、日期和窗外的天气，收在一张小卡片里', icon: 'clock', category: '日常' },
  todos: { title: '今日待办', description: '记下接下来要做的几件小事', icon: 'todo', category: '效率 · 本地' },
  market: { title: '市场速览', description: '上证、深证、创业板与自己的关注列表', icon: 'market', category: '市场 · 需连接数据源' },
  notes: { title: '便签', description: '随手记一句，把下一步行动转为待办', icon: 'edit', category: '效率 · 本地' },
  focus: { title: '专注计时', description: '一次只做一件事，按自己的节奏开始', icon: 'focus', category: '效率 · 本地' },
  revisit: { title: '收藏回访', description: '从收藏里重新发现一条值得阅读的内容', icon: 'bookmark', category: '收藏 · 本地' },
};
