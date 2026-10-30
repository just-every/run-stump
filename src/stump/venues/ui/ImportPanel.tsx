import { useState, type FormEvent } from 'react'
import { applyPlan, ImportError, planFile, undoPlan, type ImportSourceId, type Kept, type Plan } from './importer.ts'

const SOURCES: Array<{ id: ImportSourceId; label: string; accept: string }> = [
  { id: 'outreach-md', label: 'Venue list (Markdown)', accept: '.md,.markdown,text/markdown,text/plain' },
  { id: 'venues-csv', label: 'Spreadsheet (CSV)', accept: '.csv,text/csv' },
]
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const WORDS: Record<string, string> = {
  source_raw_reader_failed: 'This file is not a venue list Stump can read. Use the Markdown venue list or a CSV with the same column names.',
  owner_required: 'Only the owner can import.', origin_required: 'Reload the page and try again.',
  namespace_has_pending_import: 'An earlier import of this kind is still waiting. Apply or undo it first.',
  import_superseded: 'A newer import holds these records. Undo the newer one first.',
}
const explain = (error: unknown) => error instanceof ImportError ? WORDS[error.code] ?? `The import was refused: ${error.code.replace(/_/g, ' ')}.` : 'Something went wrong. Try again.'

/** The import entry point: choose the file, read its dry run, apply it, and undo it. */
export function ImportPanel({ onChanged, onClose }: { onChanged(): void; onClose(): void }) {
  const [source, setSource] = useState<ImportSourceId>('outreach-md')
  const [plan, setPlan] = useState<Plan | null>(null)
  const [applied, setApplied] = useState(false)
  const [kept, setKept] = useState<Kept[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (work: () => Promise<void>) => { setBusy(true); setError(null); try { await work() } catch (cause) { setError(explain(cause)) } finally { setBusy(false) } }

  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const file = (new FormData(event.currentTarget).get('file') as File | null)
    if (!file || !file.size) { setError('Choose a file first.'); return }
    await run(async () => { setPlan(await planFile(source, file)); setApplied(false); setKept(null) })
  }
  // Refused rows are listed on their own; a conflict is a record edited here since the last import.
  const conflicts = (plan?.differences.conflicts ?? []).map(key => JSON.parse(key) as [string, string]).filter(([kind]) => kind !== 'rejected')
  const nothing = plan && plan.summary.created === 0 && plan.summary.updated === 0 && conflicts.length === 0

  return <section className="st-card" aria-labelledby="import-title">
    <h2 id="import-title">Import a venue list</h2>
    {!plan ? <form onSubmit={review}>
      <div className="st-form">
        <label className="st-field">Format<select value={source} onChange={event => setSource(event.target.value as ImportSourceId)}>{SOURCES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label className="st-field">File<input name="file" type="file" accept={SOURCES.find(item => item.id === source)!.accept} required /></label>
      </div>
      <p className="st-note">Stump reads the file and shows what it would add. Nothing changes until you apply it.</p>
      {error ? <p className="st-error" role="alert">{error}</p> : null}
      <div className="st-actions">
        <button className="st-button primary pill" type="submit" disabled={busy}>{busy ? 'Reading…' : 'Review import'}</button>
        <button className="st-button pill" type="button" onClick={onClose}>Cancel</button>
      </div>
    </form> : <div>
      <div className="st-counts" aria-label="What the file holds">
        <div><strong>{plan.summary.venues ?? 0}</strong>venues</div>
        <div><strong>{plan.summary.entries ?? 0}</strong>entries</div>
        <div><strong>{plan.summary.excluded ?? 0}</strong>excluded</div>
        <div><strong>{plan.rejected.length}</strong>refused rows</div>
      </div>
      <p>{applied ? 'Imported.' : nothing ? 'Everything in this file is already in Stump. Applying it changes nothing.'
        : `Applying adds ${plural(plan.summary.created, 'record')}${plan.summary.updated ? ` and updates ${plural(plan.summary.updated, 'record')}` : ''}.`}</p>
      {conflicts.length ? <>
        <h3>Changed here since the last import</h3>
        <p className="st-note">These were edited in Stump, so the import leaves them as they are.</p>
        <ul className="st-list">{conflicts.map(([kind, id]) => <li className="st-row" key={`${kind}|${id}`}><span className="st-row-main">{id.replace(/^(venue|product|outreach-entry):(name:)?/, '')}<div className="st-meta">{kind === 'draft' ? 'entry' : kind}</div></span></li>)}</ul>
      </> : null}
      {plan.rejected.length ? <>
        <h3>Refused rows</h3>
        <ul className="st-list">{plan.rejected.map(row => <li className="st-row" key={row.sourceId}><span className="st-row-main"><span className="st-meta">{row.reason}</span></span></li>)}</ul>
      </> : null}
      {kept ? <>
        <h3>Undone</h3>
        <p>{kept.length ? `Kept ${plural(kept.length, 'record')} that changed since or that something else uses:` : 'Everything the import added is gone.'}</p>
        {kept.length ? <ul className="st-list">{kept.map(item => <li className="st-row" key={item.id}><span className="st-row-main">{item.name ?? item.id}<div className="st-meta">{item.kind} · {item.reason === 'edited' ? 'edited since' : 'in use'}</div></span></li>)}</ul> : null}
      </> : null}
      {error ? <p className="st-error" role="alert">{error}</p> : null}
      <div className="st-actions">
        {!applied && !kept ? <button className="st-button primary pill" type="button" disabled={busy}
          onClick={() => void run(async () => { await applyPlan(source, plan); setApplied(true); onChanged() })}>{busy ? 'Applying…' : 'Apply import'}</button> : null}
        {applied && !kept ? <button className="st-button pill outline" type="button" disabled={busy}
          onClick={() => void run(async () => { setKept((await undoPlan(source, plan.planId)).kept); onChanged() })}>Undo import</button> : null}
        {applied || kept ? <button className="st-button pill" type="button" onClick={onClose}>Done</button>
          // An unapplied plan holds the source's place in line; cancelling removes it.
          : <button className="st-button pill" type="button" disabled={busy} onClick={() => void run(async () => { await undoPlan(source, plan.planId); onClose() })}>Cancel</button>}
      </div>
    </div>}
  </section>
}
