import { useState, type FormEvent } from 'react'
import { runAction } from '../../ui/api.ts'
import { Outcome, useRun, SelectField } from '../../ui/kit.tsx'
import { DETAIL_LABELS, KIND_FIELDS, STATUS_LABELS, type KindId } from '../kinds.ts'
import type { Venue } from './types.ts'

const PRIORITIES = ['top', 'high', 'medium', 'low']
const detailText = (value: unknown) => Array.isArray(value) ? value.join(', ') : String(value ?? '')
const key = () => crypto.randomUUID()
/** What a detail holds, where its kind needs it written one way: a Slack workspace by its address, a Discord server by its id. */
const DETAIL_HINTS: Record<string, string> = { 'slack.workspace': 'name.slack.com', 'discord.server': 'Server id' }

function details(kind: KindId, form: FormData) {
  const out: Record<string, unknown> = {}
  for (const [name, type] of Object.entries(KIND_FIELDS[kind].details)) {
    const raw = String(form.get(`detail.${name}`) ?? '').trim()
    if (!raw) continue
    out[name] = type === 'integer' || type === 'number' ? Number(raw) : type === 'list' ? raw.split(',').map(item => item.trim()).filter(Boolean) : raw
  }
  return out
}

/**
 * Adding a venue, or editing its record: the fields every venue has and the
 * fields its kind needs. Opens inline (an empty register opens straight into it).
 */
export function VenueForm({ venue, onDone, onCancel, onImport }: { venue?: Venue; onDone(venue: Venue): void; onCancel(): void; onImport?(): void }) {
  const [kind, setKind] = useState<KindId>((venue?.kind as KindId | undefined) ?? 'subreddit')
  const { busy, message, run } = useRun()
  const fields = KIND_FIELDS[kind]
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget), text = (name: string) => String(form.get(name) ?? '').trim() || null
    const args = { kind, name: text('name'), url: text('url'), platform: text('platform'), priority: text('priority'), details: details(kind, form),
      audience: text('audience'), why: text('why'), ...(venue?.status === 'excluded' ? {} : { status: text('status') ?? 'candidate' }) }
    const saved = await run(() => runAction<Venue>('stump.venues.manage', venue
      ? { action: 'update', idempotency_key: key(), venue_id: venue.id, expected_revision: venue.revision, ...args }
      : { action: 'create', idempotency_key: key(), ...args }))
    if (saved) onDone(saved)
  }
  return <form className="st-card" onSubmit={submit} aria-label={venue ? 'Edit venue' : 'Add a venue'}>
    <h2>{venue ? 'Edit venue' : 'Add a venue'}</h2>
    <div className="st-form">
      <label className="st-field">Name<input name="name" required maxLength={200} defaultValue={venue?.name} autoComplete="off" /></label>
      <SelectField label="Kind" value={kind} onChange={event => setKind(event.target.value as KindId)}>
        {Object.entries(KIND_FIELDS).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}</SelectField>
      <label className="st-field">Address{fields.url ? '' : ' (optional)'}<input name="url" type="url" required={fields.url} maxLength={2048} defaultValue={venue?.url ?? ''} placeholder="https://" /></label>
      {venue?.status === 'excluded' ? null : <SelectField label="Status" name="status" defaultValue={venue?.status ?? 'candidate'}>
        {Object.entries(STATUS_LABELS).filter(([id]) => id !== 'excluded').map(([id, label]) => <option key={id} value={id}>{label}</option>)}</SelectField>}
      <SelectField label="Priority" name="priority" defaultValue={venue?.priority ?? ''}><option value="">None</option>{PRIORITIES.map(item => <option key={item} value={item}>{item[0]!.toUpperCase() + item.slice(1)}</option>)}</SelectField>
      <label className="st-field">Platform<input name="platform" maxLength={80} defaultValue={venue?.platform ?? ''} placeholder="Reddit, Discourse, Substack…" /></label>
      {Object.entries(fields.details).map(([name, type]) => <label className="st-field" key={`${kind}.${name}`}>{DETAIL_LABELS[name] ?? name}{(fields.required as readonly string[]).includes(name) ? '' : ' (optional)'}
        <input name={`detail.${name}`} type={type === 'date' ? 'date' : type === 'url' ? 'url' : type === 'integer' || type === 'number' ? 'number' : 'text'} min={type === 'integer' || type === 'number' ? 0 : undefined}
          step={type === 'number' ? 'any' : undefined} required={(fields.required as readonly string[]).includes(name)} placeholder={DETAIL_HINTS[`${kind}.${name}`] ?? (type === 'list' ? 'Separate with commas' : type === 'url' ? 'https://' : undefined)}
          defaultValue={detailText(venue?.kind === kind ? venue.details[name] : null)} />
      </label>)}
      <label className="st-field">Who reads it<input name="audience" maxLength={2000} defaultValue={venue?.audience ?? ''} /></label>
      <label className="st-field">Why it matters<input name="why" maxLength={2000} defaultValue={venue?.why ?? ''} /></label>
    </div>
    <Outcome message={message} />
    <div className="st-actions">
      <button className="st-button primary pill" type="submit" disabled={busy}>{venue ? 'Save venue' : 'Add venue'}</button>
      <button className="st-button pill" type="button" onClick={onCancel}>Cancel</button>
      {onImport ? <button className="st-button pill outline" type="button" onClick={onImport}>Import a venue list instead</button> : null}
    </div>
  </form>
}
