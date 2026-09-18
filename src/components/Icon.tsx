import type { ReactNode } from "react";

export type IconName =
  | "look"
  | "wallpaper"
  | "search"
  | "behavior"
  | "ai"
  | "settings"
  | "check"
  | "close"
  | "upload"
  | "link"
  | "arrow"
  | "chevron-left"
  | "chevrons"
  | "enter"
  | "eye"
  | "eye-off"
  | "chevron-down"
  | "grip"
  | "focus"
  | "edit"
  | "trash"
  | "folder"
  | "plus"
  | "bookmark"
  | "external"
  | "pin"
  | "more"
  | "eyedropper";

/** Optically aligned 24-point symbols, with a shared weight and soft secondary planes. */
export function Icon({
  name,
  size = 18,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  const paths: Record<IconName, ReactNode> = {
    more: <g fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></g>,
    folder: <>
      <path d="M3.25 8V6.5A2.25 2.25 0 0 1 5.5 4.25h4L12 7h6.5a2.25 2.25 0 0 1 2.25 2.25v8.25a2.25 2.25 0 0 1-2.25 2.25h-13a2.25 2.25 0 0 1-2.25-2.25Z" fill="currentColor" fillOpacity=".15" />
      <path d="M3.5 9.25h17" opacity=".55" />
    </>,
    plus: <path d="M12 5v14M5 12h14" strokeWidth="1.8" />,
    bookmark: <path d="M6.25 20V5.5A2.25 2.25 0 0 1 8.5 3.25h7a2.25 2.25 0 0 1 2.25 2.25V20L12 16.5Z" fill="currentColor" fillOpacity=".1" />,
    external: <><path d="M13.5 4.25h6.25v6.25m0-6.25-9.5 9.5" /><path d="M9 4.75H6.5A2.25 2.25 0 0 0 4.25 7v10.5a2.25 2.25 0 0 0 2.25 2.25H17a2.25 2.25 0 0 0 2.25-2.25V15" /></>,
    pin: <><path d="m14 3 7 7-2.25.75-3 3v3.5l-2 2-9-9 2-2h3.5l3-3Z" fill="currentColor" fillOpacity=".12" /><path d="m9.25 14.75-5.5 5.5" /></>,
    look: (
      <>
        <circle cx="12" cy="12" r="8.25" />
        <path
          d="M12 3.75a8.25 8.25 0 0 1 0 16.5Z"
          fill="currentColor"
          opacity=".28"
          stroke="none"
        />
        <path d="M12 3.75v16.5" />
        <path d="M15.1 7.2a5.7 5.7 0 0 1 2.55 4.8" opacity=".65" />
      </>
    ),
    wallpaper: (
      <>
        <rect x="3.25" y="4.25" width="17.5" height="15.5" rx="3.5" />
        <path d="m4.1 16.8 4.4-4.65a1.2 1.2 0 0 1 1.8 0l2.4 2.5 1.8-1.9a1.2 1.2 0 0 1 1.8 0l4.1 4.35" />
        <path
          d="M4 17.1 9.4 12l3.3 3.3 2.7-2.5 4.6 4.3v1.6H4Z"
          fill="currentColor"
          opacity=".16"
          stroke="none"
        />
        <circle cx="15.9" cy="8.9" r="1.35" fill="currentColor" stroke="none" />
      </>
    ),
    search: (
      <>
        <circle cx="10.65" cy="10.65" r="6.65" />
        <path d="m15.55 15.55 4.7 4.7" strokeWidth="2" />
        <path d="M7 10.4a3.7 3.7 0 0 1 3.4-3.45" opacity=".5" />
      </>
    ),
    behavior: (
      <>
        <path d="M5 6.5h14M5 12h14M5 17.5h14" opacity=".6" />
        <rect
          x="7"
          y="4.25"
          width="4.5"
          height="4.5"
          rx="1.7"
          fill="currentColor"
          stroke="none"
        />
        <rect
          x="13"
          y="9.75"
          width="4.5"
          height="4.5"
          rx="1.7"
          fill="currentColor"
          stroke="none"
        />
        <rect
          x="8.5"
          y="15.25"
          width="4.5"
          height="4.5"
          rx="1.7"
          fill="currentColor"
          stroke="none"
        />
      </>
    ),
    ai: (
      <>
        <path
          d="M10 3.5c.7 5.3 2.2 6.8 7.5 7.5-5.3.7-6.8 2.2-7.5 7.5C9.3 13.2 7.8 11.7 2.5 11 7.8 10.3 9.3 8.8 10 3.5Z"
          fill="currentColor"
          fillOpacity=".16"
        />
        <path d="M18.5 2.5v5m-2.5-2.5h5M18 16v5m-2.5-2.5h5" />
      </>
    ),
    settings: (
      <>
        <path d="m10.35 3.5.4-1h2.5l.4 1 .4 1.4 1.5.65 1.3-.65 1.05-.4 1.8 1.8-.4 1.05-.65 1.3.65 1.5 1.4.4 1 .4v2.5l-1 .4-1.4.4-.65 1.5.65 1.3.4 1.05-1.8 1.8-1.05-.4-1.3-.65-1.5.65-.4 1.4-.4 1h-2.5l-.4-1-.4-1.4-1.5-.65-1.3.65-1.05.4-1.8-1.8.4-1.05.65-1.3-.65-1.5-1.4-.4-1-.4v-2.5l1-.4 1.4-.4.65-1.5-.65-1.3-.4-1.05 1.8-1.8 1.05.4 1.3.65 1.5-.65Z" />
        <circle cx="12" cy="12" r="3.15" />
      </>
    ),
    check: <path d="m5.5 12 4.1 4.1 8.9-9.2" strokeWidth="2" />,
    close: <path d="m7.25 7.25 9.5 9.5m0-9.5-9.5 9.5" strokeWidth="1.9" />,
    upload: (
      <>
        <path d="M12 15V3.75m-4 4 4-4 4 4" />
        <path d="M4.5 14.25v4A2.25 2.25 0 0 0 6.75 20.5h10.5a2.25 2.25 0 0 0 2.25-2.25v-4" />
        <path d="M7.5 17h9" opacity=".35" />
      </>
    ),
    link: (
      <>
        <path d="m9.3 14.7 5.4-5.4" />
        <path d="m13.15 6.65 1.5-1.5a4.03 4.03 0 0 1 5.7 5.7l-3.2 3.2a4.03 4.03 0 0 1-5.7 0m-.6 3.3-1.5 1.5a4.03 4.03 0 0 1-5.7-5.7l3.2-3.2a4.03 4.03 0 0 1 5.7 0" />
      </>
    ),
    arrow: <path d="m9.25 6.25 5.75 5.75-5.75 5.75" strokeWidth="1.8" />,
    "chevron-left": (
      <path d="m14.75 6.25-5.75 5.75 5.75 5.75" strokeWidth="1.8" />
    ),
    chevrons: (
      <path
        d="m8.5 8.5 3.5-3.5 3.5 3.5m-7 7 3.5 3.5 3.5-3.5"
        strokeWidth="1.8"
      />
    ),
    enter: (
      <>
        <path d="M19 5.5v5.75A2.75 2.75 0 0 1 16.25 14H5" />
        <path d="m8.5 10.5-3.5 3.5 3.5 3.5" />
      </>
    ),
    eye: (
      <>
        <path d="M2.5 12S5.7 5.5 12 5.5 21.5 12 21.5 12 18.3 18.5 12 18.5 2.5 12 2.5 12Z" />
        <circle cx="12" cy="12" r="2.5" />
      </>
    ),
    "eye-off": (
      <>
        <path d="m3.5 3.5 17 17M9.6 5.85A11 11 0 0 1 12 5.5c6.3 0 9.5 6.5 9.5 6.5a15 15 0 0 1-2.7 3.6M6.1 7.2A18 18 0 0 0 2.5 12s3.2 6.5 9.5 6.5a11 11 0 0 0 4.6-1.05" />
      </>
    ),
    "chevron-down": <path d="m6.25 9.25 5.75 5.75 5.75-5.75" strokeWidth="1.8" />,
    grip: (
      <g fill="currentColor" stroke="none">
        {[6, 12, 18].map(y => <g key={y}><circle cx="9" cy={y} r="1.35" /><circle cx="15" cy={y} r="1.35" /></g>)}
      </g>
    ),
    focus: (
      <>
        <path d="M8 3.75H6A2.25 2.25 0 0 0 3.75 6v2m12-4.25H18A2.25 2.25 0 0 1 20.25 6v2m0 8v2A2.25 2.25 0 0 1 18 20.25h-2m-8 0H6A2.25 2.25 0 0 1 3.75 18v-2" />
        <circle cx="12" cy="12" r="4" fill="currentColor" fillOpacity=".12" />
        <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      </>
    ),
    edit: (
      <>
        <path d="m14.75 5.25 1.5-1.5a2.83 2.83 0 0 1 4 4l-1.5 1.5m-4-4L5 15l-1.25 5.25L9 19l9.75-9.75m-4-4 4 4" />
        <path d="m5 15 4 4M13 20.25h7.25" opacity=".6" />
      </>
    ),
    trash: (
      <>
        <path d="M4 6.75h16M9 6.75V4.5a1.25 1.25 0 0 1 1.25-1.25h3.5A1.25 1.25 0 0 1 15 4.5v2.25M5.75 7l.7 11.2a2.25 2.25 0 0 0 2.25 2.05h6.6a2.25 2.25 0 0 0 2.25-2.05l.7-11.2" />
        <path d="m9.5 10.5.35 6m4.65-6-.35 6" opacity=".7" />
      </>
    ),
    eyedropper: (
      <>
        <path d="m14 5.5 2-2a3.18 3.18 0 0 1 4.5 4.5l-2 2M12 4.25l7.75 7.75M12.75 7.75l-8.5 8.5-.5 4 4-.5 8.5-8.5" />
        <path d="m7 14 3 3" opacity=".5" />
      </>
    ),
  };
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.55"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
