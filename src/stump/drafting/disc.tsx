import type { ReactNode } from 'react'

/** Small line icons for the drafting screens' section discs; decoration only, never a network logo. */
const ICONS: Record<string, ReactNode> = {
  pencil: <path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" />,
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  grid: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
  people: <path d="M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 010 6.5M18 14c2 .8 3 3 3 6" />,
  person: <path d="M12 12a4 4 0 100-8 4 4 0 000 8zM5 20c0-3.9 3.1-7 7-7s7 3.1 7 7" />,
  box: <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zM4 7.5l8 4.5 8-4.5M12 12v9" />,
  doc: <path d="M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5" />,
  alert: <path d="M12 7v6M12 16.5v.5" />,
}
export type DiscIcon = keyof typeof ICONS

export function Disc({ icon, tone }: { icon: DiscIcon; tone?: 'danger' | 'held' | undefined }) {
  return <span className={tone ? `st-disc ${tone}` : 'st-disc'} aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{ICONS[icon]}</svg>
  </span>
}
