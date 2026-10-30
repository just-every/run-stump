import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { explain } from './api.ts'

/** The one tooltip every icon-only control uses: 2-4 words, after ~300 ms on hover, at once on focus. */
export function Tip({ label, children }: { label: string; children: ReactNode }) {
  return <span className="st-tip">{children}<span role="tooltip">{label}</span></span>
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
