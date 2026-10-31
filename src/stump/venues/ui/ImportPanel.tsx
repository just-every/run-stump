import { useState, type FormEvent } from 'react'
import { FilePick } from '../../ui/kit.tsx'
import { applyPlan, ImportError, importStatus, planFile, undoPlan, type Change, type ImportSourceId, type Kept, type Plan } from './importer.ts'

const SOURCES: Array<{ id: ImportSourceId; label: string; accept: string }> = [
  { id: 'outreach-md', label: 'Venue list (Markdown)', accept: '.md,.markdown,text/markdown,text/plain' },
  { id: 'venues-csv', label: 'Spreadsheet (CSV)', accept: '.csv,text/csv' },
]
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const WORDS: Record<string, string> = {
  source_raw_reader_failed: 'This file is not a venue list Stump can read. Use the Markdown venue list or a CSV with the same column names.',
  owner_required: 'Only the owner can import.', origin_required: 'Reload the page and try again.',
  namespace_has_pending_import: 'An earlier import of this kind is still being applied. Try again once it finishes.',
  import_superseded: 'A newer import holds these records. Undo the newer one first.',
  earlier_import_holds_records: 'An earlier import of this list still holds some of these rows, and an erasure removed its saved copy, so this file cannot be compared with it. Undo that import and any import of this list since, then upload this file again. Anything edited or used in Stump since stays as it is.',
}
/** Codes Stump explains in its own words, ahead of the door's. */
const OWN_WORDS = new Set(['earlier_import_holds_records'])
const words = (field: string) => field.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
/** A field's value as a person reads it: a rule by its value, a list by its items. */
function shown(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'none'
  if (Array.isArray(value)) return value.length ? value.map(shown).join(', ') : 'none'
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>
    if (Object.hasOwn(object, 'value')) return shown(object.value)
    const parts = Object.entries(object).filter(([, item]) => item !== null && item !== undefined).map(([key, item]) => `${words(key).toLowerCase()} ${shown(item)}`)
    return parts.join('; ') || 'none'
  }
  return String(value)
}
const clip = (text: string) => text.length > 160 ? `${text.slice(0, 157)}…` : text

/** One changed row of the file: its name, and each field as Stump holds it now and as the file has it. */
function ChangeRow({ change }: { change: Change }) {
  return <li className="st-row" style={{ alignItems: 'flex-start' }}>
    <span className="st-row-main" style={{ overflowWrap: 'anywhere' }}>{change.name ?? change.source_id.replace(/^(venue|product):(name:)?/, '')}
      <div className="st-meta">{change.kind}{change.conflict ? ' · edited in Stump since the last import, so applying keeps your edit' : ' · applying takes the file\'s values'}</div>
      {change.fields.length ? <dl style={{ margin: '6px 0 0' }}>{change.fields.map(field => <div key={field.field} className="st-meta">
        <dt style={{ display: 'inline', fontWeight: 600 }}>{words(field.field)}: </dt>
        <dd style={{ display: 'inline', margin: 0 }}>{clip(shown(field.before))} → {clip(shown(field.after))}</dd>
      </div>)}</dl> : null}
    </span>
  </li>
}

// The reader's own words say what it expected (a heading, a column); otherwise the code in plain words.
const explain = (error: unknown) => error instanceof ImportError ? (OWN_WORDS.has(error.code) ? WORDS[error.code] : null) ?? (typeof error.details.reason === 'string' ? error.details.reason : null) ?? WORDS[error.code] ?? `The import was refused: ${error.code.replace(/_/g, ' ')}.` : 'Something went wrong. Try again.'
/** The earlier imports a refusal names as still holding rows of this file. */
const holdersOf = (error: unknown) => error instanceof ImportError && error.code === 'earlier_import_holds_records' && Array.isArray(error.details.planIds) ? error.details.planIds.filter((id): id is string => typeof id === 'string') : []

/**
 * Undoes the list's imports from the newest down until the named earlier ones are undone: an import with
 * a newer one over it is undone only after that one.
 */
async function undoThrough(source: ImportSourceId, plans: string[]): Promise<Kept[]> {
  const kept: Kept[] = [], left = new Set(plans), undone = new Set<string>()
  while (left.size) {
    const head = (await importStatus(source)).head?.planId
    // No applied import left, or one that is still the newest after its Undo: the door says why on the next try.
    if (!head || undone.has(head)) throw new ImportError('import_superseded')
    kept.push(...(await undoPlan(source, head)).kept)
    undone.add(head); left.delete(head)
  }
  return kept
}

/** The import entry point: choose the file, read its dry run, apply it, and undo it. */
export function ImportPanel({ onChanged, onClose }: { onChanged(): void; onClose(): void }) {
  const [source, setSource] = useState<ImportSourceId>('outreach-md')
  const [plan, setPlan] = useState<Plan | null>(null)
  const [applied, setApplied] = useState(false)
  const [kept, setKept] = useState<Kept[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [holders, setHolders] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const run = async (work: () => Promise<void>) => { setBusy(true); setError(null); setNotice(null); setHolders([]); try { await work() } catch (cause) { setError(explain(cause)); setHolders(holdersOf(cause)) } finally { setBusy(false) } }

  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const file = (new FormData(event.currentTarget).get('file') as File | null)
    if (!file || !file.size) { setError('Choose a file first.'); return }
    await run(async () => { setPlan(await planFile(source, file)); setApplied(false); setKept(null) })
  }
  // Refused rows are listed on their own; a changed row shows each field before and after, and a conflict is one edited here since the last import.
  const changes = plan?.changes ?? [], conflicts = changes.filter(change => change.conflict), replaced = changes.filter(change => !change.conflict)
  const nothing = plan && (plan.applied || (plan.summary.created === 0 && plan.summary.updated === 0 && conflicts.length === 0))
  // Nothing to apply because every row was refused, not because it is all in Stump already.
  const allRefused = !!plan && plan.rejected.length > 0 && (plan.summary.venues ?? 0) + (plan.summary.entries ?? 0) + (plan.summary.excluded ?? 0) === 0
  const gone = plan?.differences.gone.length ?? 0
  // Products are bookkeeping here; the venues and entries are what a person recognises.
  const already = (plan?.existing ?? []).filter(row => row.kind !== 'product')

  return <section className="st-card" aria-labelledby="import-title">
    <h2 id="import-title">Import a venue list</h2>
    {!plan ? <form onSubmit={review}>
      <div className="st-form">
        <label className="st-field">Format<select value={source} onChange={event => setSource(event.target.value as ImportSourceId)}>{SOURCES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <FilePick name="file" label="Choose the file" accept={SOURCES.find(item => item.id === source)!.accept} />
      </div>
      <p className="st-note">Stump reads the file and shows what it would add. Nothing changes until you apply it.</p>
      {error ? <p className="st-error" role="alert">{error}</p> : null}
      {holders.length ? <div className="st-actions"><button className="st-button pill outline" type="button" disabled={busy}
        onClick={() => void run(async () => { const undone = await undoThrough(source, holders); onChanged(); setNotice(`Earlier imports undone${undone.length ? `; ${plural(undone.length, 'record')} edited or in use since stayed` : ''}. Upload the file again.`) })}>Undo earlier imports</button></div> : null}
      {notice ? <p className="st-note" role="status">{notice}</p> : null}
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
      <p>{applied ? 'Imported.' : allRefused ? 'Every row in this file was refused, so there is nothing to apply. Fix the rows below and upload it again.'
        : nothing ? 'Everything in this file is already in Stump. There is nothing to apply.'
        : `Applying adds ${plural(plan.summary.created, 'record')}${plan.summary.updated ? ` and updates ${plural(plan.summary.updated, 'record')}` : ''}.`}
        {gone && !applied && !allRefused ? ` ${plural(gone, 'row')} from the last import ${gone === 1 ? 'is' : 'are'} not in this file; Stump keeps ${gone === 1 ? 'it' : 'them'}.` : ''}</p>
      {replaced.length && !applied ? <>
        <h3>Changed in this file</h3>
        <ul className="st-list">{replaced.map(change => <ChangeRow key={change.source_id} change={change} />)}</ul>
      </> : null}
      {conflicts.length && !applied ? <>
        <h3>Changed here since the last import</h3>
        <p className="st-note">These were edited in Stump. The import leaves them as they are; edit them yourself to take the file's values.</p>
        <ul className="st-list">{conflicts.map(change => <ChangeRow key={change.source_id} change={change} />)}</ul>
      </> : null}
      {already.length && !applied && !kept ? <>
        <h3>Already in Stump</h3>
        <p className="st-note">The import keeps these as they are, and the list's entries attach to them.</p>
        <ul className="st-list">{already.map(row => <li className="st-row" key={row.source_id}><span className="st-row-main" style={{ overflowWrap: 'anywhere' }}>{row.name ?? row.id}<div className="st-meta">{row.kind}</div></span></li>)}</ul>
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
        {!applied && !kept && !plan.applied && !allRefused ? <button className="st-button primary pill" type="button" disabled={busy}
          onClick={() => void run(async () => { await applyPlan(source, plan); setApplied(true); onChanged() })}>{busy ? 'Applying…' : 'Apply import'}</button> : null}
        {applied && !kept ? <button className="st-button pill outline" type="button" disabled={busy}
          onClick={() => void run(async () => { setKept((await undoPlan(source, plan.planId)).kept); onChanged() })}>Undo import</button> : null}
        {applied || kept || plan.applied ? <button className="st-button pill" type="button" onClick={onClose}>Done</button>
          // An unapplied plan holds the source's place in line; cancelling removes it.
          : <button className="st-button pill" type="button" disabled={busy} onClick={() => void run(async () => { await undoPlan(source, plan.planId); onClose() })}>Cancel</button>}
      </div>
    </div>}
  </section>
}
