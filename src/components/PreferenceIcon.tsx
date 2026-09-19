import { useId } from 'react';

export type PreferenceIconName = 'look' | 'wallpaper' | 'search' | 'behavior' | 'ai' | 'widgets';
const palettes: Record<PreferenceIconName, [string, string, string]> = {
  widgets: ['#9cd8bd', '#5ab78d', '#2b8864'],
  look: ['#cdb5ff', '#9276ea', '#6b5bcd'],
  wallpaper: ['#79ddee', '#34adce', '#2787b8'],
  search: ['#78caff', '#3e95f3', '#2265d8'],
  behavior: ['#bfc4ce', '#939ba9', '#6e7785'],
  ai: ['#ffbd7d', '#fa9545', '#df652c'],
};

/** Small, fully vector glass tiles drawn for the settings sidebar. */
export function PreferenceIcon({ name }: { name: PreferenceIconName }) {
  const id = useId().replace(/:/g, '');
  const [top, middle, bottom] = palettes[name];
  const url = (part: string) => `url(#${id}-${part})`;
  return (
    <svg className="preference-icon" viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-base`} x1="10" y1="3" x2="51" y2="61" gradientUnits="userSpaceOnUse">
          <stop stopColor={top} /><stop offset=".48" stopColor={middle} /><stop offset="1" stopColor={bottom} />
        </linearGradient>
        <linearGradient id={`${id}-rim`} x1="12" y1="2" x2="50" y2="64" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" stopOpacity=".8" /><stop offset=".5" stopColor="#fff" stopOpacity=".12" /><stop offset="1" stopColor="#fff" stopOpacity=".32" />
        </linearGradient>
        <linearGradient id={`${id}-white`} x1="18" y1="14" x2="42" y2="49" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" /><stop offset="1" stopColor="#e6e7ff" />
        </linearGradient>
        <linearGradient id={`${id}-mountain`} x1="22" y1="28" x2="34" y2="60" gradientUnits="userSpaceOnUse">
          <stop stopColor="#d5faff" /><stop offset="1" stopColor="#64bcdd" stopOpacity=".3" />
        </linearGradient>
        <radialGradient id={`${id}-shine`} cx="0" cy="0" r="1" gradientTransform="translate(13 7) rotate(48) scale(53 42)" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" stopOpacity=".22" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${id}-clip`}><rect x="2.5" y="2.5" width="59" height="59" rx="17" /></clipPath>
        <filter id={`${id}-shadow`} x="-40%" y="-40%" width="180%" height="190%">
          <feDropShadow dx="0" dy="1.8" stdDeviation="1.7" floodColor={bottom} floodOpacity=".55" />
        </filter>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="18" fill={url('base')} />
      <rect x="2" y="2" width="60" height="60" rx="18" fill={url('shine')} />
      {name === 'widgets' && <g filter={url('shadow')} fill={url('white')}><rect x="16" y="16" width="13" height="13" rx="4" /><rect x="35" y="16" width="13" height="13" rx="4" /><rect x="16" y="35" width="13" height="13" rx="4" /><path d="M41.5 36v11m-5.5-5.5h11" stroke="#fff" strokeWidth="3" strokeLinecap="round" /></g>}
      {name === 'look'  && <g filter={url('shadow')}>
        <circle cx="32" cy="32" r="16.2" fill="#4e4398" fillOpacity=".3" />
        <path d="M32 15.8a16.2 16.2 0 0 0 0 32.4Z" fill={url('white')} />
        <circle cx="32" cy="32" r="16.2" stroke={url('white')} strokeWidth="1.7" />
        <path d="M32 16v32" stroke="#fff" strokeOpacity=".8" strokeWidth="1.1" />
      </g>}
      {name === 'wallpaper' && <g clipPath={url('clip')}>
        <circle cx="42" cy="20" r="4.3" fill={url('white')} />
        <path d="m21 51 17-17c1.5-1.7 3.2-1.8 4.8 0L66 60H21Z" fill="#85dbed" fillOpacity=".55" />
        <path d="M-2 49 22 27c1.8-1.7 3.1-1.8 4.8.1L64 66H-2Z" fill={url('mountain')} />
        <path d="M-2 55c11 0 20-11 28-11 10 0 22 18 38 16v6H-2Z" fill="#2287b9" fillOpacity=".23" />
        <path d="m4 44 18-17c1.8-1.7 3.1-1.8 4.8.1L36 37" stroke="#e5ffff" strokeOpacity=".4" strokeWidth=".7" />
      </g>}
      {name === 'search' && <g filter={url('shadow')} stroke={url('white')} strokeLinecap="round">
        <circle cx="28" cy="28" r="11.6" strokeWidth="3.1" />
        <path d="m36.7 36.7 3.8 3.8" strokeWidth="2.5" />
        <path d="m40.5 40.5 6.7 6.7" strokeWidth="4.4" />
      </g>}
      {name === 'behavior' && <g filter={url('shadow')}>
        <path d="M17 21h30M17 32h30M17 43h30" stroke={url('white')} strokeWidth="2.8" strokeLinecap="round" />
        <circle cx="33" cy="21" r="5.1" fill={url('white')} stroke="#fff" strokeOpacity=".7" strokeWidth=".5" />
        <circle cx="41" cy="32" r="3.5" fill={url('white')} stroke="#fff" strokeOpacity=".7" strokeWidth=".5" />
        <circle cx="25" cy="43" r="4.8" fill={url('white')} stroke="#fff" strokeOpacity=".7" strokeWidth=".5" />
      </g>}
      {name === 'ai' && <g filter={url('shadow')}>
        <path d="M29 18c3 11 5 13 14 15-9 2-11 4-14 15-3-11-5-13-14-15 9-2 11-4 14-15Z" fill="#fff5cc" stroke="#ffffee" strokeWidth=".8" strokeLinejoin="round" />
        <path d="M46 16c1.4 4.2 2.4 5.2 6 6.5-3.6 1.2-4.6 2.3-6 6.5-1.3-4.2-2.4-5.3-6-6.5 3.6-1.3 4.7-2.3 6-6.5Z" fill="#ffe28c" />
      </g>}
      <rect x="2.7" y="2.7" width="58.6" height="58.6" rx="17.3" stroke={url('rim')} strokeWidth="1.4" />
      <rect x="1.5" y="1.5" width="61" height="61" rx="18.5" stroke={bottom} strokeOpacity=".2" />
    </svg>
  );
}
