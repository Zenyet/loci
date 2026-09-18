import { useState } from 'react';
import { useChromeData } from './hooks/useChromeData';
import { useSettings } from './hooks/useSettings';
import { Tweaks } from './components/Tweaks';
import { Graph } from './designs/Graph/Graph';
import { copy } from './i18n';
import { makeClassifier } from './services/ai';
import { loadTopicCache, saveTopicCache, sitesNeedingClassify, cacheKey } from './services/topicCache';
import { hostOf } from './designs/Graph/relationSuggest';
import { useGrouping } from './hooks/useGrouping';
import './styles/tokens.css';
import './styles/shell.css';

export default function App() {
  const { settings, resolvedTheme, update, ready } = useSettings();
  const { data, loading, error, refresh } = useChromeData();
  const [tweaksOpen, setTweaksOpen] = useState(false);
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

  if (!data) {
    return (
      <div className="shell">
        <ExtensionState
          title="无法读取 Chrome 书签"
          body={error ?? '扩展数据尚未准备好。请刷新新标签页，或确认扩展权限仍然开启。'}
          actionLabel="重试"
          onAction={refresh}
        />
      </div>
    );
  }

  const emptyChrome =
    data.source === 'chrome' && data.bookmarks.length === 0 && data.groups.length === 0;
  if (emptyChrome) {
    return (
      <div className="shell">
        <ExtensionState
          title="还没有可显示的书签"
          body="在 Chrome 书签栏添加书签或文件夹后，它们会自动出现在这张图里。"
          actionLabel="重新读取"
          onAction={refresh}
        />
        <Tweaks
          settings={settings}
          onChange={update}
          open={tweaksOpen}
          onToggle={() => setTweaksOpen((v) => !v)}
          onClassify={runClassify}
          classifying={classifying}
          aiReady={aiReady}
          data={data}
          groupingFlow={groupingFlow}
        />
      </div>
    );
  }

  return (
    <div className="shell">
      <div className="stage" ref={element => { if (element) element.inert = tweaksOpen; }}>
        <Graph data={data} settings={settings} resolvedTheme={resolvedTheme} topicsVersion={topicsVersion} interactionBlocked={tweaksOpen} />
      </div>
      <Tweaks
        settings={settings}
        onChange={update}
        open={tweaksOpen}
        onToggle={() => setTweaksOpen((v) => !v)}
        onClassify={runClassify}
        classifying={classifying}
        aiReady={aiReady}
        data={data}
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
