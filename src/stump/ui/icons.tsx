// Stump's line icons (SPEC §3.4): 24-unit grid, 1.75 stroke, currentColor.
// Network names are always text; there are no network logos here.
const paths = {
  home: <><path d="M3.5 10.5 12 4l8.5 6.5" /><path d="M5.5 9v10.5h4.5v-6h4v6h4.5V9" /></>,
  pencil: <><path d="M15.5 5.5l3 3L8 19l-4 1 1-4z" /><path d="M13.5 7.5l3 3" /></>,
  arrows: <><path d="M4 8h15" /><path d="M15.5 4.5 19 8l-3.5 3.5" /><path d="M20 16H5" /><path d="M8.5 12.5 5 16l3.5 3.5" /></>,
  store: <><path d="M4.5 9.5V20h15V9.5" /><path d="M3.5 9.5 5 4.5h14l1.5 5" /><path d="M3.5 9.5a2.8 2.8 0 0 0 5.67 0 2.8 2.8 0 0 0 5.66 0 2.8 2.8 0 0 0 5.67 0" /><path d="M10 20v-5h4v5" /></>,
  ear: <><path d="M7 10a5.5 5.5 0 0 1 11 0c0 3-2.5 4-3.2 5.6-.7 1.7-.8 4.4-3.5 4.4A3 3 0 0 1 8.5 18" /><path d="M10 10.5a2.5 2.5 0 0 1 5 0c0 1.5-1.5 2-1.5 3.5" /></>,
  mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4 7 8 6 8-6" /></>,
  ledger: <><rect x="5" y="4.5" width="14" height="16" rx="2" /><path d="M9 3.5h6v2.5H9z" /><path d="M8.5 10.5h7M8.5 14h7M8.5 17.5h4" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M6 18l1.4-1.4M16.6 7.4 18 6" /><circle cx="12" cy="12" r="6.5" /></>,
  pause: <><path d="M9 6.5v11M15 6.5v11" strokeWidth="2.5" /></>,
  play: <><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  check: <><path d="m5 12.5 4.5 4.5L19 7.5" strokeWidth="2.5" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  arrowRight: <><path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5" /></>,
  close: <><path d="M6 6l12 12M18 6 6 18" /></>,
  more: <><circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none" /></>,
  calendar: <><rect x="4" y="5.5" width="16" height="14.5" rx="2" /><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" /></>,
  chevronDown: <><path d="m7 10 5 5 5-5" /></>,
  key: <><circle cx="8" cy="15" r="3.5" /><path d="m10.5 12.5 8-8M15.5 7.5l2.5 2.5" /></>,
  speech: <><path d="M12 4.5c4.7 0 8.5 3 8.5 6.8s-3.8 6.7-8.5 6.7c-.9 0-1.8-.1-2.6-.3L5 19.5l.9-3.6C4.4 14.7 3.5 13.1 3.5 11.3c0-3.8 3.8-6.8 8.5-6.8z" /></>,
  send: <><path d="M20.5 3.5 10.5 13.5" /><path d="M20.5 3.5 14 20.5l-3.5-7-7-3.5z" /></>,
  chart: <><path d="M4.5 19.5h15" /><path d="M7.5 16v-5M12 16V7.5M16.5 16v-3" strokeWidth="2.25" /></>,
  list: <><path d="M9.5 7h10M9.5 12h10M9.5 17h10" /><path d="M4.5 7h1M4.5 12h1M4.5 17h1" strokeWidth="2.5" /></>,
  people: <><circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14c2 .8 3 3 3 6" /></>,
} as const

export type IconName = keyof typeof paths

export function Icon({ name, label }: { name: IconName; label?: string }) {
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label} focusable="false">{paths[name]}</svg>
}

/**
 * The sidebar's icon for a route, chosen by path so a nav entry never names
 * one: the longest matching prefix wins, and every settings screen is the gear.
 */
const byPath: ReadonlyArray<readonly [string, IconName]> = [
  ['/app/compose', 'pencil'], ['/app/handoffs', 'arrows'], ['/app/venues', 'store'], ['/app/listening', 'ear'],
  ['/app/inbox', 'mail'], ['/app/ledger', 'ledger'], ['/app/settings', 'gear'], ['/app', 'home'],
]
export function navIcon(path: string): IconName {
  return byPath.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))?.[1] ?? 'home'
}
