const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase().trim();

/** All words must match; exact/prefix title matches outrank popular URL matches. */
export function bookmarkSearchScore(query: string, title: string, details = ''): number | null {
  const q = normalize(query);
  if (!q) return null;
  const name = normalize(title);
  const haystack = `${name} ${normalize(details)}`;
  const words = q.split(/\s+/);
  if (!words.every(word => haystack.includes(word))) return null;
  if (name === q) return 100;
  if (name.startsWith(q)) return 80;
  if (name.includes(q)) return 60;
  return words.reduce((score, word) => score + (name.includes(word) ? 10 : 1), 0);
}
