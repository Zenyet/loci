export function WeatherGlyph({ code, isDay = true, size = 24 }: { code: number | null; isDay?: boolean; size?: number }) {
  const clear = code === 0 || code === 1;
  const rain = code !== null && ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95);
  const snow = code !== null && ((code >= 71 && code <= 77) || code === 85 || code === 86);
  return <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true" className="weather-glyph">
    {(clear || code === 2) && isDay && <g stroke="#ffd76d" strokeWidth="2.7" strokeLinecap="round"><circle cx="24" cy="22" r="9" fill="#ffd76d" stroke="none" /><path d="M24 5v4m0 27v4M7 22h4m26 0h4M12 10l3 3m18 18 3 3M12 34l3-3m18-18 3-3" /></g>}
    {(clear || code === 2) && !isDay && <><path d="M26 6A17 17 0 1 0 42 29C28 33 20 19 26 6Z" fill="#fff" /><path d="m35 3 1.3 4.5L41 9l-4.7 1.5L35 15l-1.3-4.5L29 9l4.7-1.5ZM43 15l.8 2.6 2.7.9-2.7.9L43 22l-.8-2.6-2.7-.9 2.7-.9Z" fill="#fff" /></>}
    {!clear && code !== null && <path d="M11 34h25a8 8 0 1 0-2-15.7A11.5 11.5 0 0 0 12 19a7.6 7.6 0 0 0-1 15Z" fill="#f1f4fa" stroke="#8c99ab" strokeOpacity=".3" />}
    {rain && <path d="m16 39-2 4m11-4-2 4m11-4-2 4" stroke="#8cd6ff" strokeWidth="3" strokeLinecap="round" />}
    {snow && <g fill="#d9efff"><circle cx="15" cy="40" r="2" /><circle cx="25" cy="43" r="2" /><circle cx="35" cy="40" r="2" /></g>}
    {(code === 45 || code === 48) && <path d="M9 39h30M14 44h20" stroke="currentColor" strokeOpacity=".6" strokeWidth="2" strokeLinecap="round" />}
    {code !== null && code >= 95 && <path d="m25 26-7 12h6l-3 9 12-15h-8l5-6Z" fill="#ffcf52" />}
    {code === null && <path d="M14 25h20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".55" />}
  </svg>;
}
