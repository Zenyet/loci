export interface ClassifyInput { id: string; title: string; host: string }
export interface ClassifyResult { topics: string[] }

export interface ClassifyRequestOptions {
  signal?: AbortSignal;
  maxRetries?: number;
}

export interface Classifier {
  /** Batch-classify sites into 1–3 semantic topics each. */
  classify(sites: ClassifyInput[], options?: ClassifyRequestOptions): Promise<Map<string, ClassifyResult>>;
}

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-4-8';
