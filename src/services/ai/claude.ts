import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { type Classifier, type ClassifyInput, type ClassifyResult, type ClassifyRequestOptions, DEFAULT_CLAUDE_MODEL } from './types';

const Schema = z.object({
  items: z.array(z.object({ id: z.string(), topics: z.array(z.string()) })),
});

const OUTPUT_FORMAT = zodOutputFormat(Schema);

interface ClaudeOpts {
  apiKey: string;
  model?: string;
  /** Injectable for tests. */
  createClient?: (apiKey: string) => { messages: { parse: (req: unknown, options?: ClassifyRequestOptions) => Promise<{ parsed_output: z.infer<typeof Schema> | null }> } };
}

const SYSTEM =
  'You label browser bookmarks with 1-3 short, lowercase semantic topic tags ' +
  '(e.g. "dev tools", "news", "design", "ai"). Group sites that serve a similar ' +
  'purpose under the SAME tag wording. Return one entry per input id.';

export class ClaudeClassifier implements Classifier {
  private apiKey: string;
  private model: string;
  private createClient: NonNullable<ClaudeOpts['createClient']>;

  constructor(opts: ClaudeOpts) {
    this.apiKey = opts.apiKey;
    this.model = opts.model || DEFAULT_CLAUDE_MODEL;
    this.createClient =
      opts.createClient ??
      ((apiKey) => new Anthropic({ apiKey, dangerouslyAllowBrowser: true }) as never);
  }

  async classify(sites: ClassifyInput[], options?: ClassifyRequestOptions): Promise<Map<string, ClassifyResult>> {
    const out = new Map<string, ClassifyResult>();
    if (sites.length === 0) return out;

    const client = this.createClient(this.apiKey);
    const list = sites.map((s) => ({ id: s.id, title: s.title, host: s.host }));
    const res = await client.messages.parse({
      model: this.model,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: 'user', content: `Classify these sites as JSON:\n${JSON.stringify(list)}` }],
      output_config: { format: OUTPUT_FORMAT },
    }, options);

    for (const item of res.parsed_output?.items ?? []) {
      out.set(item.id, { topics: item.topics.slice(0, 3) });
    }
    return out;
  }
}
