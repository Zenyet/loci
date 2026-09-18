import type { GroupColor } from '../types';
import { mixHex } from '../services/color';
import { useId } from 'react';

export function FolderIcon({ hue, size = 42 }: { hue: GroupColor; size?: number }) {
  const id = useId().replace(/:/g, '');
  const shade = (lightness: number, chroma: number, amount: number) => typeof hue === 'number'
    ? `oklch(${lightness} ${chroma} ${hue})`
    : mixHex(hue, amount > 0 ? 255 : 0, Math.abs(amount));
  return <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={`${id}-back`} x1="24" y1="8" x2="24" y2="37" gradientUnits="userSpaceOnUse">
        <stop stopColor={shade(.78, .11, .08)} /><stop offset="1" stopColor={shade(.51, .12, -.24)} />
      </linearGradient>
      <linearGradient id={`${id}-front`} x1="24" y1="19" x2="24" y2="40" gradientUnits="userSpaceOnUse">
        <stop stopColor={shade(.82, .12, .14)} /><stop offset=".18" stopColor={shade(.73, .13, 0)} /><stop offset="1" stopColor={shade(.59, .12, -.12)} />
      </linearGradient>
      <filter id={`${id}-shadow`} x="-25%" y="-25%" width="150%" height="165%"><feDropShadow dx="0" dy="2" stdDeviation="1.5" floodOpacity=".12" /></filter>
    </defs>
    <g filter={`url(#${id}-shadow)`}>
      <path d="M5 14a4 4 0 0 1 4-4h9c1.5 0 2.2.4 3.2 1.5L24 14h15a4 4 0 0 1 4 4v17a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4Z" fill={`url(#${id}-back)`} />
      <path d="M9 17h29a2 2 0 0 1 2 2v15H7V19a2 2 0 0 1 2-2Z" fill="#fff" fillOpacity=".73" />
      <rect x="4.5" y="19.5" width="39" height="20" rx="4.5" fill={`url(#${id}-front)`} />
      <rect x="5" y="20" width="38" height="19" rx="4" stroke="#fff" strokeOpacity=".24" />
      <path d="M9 20h30" stroke="#fff" strokeOpacity=".42" strokeLinecap="round" />
    </g>
  </svg>;
}
