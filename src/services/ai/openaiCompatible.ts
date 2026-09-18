import type { Classifier, ClassifyInput, ClassifyResult, ClassifyRequestOptions } from './types';
import { chatCompletionsUrl } from './endpoint';

interface Opts {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Injectable for tests. */
  fetchFn?: typeof fetch;
}

const SYSTEM =
  'You label browser bookmarks with 1-3 short lowercase semantic topic tags. ' +
  'Reply ONLY with JSON: {"items":[{"id":string,"topics":string[]}]}.';

export class OpenAICompatibleClassifier implements Classifier {
  constructor(private opts: Opts) {}

  async classify(sites: ClassifyInput[], options?: ClassifyRequestOptions): Promise<Map<string, ClassifyResult>> {
    const out = new Map<string, ClassifyResult>();
    if (sites.length === 0) return out;
    const doFetch = this.opts.fetchFn ?? fetch;
    const list = sites.map((s) => ({ id: s.id, title: s.title, host: s.host }));

    const resp = await doFetch(chatCompletionsUrl(this.opts.baseUrl), {
      method: 'POST',
      signal: options?.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.opts.apiKey}` },
      body: JSON.stringify({
        model: this.opts.model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Classify:\n${JSON.stringify(list)}` },
        ],
      }),
    });
    if (!resp.ok) throw Object.assign(new Error(`classify failed: ${resp.status}`), { status: resp.status });
    const data = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content ?? '{"items":[]}';
    const parsed = JSON.parse(content) as { items?: { id: string; topics: string[] }[] };
    for (const item of parsed.items ?? []) {
      out.set(item.id, { topics: (item.topics ?? []).slice(0, 3) });
    }
    return out;
  }
}
