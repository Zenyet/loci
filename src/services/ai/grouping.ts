import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { AiSettings, GroupingConfig } from '../../types';
import { DEFAULT_CLAUDE_MODEL, type ClassifyRequestOptions } from './types';
import { GroupingError, httpErrorKind } from '../grouping/errors';
import { chatCompletionsUrl } from './endpoint';

export interface GroupInput { id: string; title: string; host: string; currentGroup?: string }
export interface RawProposal { groups: { name: string; memberIds: string[] }[]; unassigned: string[] }

export interface Grouper {
  group(inputs: GroupInput[], existingGroups: string[], options?: ClassifyRequestOptions): Promise<RawProposal>;
}

const Schema = z.object({
  groups: z.array(z.object({ name: z.string(), memberIds: z.array(z.string()) })),
  unassigned: z.array(z.string()),
});
const OUTPUT_FORMAT = zodOutputFormat(Schema);

const GRANULARITY_HINT: Record<GroupingConfig['granularity'], string> = {
  coarse: 'Prefer FEWER, broader groups (roughly 3-6).',
  balanced: 'Aim for a balanced number of groups (roughly 6-12).',
  fine: 'Prefer MORE, finer-grained groups (roughly 12-20).',
};
const LANG_HINT: Record<GroupingConfig['nameLanguage'], string> = {
  auto: 'Name groups in the dominant language of the bookmark titles.',
  zh: 'Name every group in 中文.',
  en: 'Name every group in English.',
};

export function groupingSystemPrompt(config: GroupingConfig): string {
  return [
    'You organize browser bookmarks into a small set of purpose-based groups.',
    GRANULARITY_HINT[config.granularity],
    LANG_HINT[config.nameLanguage],
    `Each group needs a short, human-readable name and the list of member ids that belong to it.`,
    'Reuse an existing group name verbatim when a bookmark clearly fits it.',
    'Put ids that fit no clear group into "unassigned". Assign every id exactly once.',
  ].join(' ');
}

interface ClaudeOpts {
  apiKey: string;
  model?: string;
  config: GroupingConfig;
  createClient?: (apiKey: string) => { messages: { parse: (req: unknown, options?: ClassifyRequestOptions) => Promise<{ parsed_output: z.infer<typeof Schema> | null }> } };
}

export class ClaudeGrouper implements Grouper {
  private apiKey: string;
  private model: string;
  private config: GroupingConfig;
  private createClient: NonNullable<ClaudeOpts['createClient']>;

  constructor(opts: ClaudeOpts) {
    this.apiKey = opts.apiKey;
    this.model = opts.model || DEFAULT_CLAUDE_MODEL;
    this.config = opts.config;
    this.createClient =
      opts.createClient ?? ((apiKey) => new Anthropic({ apiKey, dangerouslyAllowBrowser: true }) as never);
  }

  async group(inputs: GroupInput[], existingGroups: string[], options?: ClassifyRequestOptions): Promise<RawProposal> {
    if (inputs.length === 0) return { groups: [], unassigned: [] };
    const client = this.createClient(this.apiKey);
    const list = inputs.map((s) => ({ id: s.id, title: s.title, host: s.host, group: s.currentGroup }));
    const user =
      `Existing groups (reuse when fitting): ${JSON.stringify(existingGroups)}\n` +
      `Bookmarks to group as JSON:\n${JSON.stringify(list)}`;
    try {
      const res = await client.messages.parse({
        model: this.model,
        max_tokens: 16000,
        system: groupingSystemPrompt(this.config),
        messages: [{ role: 'user', content: user }],
        output_config: { format: OUTPUT_FORMAT },
      }, options);
      const parsed = res.parsed_output;
      if (!parsed) throw new GroupingError('parse', 'model returned no structured output');
      return { groups: parsed.groups, unassigned: parsed.unassigned };
    } catch (e) {
      if (options?.signal?.aborted) throw e;
      if (e instanceof GroupingError) throw e;
      const status = (e as { status?: number }).status;
      throw new GroupingError(httpErrorKind(status ?? 0), (e as Error).message || 'request failed');
    }
  }
}

export function makeGrouper(ai: AiSettings, config: GroupingConfig): Grouper | null {
  if (ai.provider === 'off' || !ai.apiKey) return null;
  if (ai.provider === 'anthropic') return new ClaudeGrouper({ apiKey: ai.apiKey, model: ai.model, config });
  if (ai.provider === 'custom') {
    if (!ai.baseUrl || !ai.model) return null;
    return new OpenAICompatibleGrouper({ apiKey: ai.apiKey, baseUrl: ai.baseUrl, model: ai.model, config });
  }
  // For other providers (openai/google/openrouter/cloudflare/groq), use OpenAI-compatible client with their baseUrl
  if (ai.baseUrl && ai.model) {
    return new OpenAICompatibleGrouper({ apiKey: ai.apiKey, baseUrl: ai.baseUrl, model: ai.model, config });
  }
  return null;
}

interface OpenAiOpts { apiKey: string; baseUrl: string; model: string; config: GroupingConfig; fetchFn?: typeof fetch }

export class OpenAICompatibleGrouper implements Grouper {
  constructor(private opts: OpenAiOpts) {}

  async group(inputs: GroupInput[], existingGroups: string[], options?: ClassifyRequestOptions): Promise<RawProposal> {
    if (inputs.length === 0) return { groups: [], unassigned: [] };
    const doFetch = this.opts.fetchFn ?? fetch;
    const list = inputs.map((s) => ({ id: s.id, title: s.title, host: s.host, group: s.currentGroup }));
    const system =
      groupingSystemPrompt(this.opts.config) +
      ' Reply ONLY with JSON: {"groups":[{"name":string,"memberIds":string[]}],"unassigned":string[]}.';
    let resp: Response;
    try {
      resp = await doFetch(chatCompletionsUrl(this.opts.baseUrl), {
        method: 'POST',
        signal: options?.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.opts.apiKey}` },
        body: JSON.stringify({
          model: this.opts.model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: `Existing groups: ${JSON.stringify(existingGroups)}\nGroup:\n${JSON.stringify(list)}` },
          ],
        }),
      });
    } catch (e) {
      if (options?.signal?.aborted) throw e;
      throw new GroupingError('network', (e as Error).message || 'request failed');
    }
    if (!resp.ok) throw new GroupingError(httpErrorKind(resp.status), `grouping failed: ${resp.status}`);
    let parsed: RawProposal;
    try {
      const dataJson = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
      const content = dataJson.choices?.[0]?.message?.content;
      if (!content) throw new Error('empty response');
      parsed = Schema.parse(JSON.parse(content));
    } catch {
      throw new GroupingError('parse', 'invalid JSON from model');
    }
    return parsed;
  }
}
