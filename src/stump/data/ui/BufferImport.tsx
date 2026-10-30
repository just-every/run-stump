import { useState, type FormEvent } from 'react'
import { runAction } from '../../ui/api.ts'
import { FilePick, Outcome, useLoaded, useRun, when } from '../../ui/kit.tsx'
import { applyPlan, ImportError, planFile, undoPlan, type ImportSourceId, type Kept, type Plan } from '../../venues/ui/importer.ts'

// Switching from Buffer (STUMP-IMPORT-001): the file Buffer's API gives, its
// dry run, apply and Undo through the import door, and the queued posts that
// wait, paused, until the person confirms Buffer's queue is cleared.
const SOURCE = 'buffer' as ImportSourceId
const NETWORKS: Record<string, string> = { x: 'X', bluesky: 'Bluesky', mastodon: 'Mastodon', linkedin: 'LinkedIn' }
const key = () => crypto.randomUUID()
const WORDS: Record<string, string> = {
  source_raw_reader_failed: 'This file is not a Buffer export Stump can read. Use the JSON bundle of Buffer\'s profiles and their pending and sent updates.',
  owner_required: 'Only the owner can import.',
}
const explain = (error: unknown) => error instanceof ImportError ? WORDS[error.code] ?? `The import was refused: ${error.code.replace(/_/g, ' ')}.` : error instanceof Error ? error.message : 'Something went wrong. Try again.'
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

interface Item { id: string; state: string; network: string | null; account_id: string | null; text: string | null; scheduled_at: string | null; options: { imported_from?: string } }
interface Account { id: string; network: string; handle: string }
interface Summary { channels?: number; sent?: number; queued?: number }
interface Status { head: { planId?: string; job?: { state: string } } | null }

export function BufferImport() {
  const [plan, setPlan] = useState<Plan & { summary: Summary } | null>(null)
  const [kept, setKept] = useState<Kept[] | null>(null)
  const [released, setReleased] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async (work: () => Promise<void>) => { setBusy(true); setError(null); try { await work() } catch (cause) { setError(explain(cause)) } finally { setBusy(false) } }
  const { data, refresh } = useLoaded(async () => {
    const [items, accounts, status] = await Promise.all([
      runAction<{ items: Item[] }>('stump.drafts.revise', { action: 'list', state: 'paused' }),
      runAction<{ items: Account[] }>('stump.accounts.connect', { action: 'list', include_unconnected: true }),
      fetch(`/api/operator/import/status?source=${SOURCE}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' })
        .then(response => response.ok ? response.json() as Promise<Status> : { head: null }),
    ])
    const applied = status.head?.job?.state === 'completed' ? status.head.planId ?? null : null
    return { waiting: items.items.filter(item => item.options.imported_from === 'buffer'), accounts: new Map(accounts.items.map(account => [account.id, account])), applied }
  })

  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const file = new FormData(event.currentTarget).get('file') as File | null
    if (!file || !file.size) { setError('Choose the Buffer export first.'); return }
    await run(async () => { setPlan(await planFile(SOURCE, file) as Plan & { summary: Summary }); setKept(null) })
  }
  const nothing = plan && (plan.applied || (plan.summary.created === 0 && plan.summary.updated === 0 && !plan.changes.some(change => change.conflict)))

  return <section className="st-card st-buffer" aria-labelledby="buffer-title">
    <h2 id="buffer-title">Switch from Buffer</h2>
    <p className="st-meta">Your channels, sent posts with their results, posting schedules and queued posts. Nothing is written until you apply, and Undo takes it back.</p>
    {!plan ? <form onSubmit={review} className="st-spaced" aria-label="Buffer export">
      <FilePick name="file" label="Choose the Buffer export" accept=".json,application/json" />
      <div className="st-actions st-spaced">
        <button className="st-button primary" type="submit" disabled={busy}>{busy ? 'Reading…' : 'Review import'}</button>
        {data?.applied ? <button className="st-button" type="button" disabled={busy}
          onClick={() => void run(async () => { setKept((await undoPlan(SOURCE, data.applied!)).kept); await refresh() })}>Undo last import</button> : null}
      </div>
    </form> : <div className="st-spaced">
      <p className="st-name">{nothing ? 'Nothing new in this file. It matches what Stump already holds.'
        : `${plural(plan.summary.channels ?? 0, 'channel')} · ${plural(plan.summary.sent ?? 0, 'sent post')} · ${plural(plan.summary.queued ?? 0, 'queued post')}`}</p>
      {!nothing ? <p className="st-meta">Channels arrive as accounts that wait for their owners to connect. Queued posts arrive paused until you confirm Buffer's queue is cleared.</p> : null}
      {plan.existing?.length ? <><h3>Already in Stump</h3><ul className="st-list">{plan.existing.map(row => <li className="st-row" key={row.source_id}>
        <span className="st-row-main">{row.name ?? row.id}<div className="st-meta">{row.reason}</div></span></li>)}</ul></> : null}
      {plan.changes.length ? <><h3>Changed since the last import</h3><ul className="st-list">{plan.changes.map(change => <li className="st-row" key={change.source_id}>
        <span className="st-row-main" style={{ overflowWrap: 'anywhere' }}>{change.name ?? change.id}<div className="st-meta">{change.conflict ? 'Edited in Stump; your edit stays' : change.fields.map(field => field.field).join(', ')}</div></span></li>)}</ul></> : null}
      {plan.rejected.length ? <><h3>Not imported</h3><ul className="st-list">{plan.rejected.map(row => <li className="st-row" key={row.sourceId}>
        <span className="st-row-main"><span className="st-meta">{row.reason}</span></span></li>)}</ul></> : null}
      <div className="st-actions st-spaced">
        {!nothing ? <button className="st-button primary" type="button" disabled={busy}
          onClick={() => void run(async () => { await applyPlan(SOURCE, plan); setPlan(null); await refresh() })}>{busy ? 'Applying…' : 'Apply import'}</button> : null}
        <button className="st-button" type="button" disabled={busy} onClick={() => void run(async () => { if (!plan.applied) await undoPlan(SOURCE, plan.planId); setPlan(null) })}>{nothing ? 'Close' : 'Cancel'}</button>
      </div>
    </div>}
    {kept ? <p className="st-note" role="status">{kept.length ? `Undone. Kept ${plural(kept.length, 'record')} edited or used since: ${kept.map(item => item.name ?? item.id).join(', ')}.` : 'Undone. Everything the import created is gone.'}</p> : null}
    {error ? <p className="st-error" role="alert">{error}</p> : null}
    {released ? <p className="st-note" role="status">{released}</p> : null}
    {data?.waiting.length ? <Waiting items={data.waiting} accounts={data.accounts} onReleased={async text => { setReleased(text); await refresh() }} /> : null}
  </section>
}

/** Queued posts from Buffer, paused until the person confirms Buffer no longer holds them. */
function Waiting({ items, accounts, onReleased }: { items: Item[]; accounts: Map<string, Account>; onReleased(text: string): Promise<void> }) {
  const { busy, message, run } = useRun()
  const [cleared, setCleared] = useState(false)
  async function release() {
    const done = await run(() => runAction<{ released: string[]; held_overdue: string[]; still_paused: string[] }>('stump.calendar.plan',
      { action: 'release_import', item_ids: items.map(item => item.id), confirm_source_cleared: cleared, idempotency_key: key() }))
    if (done) {
      setCleared(false)
      await onReleased(`${plural(done.released.length, 'post')} back on the schedule${done.held_overdue.length ? `; ${done.held_overdue.length} past their time wait for you to reschedule` : ''}${done.still_paused.length ? `; ${done.still_paused.length} stay paused while publishing is paused` : ''}.`)
    }
  }
  return <div className="st-spaced">
    <h3>Waiting for Buffer's queue to clear</h3>
    <ul className="st-list st-box">{items.map(item => {
      const account = item.account_id ? accounts.get(item.account_id) : undefined
      return <li className="st-row" key={item.id}><span className="st-row-main">
        <div className="st-name" style={{ overflowWrap: 'anywhere' }}>{item.text}</div>
        <div className="st-meta">{account ? `${NETWORKS[account.network] ?? account.network} · ${account.handle}` : ''}{item.scheduled_at ? ` · ${when(item.scheduled_at)}` : ''}</div>
      </span></li>
    })}</ul>
    <label className="st-field st-check st-spaced"><input type="checkbox" checked={cleared} onChange={event => setCleared(event.target.checked)} />I removed these posts from Buffer's queue</label>
    <Outcome message={message} />
    <div className="st-actions st-spaced"><button className="st-button primary" type="button" disabled={busy || !cleared} onClick={() => void release()}>Release {plural(items.length, 'post')}</button></div>
  </div>
}
