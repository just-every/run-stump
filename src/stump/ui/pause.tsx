import { useCallback, useEffect, useRef, useState } from 'react'
import { runAction } from './api.ts'
import { Icon } from './icons.tsx'
import { Outcome, Tip, useLoaded, useRun } from './kit.tsx'
import type { PauseScope, PauseState, Resumed, Team } from './types.ts'

// Pause state for the shell's control and the Pause screen, read from the
// spine's stump.calendar.pause. Every change here announces itself so each
// view on the page re-reads the same state.
const CHANGED = 'stump:pause-changed'
export const pauseChanged = () => window.dispatchEvent(new Event(CHANGED))
const key = () => crypto.randomUUID()
/** Roles that may pause and resume (tools/calendar.ts EDITORS). */
export const mayPause = (role: string | undefined) => role === 'owner' || role === 'admin' || role === 'editor'

export function usePause() {
  const loaded = useLoaded(async () => ({
    state: await runAction<PauseState>('stump.calendar.pause', { action: 'state' }),
    team: await runAction<Team>('stump.team.manage', { action: 'list' }),
  }))
  const { refresh } = loaded
  useEffect(() => {
    const listen = () => void refresh()
    window.addEventListener(CHANGED, listen)
    return () => window.removeEventListener(CHANGED, listen)
  }, [refresh])
  const all = loaded.data?.state.paused.find(scope => scope.scope === 'all') ?? null
  const name = useCallback((id: string) => loaded.data?.team.items.find(person => person.id === id)?.display_name ?? 'Someone who left', [loaded.data])
  return { ...loaded, all, name }
}

export const pauseAll = () => runAction('stump.calendar.pause', { action: 'pause', scope: 'all', idempotency_key: key() })
export const pauseAccount = (accountId: string) => runAction('stump.calendar.pause', { action: 'pause', scope: 'account', account_id: accountId, idempotency_key: key() })
export const resume = (scope: 'all' | 'account', accountId?: string | null) =>
  runAction<Resumed>('stump.calendar.pause', { action: 'resume', scope, ...(accountId ? { account_id: accountId } : {}), idempotency_key: key() })

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
/** "2:14 PM" today, "Oct 28, 2:14 PM" another day. */
export function shortTime(iso: string | null) {
  if (!iso) return ''
  const at = new Date(iso)
  return new Intl.DateTimeFormat('en-US', sameDay(at, new Date()) ? { hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(at)
}
const firstName = (name: string) => name.split(/\s+/)[0] ?? name
export const pausedLine = (scope: PauseScope, name: (id: string) => string) => `Publishing paused by ${firstName(name(scope.person_id))} at ${shortTime(scope.at)}`

/** What a resume let go and what it kept held, in plain counts with times. */
export function ResumeOutcome({ resumed }: { resumed: Resumed }) {
  const out = resumed.will_post.length, held = resumed.held_overdue.length
  return <div aria-live="polite">
    <div className="st-count-row"><span className="st-count">{out}</span><div><div className="st-name">{out === 1 ? 'post will go out' : 'will go out'}</div>
      {out ? <div className="st-meta">{resumed.will_post.map(item => shortTime(item.scheduled_at)).join(', ')}</div> : <div className="st-meta">Nothing was waiting.</div>}</div></div>
    <div className="st-count-row"><span className="st-count held">{held}</span><div><div className="st-name">{held === 1 ? 'overdue stays held' : 'overdue stay held'}</div>
      <div className="st-meta">{held ? 'Their time passed while paused. Reschedule or drop them.' : 'None passed its time while paused.'}</div></div></div>
  </div>
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
 * The top bar's Pause pill (SPEC §4.1): "Pause publishing" pauses everything
 * in one press; while paused it reads "Resume publishing" and opens the resume
 * popover, which shows what went out and what stayed held.
 */
export function PauseControl({ role }: { role: string | undefined }) {
  const { data, all } = usePause()
  const { busy, message, run } = useRun()
  const [open, setOpen] = useState(false)
  const [resumed, setResumed] = useState<Resumed | null>(null)
  const close = useCallback(() => { setOpen(false); setResumed(null) }, [])
  const ref = useDismiss(open, close)
  if (!data || !mayPause(role)) return null
  if (!all && !resumed) {
    return <Tip label="Pause publishing" side="below">
      <button type="button" className="st-pause" disabled={busy} onClick={() => void run(pauseAll).then(done => { if (done) pauseChanged() })}>
        <span className="st-pause-icon"><Icon name="pause" /></span><span className="st-pause-label">Pause publishing</span>
      </button>
    </Tip>
  }
  return <div className="st-pop-anchor" ref={ref}>
    <button type="button" className={all ? 'st-pause paused' : 'st-pause'} aria-expanded={open} aria-controls="st-resume" onClick={() => open ? close() : setOpen(true)}>
      <span className="st-pause-icon"><Icon name={all ? 'play' : 'pause'} /></span><span className="st-pause-label">{all ? 'Resume publishing' : 'Pause publishing'}</span>
    </button>
    {open ? <div className="st-popover" id="st-resume" role="dialog" aria-labelledby="st-resume-title">
      <p className="st-popover-title" id="st-resume-title">{resumed ? 'Publishing resumed' : 'Resume publishing'}</p>
      {resumed ? <ResumeOutcome resumed={resumed} />
        : <p className="st-meta">Posts due later go out at their time. Any whose time passed while paused stay held until you reschedule or drop them.</p>}
      <Outcome message={message} />
      <div className="st-actions">
        {resumed ? <button type="button" className="st-button primary" onClick={close}>Done</button> : <>
          <button type="button" className="st-button primary" disabled={busy} onClick={() => void run(() => resume('all')).then(result => { if (result) { setResumed(result); pauseChanged() } })}>Resume</button>
          <button type="button" className="st-button quiet" onClick={close}>Keep paused</button>
        </>}
      </div>
      {resumed ? null : <p className="st-note"><a href="/app/pause">Pause history and accounts</a></p>}
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
