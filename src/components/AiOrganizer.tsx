import { useEffect, useRef, useState } from 'react';
import type { ChromeData, Settings } from '../types';
import type { GroupingWorkflow } from '../hooks/useGrouping';
import { getProviderConfig } from '../data/aiProviders';
import { buildApplyPlan } from '../services/grouping/plan';
import { groupingErrorMessage } from '../services/grouping/errors';
import { AiModelSettings, AiGroupingPreferences } from './AiSettings';
import { GroupingReview } from './GroupingReview';
import { PreferenceIcon } from './PreferenceIcon';
import { Icon } from './Icon';
import './AiOrganizer.css';

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  data?: ChromeData;
  flow?: GroupingWorkflow;
  aiReady?: boolean;
  onClassify?: () => Promise<void>;
  classifying?: boolean;
}

export function AiOrganizer({ settings, onChange, data, flow, aiReady, onClassify, classifying }: Props) {
  const stage = flow?.stage ?? 'idle';
  const isWorking = stage === 'generating' || stage === 'applying' || stage === 'undoing';
  const ungrouped = data?.bookmarks.filter(bookmark => bookmark.parentId === data.barId).length ?? 0;
  const total = data?.bookmarks.length ?? 0;
  const count = settings.grouping.scope === 'all' ? total : ungrouped;
  const provider = getProviderConfig(settings.ai.provider);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const modelRef = useRef<HTMLDetailsElement>(null);
  const previousStage = useRef(stage);
  const [classifyMessage, setClassifyMessage] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [modelOpen, setModelOpen] = useState(!aiReady);
  const step = stage === 'complete' || stage === 'undoing' ? 2 : stage === 'review' || stage === 'applying' ? 1 : 0;
  const summary = flow?.proposal && data ? buildApplyPlan(flow.proposal, data.bookmarks).summary : { movedBookmarks: 0, newFolders: 0 };

  useEffect(() => {
    if (previousStage.current === stage) return;
    previousStage.current = stage;
    if (stage === 'applying') return;
    const scroller = headingRef.current?.closest('.settings-content');
    if (scroller) scroller.scrollTop = 0;
    headingRef.current?.focus({ preventScroll: true });
  }, [stage]);

  return <div className="ai-organizer">
    <header className="ai-heading">
      <PreferenceIcon name="ai" />
      <div><h2 ref={headingRef} tabIndex={-1}>智能整理</h2><p>按内容归类，先预览，再应用。</p></div>
    </header>
    <ol className="ai-steps" aria-label="整理步骤">
      {['选择范围', '调整方案', '完成整理'].map((title, index) => <li key={title} aria-current={step === index ? 'step' : undefined} data-done={step > index || undefined}>
        <span>{step > index ? <Icon name="check" size={12} /> : index + 1}</span>{title}
      </li>)}
    </ol>
    {flow?.error && <div className="ai-feedback ai-feedback--error" role="alert"><span>{flow.error}</span>
      {stage === 'idle' && <button type="button" onClick={() => { setModelOpen(true); modelRef.current?.querySelector<HTMLElement>('summary')?.focus(); }}>检查配置</button>}
    </div>}
    {flow?.notice && <p className="ai-feedback" role="status">{flow.notice}</p>}

    {stage === 'idle' && <>
      <section className="ai-scope" aria-label="选择整理范围">
        <div className="ai-section-heading"><h3>从哪些书签开始？</h3><span>{total} 个书签</span></div>
        <div className="ai-scope-options" role="group" aria-label="整理范围">
          {([{ value: 'ungrouped', label: '未分组书签', count: ungrouped, hint: '为散落的收藏找到归属' }, { value: 'all', label: '全部书签', count: total, hint: '重新梳理整个收藏空间' }] as const).map(option => (
            <button type="button" key={option.value} aria-pressed={settings.grouping.scope === option.value} onClick={() => onChange({ grouping: { ...settings.grouping, scope: option.value } })}>
              <span className="ai-scope-top"><Icon name={option.value === 'all' ? 'folder' : 'bookmark'} size={18} /><strong>{option.count}</strong><span className="ai-scope-check">{settings.grouping.scope === option.value && <Icon name="check" size={12} />}</span></span>
              <span>{option.label}</span><small>{option.hint}</small>
            </button>
          ))}
        </div>
        {!count && <p className="ai-help">{total ? '未分组书签已经整理好了。选择「全部书签」可以重新整理。' : '先添加一些书签，再让 AI 帮你整理。'}</p>}
      </section>
      <details className="ai-disclosure" ref={modelRef} open={modelOpen} onToggle={event => setModelOpen(event.currentTarget.open)}>
        <summary><Icon name="link" size={17} /><span>模型服务<small>{aiReady ? `${provider?.name ?? '自定义'} · ${settings.ai.model || '默认模型'}` : '连接模型，让 AI 了解你的收藏'}</small></span><span className="ai-config-state">{aiReady ? '已配置' : '待配置'}</span><Icon name="chevron-down" size={14} /></summary>
        <AiModelSettings settings={settings} onChange={onChange} />
      </details>
      <details className="ai-disclosure">
        <summary><Icon name="behavior" size={17} /><span>整理偏好<small>{settings.grouping.granularity === 'coarse' ? '精简分组' : settings.grouping.granularity === 'fine' ? '细致分组' : '均衡分组'} · {settings.grouping.reuseExisting ? '优先复用已有文件夹' : '创建新的文件夹'}</small></span><Icon name="chevron-down" size={14} /></summary>
        <AiGroupingPreferences settings={settings} onChange={onChange} />
      </details>
      <div className="ai-action-bar">
        <div><strong>{aiReady ? `为 ${count} 个书签生成方案` : '配置模型后即可开始'}</strong><small>确认方案后，才会移动书签</small></div>
        <div className="ai-action-buttons">
          {flow?.proposal && <button type="button" className="settings-button" onClick={flow.review}>返回预览</button>}
          <button type="button" className="settings-button settings-button--primary" disabled={!aiReady || !count || !flow || analyzing || classifying} onClick={() => void flow?.generate()}><Icon name="ai" size={16} />生成整理方案</button>
        </div>
      </div>
      <p className="ai-help">生成时会向所选模型发送书签标题、域名与分组名称。应用后可撤销上次整理。</p>
      <div className="ai-secondary">
        <div><span>只想发现书签之间的联系？</span><small>分析主题会更新连线，不移动书签。</small></div>
        <button type="button" className="ai-text-button" disabled={!aiReady || !total || analyzing || classifying || !onClassify} onClick={async () => {
          if (analyzing || !onClassify) return;
          setAnalyzing(true); setClassifyMessage(null);
          try { await onClassify(); setClassifyMessage('书签主题已更新。'); } catch (error) { setClassifyMessage(groupingErrorMessage(error)); }
          finally { setAnalyzing(false); }
        }}>{analyzing || classifying ? '分析中…' : '分析主题'}<Icon name="arrow" size={12} /></button>
      </div>
      {classifyMessage && <p className="ai-help" role="status">{classifyMessage}</p>}
      {flow?.canUndo && <button type="button" className="ai-text-button" onClick={() => void flow.undo()}>撤销上次整理</button>}
    </>}

    {stage === 'generating' && <section className="ai-progress" aria-busy="true" aria-label="正在生成整理方案">
      <div className="ai-progress-symbol"><Icon name="ai" size={35} /></div>
      <h3>正在梳理 {flow?.inputCount} 个书签</h3>
      <p>让相近的内容相聚，也为新的灵感留出位置。</p>
      <div className="ai-progress-track"><span /></div>
      <div className="ai-progress-detail"><span><Icon name="check" size={13} />已读取书签</span><span>正在分析内容与分组</span></div>
      <p className="ai-help">{provider?.name ?? '模型'}正在生成方案，书签还没有被移动。<br />可以离开此页，返回后继续查看。</p>
      <button type="button" className="settings-button" onClick={flow?.cancel}>停止生成</button>
    </section>}

    {(stage === 'review' || stage === 'applying') && flow?.proposal && <>
      <div className="ai-section-heading ai-review-heading"><div><h3>为你整理出 {flow.proposal.groups.length} 个分组</h3><p>预览每个分组，让方案更符合你的习惯。</p></div><button type="button" className="ai-text-button" disabled={isWorking} onClick={flow.configure}>修改配置</button></div>
      <fieldset className="ai-review-fieldset" disabled={isWorking}>
        <GroupingReview proposal={flow.proposal} bookmarks={data?.bookmarks ?? []} onChange={flow.change} />
      </fieldset>
      <div className="ai-action-bar">
        <div><strong>移动 {summary.movedBookmarks} 个书签</strong><small>新建 {summary.newFolders} 个文件夹 · {flow.proposal.unassigned.length} 个保留原位</small></div>
        <div className="ai-action-buttons"><button type="button" className="settings-button" disabled={isWorking} onClick={() => void flow.generate()}>重新生成</button><button type="button" className="settings-button settings-button--primary" disabled={isWorking || !summary.movedBookmarks} onClick={() => void flow.apply()}>{stage === 'applying' ? '正在应用…' : '应用整理'}</button></div>
      </div>
      {stage === 'applying' && <p className="ai-help" role="status">正在更新书签位置，请稍候…</p>}
      {!summary.movedBookmarks && <p className="ai-help">当前方案无需移动书签，可以调整分组或重新生成。</p>}
    </>}

    {(stage === 'complete' || stage === 'undoing') && <section className="ai-complete" role="status">
      <span className="ai-complete-symbol"><Icon name="check" size={30} /></span>
      <h3>{stage === 'undoing' ? '正在恢复原来的位置' : '收藏，整理好了。'}</h3>
      <p>{stage === 'undoing' ? '请稍候，正在撤销上次整理。' : `已整理 ${flow?.result?.movedBookmarks ?? 0} 个书签，新建 ${flow?.result?.newFolders ?? 0} 个文件夹。`}</p>
      <div className="ai-action-buttons"><button type="button" className="settings-button" disabled={isWorking || !flow?.canUndo} onClick={() => void flow?.undo()}>撤销本次整理</button><button type="button" className="settings-button settings-button--primary" disabled={isWorking} onClick={flow?.configure}>继续整理</button></div>
    </section>}
  </div>;
}
