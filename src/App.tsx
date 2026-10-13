import { useRef, useState } from 'react';
import { useChromeData } from './hooks/useChromeData';
import { useSettings } from './hooks/useSettings';
import { Tweaks } from './components/Tweaks';
import { WidgetDashboard } from './components/widgets/WidgetDashboard';
import { Graph } from './designs/Graph/Graph';
import { copy } from './i18n';
import { makeClassifier } from './services/ai';
import { analyzeTopics } from './services/ai/analyze';
import { useGrouping } from './hooks/useGrouping';
import './styles/tokens.css';
import './styles/shell.css';

export default function App() {
  const { settings, resolvedTheme, update, ready } = useSettings();
  const { data, loading, error, refresh } = useChromeData();
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [widgetEditRequest, setWidgetEditRequest] = useState(0);
  const [widgetEditing, setWidgetEditing] = useState(false);
  const [requestedSection, setRequestedSection] = useState<{ section: 'widgets' | 'ai'; revision: number }>();
  const [classifying, setClassifying] = useState(false);
  const classifyPending = useRef(false);
  const [topicsVersion, setTopicsVersion] = useState(0);

  const runClassify = async (): Promise<string | void> => {
    const classifier = makeClassifier(settings.ai);
    if (!classifier || classifyPending.current) return;
    classifyPending.current = true;
    setClassifying(true);
    try {
      const summary = await analyzeTopics(data?.bookmarks ?? [], settings.ai, classifier);
      setTopicsVersion((v) => v + 1);
      return summary;
    } finally {
      setClassifying(false);
      classifyPending.current = false;
    }
  };

  const groupingFlow = useGrouping(data, settings, refresh);

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
      <div className="stage" ref={element => { if (element) element.inert = tweaksOpen; }}>
        {data ? <Graph data={data} settings={settings} resolvedTheme={resolvedTheme} topicsVersion={topicsVersion} interactionBlocked={tweaksOpen || widgetEditing} />
          : <ExtensionState title="无法读取 Chrome 书签" body={error ?? '请刷新新标签页，或确认扩展权限仍然开启。'} actionLabel="重试" onAction={refresh} />}
      </div>
      <WidgetDashboard editRequest={widgetEditRequest} chromeData={data ?? undefined} settings={settings.widgets} onChange={widgets => update({ widgets })}
        blocked={tweaksOpen} onEditingChange={setWidgetEditing}
        onConfigure={() => { setRequestedSection({ section: 'widgets', revision: Date.now() }); setTweaksOpen(true); }} />
      <Tweaks
        onArrangeWidgets={() => { setTweaksOpen(false); setWidgetEditRequest(value => value + 1); }}
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
