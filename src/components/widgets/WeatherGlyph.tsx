export function WeatherGlyph({ code, isDay = true, size = 24 }: { code: number | null; isDay?: boolean; size?: number }) {
  const sunny = code === 0 || code === 1;
  const rain = code !== null && ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95);
  const snow = code !== null && ((code >= 71 && code <= 77) || code === 85 || code === 86);
  return <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true" className="weather-glyph">
    {sunny && isDay && <g stroke="#cb932d" strokeWidth="2" strokeLinecap="round"><circle cx="24" cy="23" r="9" fill="#efc875" fillOpacity=".45" /><path d="M24 6v3m0 28v3M7 23h3m28 0h3M12 11l2 2m20 20 2 2M12 35l2-2m20-20 2-2" /></g>}
    {sunny && !isDay && <path d="M29 7a17 17 0 1 0 12 25A16 16 0 0 1 29 7Z" fill="#b4bde4" stroke="#899bc9" strokeWidth="2" />}
    {!sunny && <path d="M13 32h23a7.5 7.5 0 1 0-1.7-14.8A11 11 0 0 0 13 18a7 7 0 0 0 0 14Z" fill="currentColor" fillOpacity=".13" stroke="currentColor" strokeOpacity=".6" strokeWidth="2" />}
    {rain && <path d="m17 37-2 4m10-4-2 4m10-4-2 4" stroke="#6d9cbd" strokeWidth="2.6" strokeLinecap="round" />}
    {snow && <g fill="#7fa3bf"><circle cx="16" cy="39" r="2" /><circle cx="25" cy="41" r="2" /><circle cx="34" cy="38" r="2" /></g>}
    {(code === 45 || code === 48) && <path d="M10 37h27M15 42h18" stroke="currentColor" strokeOpacity=".5" strokeWidth="2" strokeLinecap="round" />}
    {code === null && <text x="24" y="27" fontSize="14" textAnchor="middle" fill="currentColor">?</text>}
  </svg>;
}
