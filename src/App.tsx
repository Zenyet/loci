import { useState } from 'react';
import { useChromeData } from './hooks/useChromeData';
import { useSettings } from './hooks/useSettings';
import { Tweaks } from './components/Tweaks';
import { WidgetDashboard } from './components/widgets/WidgetDashboard';
import { Graph } from './designs/Graph/Graph';
import { copy } from './i18n';
import { makeClassifier } from './services/ai';
import { loadTopicCache, saveTopicCache, sitesNeedingClassify, cacheKey } from './services/topicCache';
import { hostOf } from './designs/Graph/relationSuggest';
import { useGrouping } from './hooks/useGrouping';
import { useInbox } from './hooks/useInbox';
import { InboxPanel } from './components/InboxPanel';
import './styles/tokens.css';
import './styles/shell.css';

export default function App() {
  const { settings, resolvedTheme, update, ready } = useSettings();
  const { data, loading, error, refresh } = useChromeData();
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [widgetPanelOpen, setWidgetPanelOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(() => new URLSearchParams(window.location.search).get('view') === 'inbox');
  const [requestedSection, setRequestedSection] = useState<{ section: 'widgets' | 'ai'; revision: number }>();
  const [classifying, setClassifying] = useState(false);
  const [topicsVersion, setTopicsVersion] = useState(0);

  const runClassify = async (): Promise<void> => {
    const classifier = makeClassifier(settings.ai);
    if (!classifier) return;
    setClassifying(true);
    try {
      const cache = await loadTopicCache();
      const sites = (data?.bookmarks ?? []).map((b) => ({ id: b.id, title: b.name, url: b.url }));
      const need = sitesNeedingClassify(sites, cache);
      if (need.length) {
        const inputs = need.map((s) => ({ id: s.id, title: s.title, host: hostOf(s.url) ?? s.url }));
        const result = await classifier.classify(inputs);
        const now = new Date().toISOString();
        for (const s of need) {
          const r = result.get(s.id);
          if (r) cache[cacheKey(s)] = { topics: r.topics, at: now };
        }
        await saveTopicCache(cache);
      }
      setTopicsVersion((v) => v + 1);
    } finally {
      setClassifying(false);
    }
  };

  const inbox = useInbox(data);
  const groupingFlow = useGrouping(data, settings, refresh, inbox.folder?.id ?? null);

  const aiReady =
    settings.ai.provider !== 'off' &&
    !!settings.ai.apiKey &&
    (settings.ai.provider === 'anthropic' ||
      (!!settings.ai.baseUrl && !!settings.ai.model));

  if (!ready || (loading && !data)) {
    return (
      <div className="shell">
        <ExtensionState title={copy.loading} />
      </div>
    );
  }

  return (
    <div className="shell">
      <div className="stage" ref={element => { if (element) element.inert = tweaksOpen || inboxOpen; }}>
        {data ? <Graph data={data} settings={settings} resolvedTheme={resolvedTheme} topicsVersion={topicsVersion} interactionBlocked={tweaksOpen || widgetPanelOpen || inboxOpen}
          inboxCount={inbox.bookmarks.length} onOpenInbox={() => setInboxOpen(true)} />
          : <ExtensionState title="无法读取 Chrome 书签" body={error ?? '请刷新新标签页，或确认扩展权限仍然开启。'} actionLabel="重试" onAction={refresh} />}
      </div>
      <WidgetDashboard settings={settings.widgets} onChange={widgets => update({ widgets })}
        blocked={tweaksOpen || inboxOpen} onPanelChange={setWidgetPanelOpen}
        onConfigure={() => { setRequestedSection({ section: 'widgets', revision: Date.now() }); setTweaksOpen(true); }} />
      <Tweaks
        settings={settings}
        onChange={update}
        open={tweaksOpen}
        requestedSection={requestedSection}
        onToggle={() => setTweaksOpen((v) => !v)}
        onClassify={runClassify}
        classifying={classifying}
        aiReady={aiReady}
        data={data ?? undefined}
        groupingFlow={groupingFlow}
      />
      {data && <InboxPanel open={inboxOpen} data={data} folder={inbox.folder} bookmarks={inbox.bookmarks}
        ready={inbox.ready} error={inbox.error} settings={settings} organizing={['generating', 'applying', 'undoing'].includes(groupingFlow.stage)}
        onClose={() => setInboxOpen(false)} onRefresh={refresh} onOrganize={selection => {
          if (!groupingFlow.select?.(selection)) return;
          setInboxOpen(false); setRequestedSection({ section: 'ai', revision: Date.now() }); setTweaksOpen(true);
        }} />}
    </div>
  );
}

function ExtensionState({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="extension-state">
      <div className="extension-state__mark" aria-hidden>
        BG
      </div>
      <h1>{title}</h1>
      {body && <p>{body}</p>}
      {actionLabel && onAction && (
        <button type="button" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
