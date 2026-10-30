import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { explain } from './api.ts'
import { Icon, type IconName } from './icons.tsx'

/** The one tooltip every icon-only control uses: 2-4 words, after ~300 ms on hover, at once on focus. `below` for controls at the top of the page. */
export function Tip({ label, children, side = 'above', className }: { label: string; children: ReactNode; side?: 'above' | 'below'; className?: string }) {
  return <span className={['st-tip', side === 'below' ? 'below' : '', className ?? ''].filter(Boolean).join(' ')}>{children}<span role="tooltip">{label}</span></span>
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
  return <div className="st-empty"><img src="/art/stump-small.webp" alt="" width="240" height="151" /><h2>{title}</h2><p>{children}</p>{actions ? <div className="st-actions">{actions}</div> : null}</div>
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
  return { data, error, refresh }
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

export const when = (iso: string | null) => iso ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : ''
export const words = (value: string) => value.replace(/_/g, ' ')
