import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { explain } from './api.ts'
import { Icon, type IconName } from './icons.tsx'

/** The one tooltip every icon-only control uses: 2-4 words, after ~300 ms on hover, at once on focus. `below` for controls at the top of the page. */
/** A 2-4 word tooltip; `align="end"` keeps it inside the screen for a control at the right edge. */
export function Tip({ label, children, side = 'above', align = 'center', className }: { label: string; children: ReactNode; side?: 'above' | 'below'; align?: 'center' | 'end'; className?: string }) {
  return <span className={['st-tip', side === 'below' ? 'below' : '', align === 'end' ? 'end' : '', className ?? ''].filter(Boolean).join(' ')}>{children}<span role="tooltip">{label}</span></span>
}

export type ChipTone = 'neutral' | 'success' | 'held' | 'danger'
/** A 26 px state or tag chip (SPEC §3.4). */
export function Chip({ tone = 'neutral', tick, children }: { tone?: ChipTone; tick?: boolean; children: ReactNode }) {
  return <span className={tone === 'neutral' ? 'st-chip' : `st-chip ${tone}`}>{tick ? <Icon name="check" /> : null}{children}</span>
}

/** The emerald tick disc (18 px in lists). */
export function Tick() {
  return <span className="st-tick" aria-hidden="true"><Icon name="check" /></span>
}

/** A 36 px emerald disc with a white line icon, once per section heading. */
export function Disc({ icon }: { icon: IconName }) {
  return <span className="st-disc" aria-hidden="true"><Icon name={icon} /></span>
}

/** A section heading with its disc, as Today and Pause draw them. */
export function PanelTitle({ icon, children, id }: { icon?: IconName; children: ReactNode; id?: string }) {
  return <h2 className="st-panel-title" id={id}>{icon ? <Disc icon={icon} /> : null}{children}</h2>
}

/** Two initials from a display name, for the initials disc. */
export const initialsOf = (name: string) => name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]!.toUpperCase()).join('') || '?'
export function Initials({ name }: { name: string }) {
  return <span className="st-initials" aria-hidden="true">{initialsOf(name)}</span>
}

/** An empty list: the pastel stump, one heading, one line and the action that fills it (U5). */
export function Empty({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return <div className="st-empty"><img src="/art/stump-small.webp" alt="" width="240" height="154" /><h2>{title}</h2><p>{children}</p>{actions ? <div className="st-actions">{actions}</div> : null}</div>
}

/**
 * Loads a view's data once and refreshes it in place: a refresh never clears
 * what is on screen, so nothing remounts, flashes or loses its scroll.
 */
export function useLoaded<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loader = useRef(load)
  loader.current = load
  const refresh = useCallback(async () => {
    try { setData(await loader.current()); setError(null) }
    catch (cause) { setError(explain(cause)) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  return { data, error, refresh, setData }
}

/** Runs one action at a time and keeps its outcome in plain words. */
export function useRun() {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const run = useCallback(async <T,>(work: () => Promise<T>, done?: (value: T) => string | void) => {
    setBusy(true); setMessage(null)
    try { const value = await work(); const text = done?.(value); if (text) setMessage({ text, error: false }); return value }
    catch (cause) { setMessage({ text: explain(cause), error: true }); return undefined }
    finally { setBusy(false) }
  }, [])
  return { busy, message, run }
}

export function Outcome({ message }: { message: { text: string; error: boolean } | null }) {
  return <p className={message?.error ? 'st-error' : 'st-note'} role="status" aria-live="polite">{message?.text ?? ''}</p>
}

const thisYear = (at: Date) => at.getFullYear() === new Date().getFullYear()
/** "Oct 30, 8:52 PM"; the year shows only when it is not this year. */
export const when = (iso: string | null) => {
  if (!iso) return ''
  const at = new Date(iso)
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', ...(thisYear(at) ? {} : { year: 'numeric' }), hour: 'numeric', minute: '2-digit' }).format(at)
}
/** "Oct 30" for a date or a YYYY-MM-DD day; the year shows only when it is not this year. */
export const day = (value: string | null) => {
  if (!value) return ''
  const at = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value)
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', ...(thisYear(at) ? {} : { year: 'numeric' }) }).format(at)
}
/** "Mar 2023" for a YYYY-MM-DD day. */
export const monthYear = (value: string | null) => value ? new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`)) : ''
export const words = (value: string) => value.replace(/_/g, ' ')

/** Network names are text, written the way each network writes its own. */
const NETWORKS: Record<string, string> = { x: 'X', bluesky: 'Bluesky', mastodon: 'Mastodon', linkedin: 'LinkedIn', threads: 'Threads', reddit: 'Reddit', hn: 'Hacker News', rss: 'RSS' }
export const networkWord = (network: string | null | undefined) => network ? NETWORKS[network.toLowerCase()] ?? network : ''
/** A handle as people write it: "@name", or the person's name on LinkedIn. */
export const handleWord = (handle: string, network?: string | null, name?: string | null) =>
  network === 'linkedin' ? name ?? handle : handle.startsWith('@') ? handle : `@${handle}`
/** The one way an account reads on every screen: "@brightwell · X". */
export const accountWord = (account: { handle: string; network: string; display_name?: string | null }) =>
  `${handleWord(account.handle, account.network, account.display_name)} · ${networkWord(account.network)}`

/** A web page named by itself: "changelog" for brightwell.app/changelog/3-2, "r/healthIT rules" for a subreddit's rules page. */
export function pageName(url: string): string {
  let parsed: URL
  try { parsed = new URL(url) } catch { return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') }
  const parts = parsed.pathname.split('/').filter(Boolean)
  const reddit = parts[0] === 'r' && parts[1] ? `r/${parts[1]}` : null
  if (reddit) return parts.includes('wiki') || parts.includes('about') ? `${reddit} rules` : reddit
  const named = parts.map(part => part.replace(/\.[a-z]+$/i, '')).find(part => /^[a-z][a-z-]*[a-z]$/i.test(part) && !/^(en|docs|blog|www|p|posts?|wiki|pages?)$/i.test(part))
  return (named ?? parsed.hostname.replace(/^www\./, '')).replace(/-/g, ' ')
}

/** A quiet "✓ Saved" after a setting saves as you go (L15); it never takes the place of an error. */
export function Saved({ shown }: { shown: boolean }) {
  return <span className="st-saved-mark" role="status" aria-live="polite">{shown ? <><span aria-hidden="true">✓ </span>Saved</> : ''}</span>
}
/** Shows "Saved" for a few seconds after each save. */
export function useSaved() {
  const [shown, setShown] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saved = useCallback(() => {
    setShown(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setShown(false), 4000)
  }, [])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return { shown, saved }
}

/** A row's one "⋯" menu (tooltip "More actions"): the place a row keeps its advanced and destructive actions (H13, H15). */
export function MoreMenu({ items, label = 'More actions' }: { items: Array<{ label: string; danger?: boolean; run(): void | Promise<void> }>; label?: string }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  if (!items.length) return null
  return <div className="st-more-menu" ref={box}>
    <Tip label="More actions" align="end"><button type="button" className="st-icon-button st-more-button" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen(!open)}><Icon name="more" /></button></Tip>
    {open ? <div className="st-menu" role="menu">{items.map(item => <button key={item.label} type="button" role="menuitem" className={item.danger ? 'danger' : undefined}
      onClick={() => { setOpen(false); void item.run() }}>{item.label}</button>)}</div> : null}
  </div>
}
