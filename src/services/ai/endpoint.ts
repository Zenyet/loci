/** All compatible clients, including the connection check, use the same URL. */
export function chatCompletionsUrl(baseUrl: string): string {
  let base = baseUrl.trim().replace(/\/+$/, '');
  // Gemini's compatibility API lives below /openai, not the native API root.
  if (/^https:\/\/generativelanguage\.googleapis\.com\/v1(?:beta)?$/.test(base)) {
    base += '/openai';
  }
  return `${base}/chat/completions`;
}
