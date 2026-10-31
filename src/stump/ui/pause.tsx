import { useCallback, useEffect, useRef, useState } from 'react'
import { runAction } from './api.ts'
import { Icon } from './icons.tsx'
import { Outcome, Tip, useLoaded, useRun } from './kit.tsx'
import type { PauseScope, PauseState, Resumed, Team } from './types.ts'

// Pause state for the shell's control and the Pause screen, read from the
// spine's stump.calendar.pause. Every change here announces itself so each
// view on the page re-reads the same state.
const CHANGED = 'stump:pause-changed'
/** Announces a pause change; `scope` (or `resumed`) carries the action's own answer, so every view shows it at once, before its re-read. */
export const pauseChanged = (change: { scope?: PauseScope; resumed?: 'all' } = {}) => window.dispatchEvent(new CustomEvent(CHANGED, { detail: change }))
const key = () => crypto.randomUUID()
/** Roles that may pause and resume (tools/calendar.ts EDITORS). */
export const mayPause = (role: string | undefined) => role === 'owner' || role === 'admin' || role === 'editor'

export function usePause() {
  const loaded = useLoaded(async () => ({
    state: await runAction<PauseState>('stump.calendar.pause', { action: 'state' }),
    team: await runAction<Team>('stump.team.manage', { action: 'list' }),
  }))
  const { refresh, setData } = loaded
  useEffect(() => {
    const listen = (event: Event) => {
      const change = (event as CustomEvent<{ scope?: PauseScope; resumed?: 'all' }>).detail ?? {}
      if (change.scope || change.resumed) setData(current => current ? { ...current, state: { ...current.state, paused: [
        ...current.state.paused.filter(scope => change.scope ? !(scope.scope === change.scope.scope && scope.account_id === change.scope.account_id) : scope.scope !== 'all'),
        ...(change.scope ? [change.scope] : [])] } } : current)
      void refresh()
    }
    window.addEventListener(CHANGED, listen)
    return () => window.removeEventListener(CHANGED, listen)
  }, [refresh, setData])
  const all = loaded.data?.state.paused.find(scope => scope.scope === 'all') ?? null
  const name = useCallback((id: string) => loaded.data?.team.items.find(person => person.id === id)?.display_name ?? 'Someone who left', [loaded.data])
  return { ...loaded, all, name }
}

/** The pause action's answer (tools/calendar.ts pause). */
interface Paused { scope: 'all' | 'account'; account_id: string | null; paused: boolean; paused_at: string; held: string[] }
export const pauseAll = () => runAction<Paused>('stump.calendar.pause', { action: 'pause', scope: 'all', idempotency_key: key() })
export const pauseAccount = (accountId: string) => runAction('stump.calendar.pause', { action: 'pause', scope: 'account', account_id: accountId, idempotency_key: key() })
export const resume = (scope: 'all' | 'account', accountId?: string | null) =>
  runAction<Resumed>('stump.calendar.pause', { action: 'resume', scope, ...(accountId ? { account_id: accountId } : {}), idempotency_key: key() })

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
/** "2:14 PM" today, "Oct 28, 2:14 PM" another day. */
export function shortTime(iso: string | null) {
  if (!iso) return ''
  const at = new Date(iso)
  // A no-break space keeps "7:59 AM" whole when a line wraps.
  return new Intl.DateTimeFormat('en-US', sameDay(at, new Date()) ? { hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(at)
    .replace(/\s+(?=[AP]M\b)/g, '\u00a0')
}
const firstName = (name: string) => name.split(/\s+/)[0] ?? name
export const pausedLine = (scope: PauseScope, name: (id: string) => string) => `Publishing paused by ${firstName(name(scope.person_id))} at ${shortTime(scope.at)}`

/** A count with its words and one quiet line under them. */
function CountRow({ count, held, label, meta }: { count: number; held?: boolean; label: string; meta: string }) {
  return <div className="st-count-row"><span className={held ? 'st-count held' : 'st-count'}>{count}</span><div><div className="st-name">{label}</div><div className="st-meta">{meta}</div></div></div>
}
const times = (items: Array<{ scheduled_at: string | null }>) => items.map(item => shortTime(item.scheduled_at)).join(', ')

/** What a resume let go and what it kept held, in plain counts with times. */
export function ResumeOutcome({ resumed }: { resumed: Resumed }) {
  const out = resumed.will_post.length, held = resumed.held_overdue.length
  return <div aria-live="polite">
    <CountRow count={out} label={out === 1 ? 'post will go out' : 'will go out'} meta={out ? times(resumed.will_post) : 'Nothing was waiting.'} />
    {held ? <CountRow count={held} held label={held === 1 ? 'overdue stays held' : 'overdue stay held'} meta="Their time passed while paused. Reschedule or drop them." /> : null}
  </div>
}

/** The posts a resume of everything would let go and keep held, read before the press: paused posts no account pause still covers. */
function useResumePreview(open: boolean, state: PauseState | undefined) {
  const [items, setItems] = useState<Array<{ account_id: string | null; scheduled_at: string | null }> | null>(null)
  useEffect(() => {
    if (!open) { setItems(null); return }
    let live = true
    void runAction<{ items: Array<{ account_id: string | null; scheduled_at: string | null }> }>('stump.drafts.revise', { action: 'list', state: 'paused' })
      .then(answer => { if (live) setItems(answer.items) }, () => { if (live) setItems(null) })
    return () => { live = false }
  }, [open])
  if (!items || !state) return null
  const covered = new Set(state.paused.filter(scope => scope.scope === 'account').map(scope => scope.account_id))
  const free = items.filter(item => !covered.has(item.account_id)).sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)))
  const now = Date.now()
  return { out: free.filter(item => item.scheduled_at && Date.parse(item.scheduled_at) > now), overdue: free.filter(item => !item.scheduled_at || Date.parse(item.scheduled_at) <= now) }
}

/** Closes a popover on Escape or a press outside it. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    const press = (event: PointerEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) close() }
    document.addEventListener('keydown', key); document.addEventListener('pointerdown', press)
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', press) }
  }, [open, close])
  return ref
}

/**
 * The top bar's Pause pill (SPEC §4.1): "Pause publishing" ("Pause" on a phone) pauses everything
 * in one press; while paused it reads "Resume publishing" ("Resume" on a phone)
 * and opens the resume popover, which shows what went out and what stayed held.
 */
export function PauseControl({ role, personId }: { role: string | undefined; personId: string | undefined }) {
  const { data, all } = usePause()
  const { busy, message, run } = useRun()
  const [open, setOpen] = useState(false)
  const [resumed, setResumed] = useState<Resumed | null>(null)
  const close = useCallback(() => { setOpen(false); setResumed(null) }, [])
  const ref = useDismiss(open, close)
  const preview = useResumePreview(open && !!all && !resumed, data?.state)
  if (!data || !mayPause(role)) return null
  if (!all && !resumed) {
    // A refused pause opens an alert under the pill with the reason, so a press never fails silently.
    const pause = () => void run(pauseAll).then(done => {
      if (done) { close(); pauseChanged({ scope: { scope: 'all', account_id: null, person_id: personId ?? '', at: done.paused_at } }) } else setOpen(true)
    })
    return <div className="st-pop-anchor" ref={ref}>
      <Tip label="Pause publishing" side="below">
        <button type="button" className="st-pause" disabled={busy} onClick={pause}>
          <span className="st-pause-icon"><Icon name="pause" /></span><span className="st-pause-label">Pause<span className="st-pause-more"> publishing</span></span>
        </button>
      </Tip>
      {open && message?.error ? <div className="st-popover" role="alert" aria-labelledby="st-pause-failed-title">
        <p className="st-popover-title" id="st-pause-failed-title">Publishing was not paused</p>
        <Outcome message={message} />
        <div className="st-actions">
          <button type="button" className="st-button primary" disabled={busy} onClick={pause}>Try again</button>
          <button type="button" className="st-button quiet" onClick={close}>Close</button>
        </div>
      </div> : null}
    </div>
  }
  const resumeAll = () => void run(() => resume('all')).then(result => { if (result) { setResumed(result); pauseChanged({ resumed: 'all' }) } })
  return <div className="st-pop-anchor" ref={ref}>
    <button type="button" className={all ? 'st-pause paused' : 'st-pause'} aria-expanded={open} aria-controls="st-resume" onClick={() => open ? close() : setOpen(true)}>
      <span className="st-pause-icon"><Icon name={all ? 'play' : 'pause'} /></span><span className="st-pause-label">{all ? <>Resume<span className="st-pause-more"> publishing</span></> : <>Pause<span className="st-pause-more"> publishing</span></>}</span>
    </button>
    {open ? <div className="st-sheet-scrim" aria-hidden="true" onClick={close} /> : null}
    {open ? <div className="st-popover" id="st-resume" role="dialog" aria-labelledby="st-resume-title">
      <p className="st-popover-title" id="st-resume-title">{resumed ? 'Publishing resumed' : 'Resume publishing'}</p>
      {resumed ? <ResumeOutcome resumed={resumed} /> : preview ? <div aria-live="polite">
        <CountRow count={preview.out.length} label={preview.out.length === 1 ? 'post will go out' : 'will go out'} meta={preview.out.length ? times(preview.out) : 'Nothing is waiting.'} />
        {preview.overdue.length ? <CountRow count={preview.overdue.length} held label={preview.overdue.length === 1 ? 'overdue stays held' : 'overdue stay held'}
          meta={`Was due ${times(preview.overdue)}. Reschedule or drop it.`} /> : null}
      </div> : <div className="st-resume-wait" />}
      <Outcome message={message} />
      <div className="st-actions">
        {resumed ? <button type="button" className="st-button primary" onClick={close}>Done</button> : <>
          <button type="button" className="st-button primary" disabled={busy} onClick={resumeAll}>Resume</button>
          <button type="button" className="st-button quiet" onClick={close}>Keep paused</button>
        </>}
      </div>
    </div> : null}
  </div>
}

/** The full-width notice at the top of every screen while all publishing is paused. */
export function PauseBanner() {
  const { all, name } = usePause()
  if (!all) return null
  return <div className="st-banner" role="status">
    <span className="st-disc" aria-hidden="true"><Icon name="pause" /></span>
    <span className="st-banner-text">{pausedLine(all, name)}</span>
  </div>
}
