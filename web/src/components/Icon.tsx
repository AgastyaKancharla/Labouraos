import { NAV_ICONS, type NavIconName } from '../portals/navIcons';

/** Sidebar icon from the designs (17×17 on a 20-unit grid, stroke = currentColor). */
export function NavIcon({ name, size = 17 }: { name: NavIconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      focusable="false"
      // Static markup copied from the approved designs (portals/navIcons.ts) — never user data.
      dangerouslySetInnerHTML={{ __html: NAV_ICONS[name] }}
    />
  );
}

const UI_PATHS = {
  bell: (
    <>
      <path d="M10 2.8a5 5 0 0 0-5 5v3.1L3.6 13.6h12.8L15 10.9V7.8a5 5 0 0 0-5-5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M8 16a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </>
  ),
  search: (
    <>
      <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="m13.2 13.2 3.8 3.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </>
  ),
  refresh: (
    <path d="M16.5 10a6.5 6.5 0 1 1-2-4.7M16.5 3.5V8h-4.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
  ),
  menu: <path d="M3 5.5h14M3 10h14M3 14.5h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />,
  close: <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />,
  download: (
    <path d="M10 3v9.5M6 9l4 4 4-4M4 16.5h12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  ),
  arrowUp: <path d="M10 15V5M5.5 9.5 10 5l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />,
  arrowDown: <path d="M10 5v10M5.5 10.5 10 15l4.5-4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />,
  sort: <path d="M7 8 10 5l3 3M7 12l3 3 3-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />,
  chevronLeft: <path d="M12.5 4.5 7 10l5.5 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />,
  chevronRight: <path d="M7.5 4.5 13 10l-5.5 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />,
  alert: (
    <>
      <circle cx="10" cy="10" r="7.2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M10 6.3v4.4M10 13.4v.1" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </>
  ),
  check: <path d="m4.5 10.5 3.5 3.5 7.5-8" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />,
} as const;

export type UiIconName = keyof typeof UI_PATHS;

export function UiIcon({ name, size = 17 }: { name: UiIconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
      {UI_PATHS[name]}
    </svg>
  );
}
