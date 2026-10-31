import { createFileRoute } from '@tanstack/react-router'
import { Fragment, useEffect, useMemo, useState, type FormEvent } from 'react'
import { HydrationUnit } from '../base/hydration/unit'
import type { LedgerEntry } from '../stump/ledger/entry.ts'
import { screenStyles } from '../stump/ledger/screen-styles.ts'
import { NETWORK_OPTIONS, ROUTE_WORDS, STATE_WORDS, networkName } from '../stump/ledger/words.ts'
import { me, runAction } from '../stump/ui/api.ts'
import { Chip, Empty, Outcome, useLoaded, useRun, when } from '../stump/ui/kit.tsx'
import type { Team } from '../stump/ui/types.ts'
import { Icon } from '../stump/ui/icons.tsx'

export const Route = createFileRoute('/app/ledger')({ component: LedgerPage })

interface Page { items: LedgerEntry[]; total: number }
type Filters = Partial<Record<'q' | 'network' | 'route' | 'state' | 'campaign' | 'from' | 'to' | 'venue_id' | 'person_id', string>>
const STEP = 50
const key = () => crypto.randomUUID()
const LABELS: Record<string, string> = { q: 'Text', network: 'Network', route: 'Route', state: 'State', campaign: 'Campaign', from: 'From', to: 'To', venue_id: 'Venue', person_id: 'Person' }

function LedgerPage() {
  const [filters, setFilters] = useState<Filters>({})
  const [names, setNames] = useState<Record<string, string>>({})
  const [typed, setTyped] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [limit, setLimit] = useState(STEP)
  const [openId, setOpenId] = useState<string | null>(null)
  const { busy, message, run } = useRun()
  const context = useLoaded(async () => ({ me: await me(), team: await runAction<Team>('stump.team.manage', { action: 'list' }).catch(() => ({ items: [], total: 0 }) as Team) }))
  const query = useMemo(() => ({ action: 'search', ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)), limit }), [filters, limit])
  const { data, error, refresh } = useLoaded(() => runAction<Page>('stump.ledger.search', query))
  useEffect(() => { void refresh() }, [query, refresh])
  useEffect(() => { const timer = setTimeout(() => { setLimit(STEP); setFilters(current => ({ ...current, q: typed.trim() || undefined })) }, 250); return () => clearTimeout(timer) }, [typed])

  const person = (id: string | null) => context.data?.team.items.find(item => item.id === id)?.display_name ?? null
  // A hand-off was posted by hand by its member: Who names them, and the agent on the record (it prepared the brief or recorded the link) reads as a quiet line under it.
  // Every other entry reads "<agent> for <person>" as the record says.
  const who = (entry: LedgerEntry) => handedOff(entry) && entry.agent && entry.by.startsWith(`${entry.agent.name} for `) ? entry.by.slice(entry.agent.name.length + 5) : entry.by
  const applied = Object.entries(filters).filter(([, value]) => value) as Array<[keyof Filters, string]>
  const label = (field: keyof Filters, value: string) =>
    field === 'person_id' ? person(value) ?? 'someone' : field === 'venue_id' ? names[value] ?? 'a venue' : field === 'network' ? networkName(value) : field === 'route' ? ROUTE_WORDS[value] ?? value : field === 'state' ? STATE_WORDS[value] ?? value : value
  const set = (field: keyof Filters, value: string | undefined) => { setLimit(STEP); setFilters(current => ({ ...current, [field]: value || undefined })) }
  const mayCorrect = context.data ? ['owner', 'admin', 'editor'].includes(context.data.me.person.role) : false
  const admin = context.data ? ['owner', 'admin'].includes(context.data.me.person.role) : false
  // Nothing on the ledger at all: the family empty state, with no search, filters or export over an empty list.
  const none = !!data && data.total === 0 && !applied.length && !typed.trim()
  const writer = context.data ? ['owner', 'admin', 'editor', 'contributor'].includes(context.data.me.person.role) : false

  async function exportCsv() {
    const { action: _action, limit: _limit, ...view } = query
    const result = await run(() => runAction<{ csv: string; rows: number; total: number; truncated: boolean }>('stump.ledger.search', { action: 'export_csv', ...view }),
      done => done.truncated ? `Exported the first ${done.rows} of ${done.total}. Narrow the filters for the rest.` : `Exported ${done.rows} ${done.rows === 1 ? 'entry' : 'entries'}.`)
    if (!result) return
    const url = URL.createObjectURL(new Blob([result.csv], { type: 'text/csv;charset=utf-8' })), link = document.createElement('a')
    // Named for the person's own day, the one the ledger's times are shown in, never the UTC date.
    const today = new Date(), day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    link.href = url; link.download = `stump-ledger-${day}.csv`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <HydrationUnit>
    <style>{screenStyles}</style>
    <section className="st-page st-ledger-screen" aria-labelledby="ledger-title">
      <h1 id="ledger-title">Ledger</h1>
      {none ? <Empty title="Nothing on the ledger yet" actions={writer ? <a className="st-button primary" href="/app/compose">Write a post</a> : undefined}>
        Every post appears here the moment it goes out or a member posts it by hand.</Empty> : null}
      {data && !none ? <div className="st-bar" role="search">
        <div className="st-search-field"><Icon name="search" /><input className="st-search" type="search" aria-label="Search ledger" placeholder="Search ledger…" value={typed} onChange={event => setTyped(event.target.value)} /></div>
        <button className="st-button" type="button" aria-expanded={showFilters} onClick={() => setShowFilters(shown => !shown)}>Filters{applied.filter(([field]) => field !== 'q').length ? ` (${applied.filter(([field]) => field !== 'q').length})` : ''}</button>
        <button className="st-button primary" type="button" disabled={busy || !data?.total} onClick={() => void exportCsv()}>Export CSV</button>
      </div> : null}
      {showFilters ? <div className="st-panel">
        <div className="st-form">
          <label className="st-field">Network<input list="ledger-networks" value={filters.network ?? ''} maxLength={60} placeholder="Any" autoComplete="off" onChange={event => set('network', event.target.value.trim().toLowerCase())} />
            <datalist id="ledger-networks">{NETWORK_OPTIONS.map(item => <option key={item} value={item}>{networkName(item)}</option>)}</datalist></label>
          <label className="st-field">Route<select value={filters.route ?? ''} onChange={event => set('route', event.target.value)}>
            <option value="">Any</option>{Object.entries(ROUTE_WORDS).map(([id, word]) => <option key={id} value={id}>{word}</option>)}</select></label>
          <label className="st-field">State<select value={filters.state ?? ''} onChange={event => set('state', event.target.value)}>
            <option value="">Any</option>{Object.entries(STATE_WORDS).map(([id, word]) => <option key={id} value={id}>{word}</option>)}</select></label>
          <label className="st-field">Person<select value={filters.person_id ?? ''} onChange={event => set('person_id', event.target.value)}>
            <option value="">Anyone</option>{context.data?.team.items.map(item => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select></label>
          <label className="st-field">Campaign<input value={filters.campaign ?? ''} maxLength={120} onChange={event => set('campaign', event.target.value)} /></label>
          <label className="st-field">From<input type="date" value={filters.from ?? ''} onChange={event => set('from', event.target.value)} /></label>
          <label className="st-field">To<input type="date" value={filters.to ?? ''} onChange={event => set('to', event.target.value)} /></label>
        </div>
      </div> : null}
      {applied.filter(([field]) => field !== 'q').length ? <div className="st-chips">
        {applied.filter(([field]) => field !== 'q').map(([field, value]) => <button key={field} type="button" className="st-chip" aria-label={`Remove filter ${LABELS[field]}: ${label(field, value)}`} onClick={() => set(field, undefined)}>{LABELS[field]}: {label(field, value)} ×</button>)}
        <button type="button" className="st-chip" onClick={() => { setTyped(''); setFilters({}); setLimit(STEP) }}>Clear all</button>
      </div> : null}
      {error ? <p className="st-error">{error}</p> : null}
      <Outcome message={message} />
      {data && !none ? <p className="st-meta" role="status">{data.total} {data.total === 1 ? 'entry' : 'entries'}</p> : null}
      {data && !none && !data.items.length ? <p>No entries match these filters.</p> : null}
      {data?.items.length ? <div className="st-table-panel"><table className="st-table">
        <thead><tr><th scope="col">When</th><th scope="col">Where</th><th scope="col">Who</th><th scope="col">Route</th><th scope="col">State</th><th scope="col">Link</th></tr></thead>
        <tbody>{data.items.map(entry => {
          const open = openId === entry.id, at = entry.posted_at
          return <Fragment key={entry.id}>
            {/* The whole row opens its entry; its links and buttons keep their own actions. */}
            <tr className={`entry${open ? ' open' : ''}`} onClick={event => { if (!(event.target as HTMLElement).closest('a, button')) setOpenId(open ? null : entry.id) }}>
              <td className="when"><button className="st-row-button" type="button" aria-expanded={open} aria-controls={`entry-${entry.id}`} onClick={() => setOpenId(open ? null : entry.id)}>{at ? when(at) : 'Not posted'}</button></td>
              <td className="where">{entry.venue_name ?? networkName(entry.network)}</td>
              <td className="who">{who(entry)}
                {handedOff(entry) && entry.agent ? <span className="st-quiet">agent: {entry.agent.name}</span> : null}</td>
              <td className="route">{ROUTE_WORDS[entry.route as string] ?? String(entry.route)}</td>
              <td className="state"><StateChip state={String(entry.state)} />
                {entry.confirmation === 'person' && entry.state === 'posted' ? <span className="st-quiet">confirmed by {person(entry.person_id) ?? 'the member'}</span> : null}</td>
              <td className="link">{entry.url ? <a href={String(entry.url)} target="_blank" rel="noreferrer noopener" aria-label={`View post on ${networkName(entry.network) || 'the network'}`}>View ↗</a> : null}</td>
              <td className="st-phone">
                <button className="st-row-button" type="button" aria-expanded={open} aria-controls={`entry-${entry.id}`} onClick={() => setOpenId(open ? null : entry.id)}>
                  <span className="st-phone-main">{[entry.venue_name ?? networkName(entry.network), who(entry)].filter(Boolean).join(' · ')}</span>
                  <span className="st-phone-meta">{[at ? when(at) : 'Not posted', ROUTE_WORDS[entry.route as string] ?? entry.route, STATE_WORDS[entry.state as string] ?? entry.state].filter(Boolean).join(' · ')}</span>
                </button>
                {entry.url ? <a href={String(entry.url)} target="_blank" rel="noreferrer noopener" aria-label={`View post on ${networkName(entry.network) || 'the network'}`}>View ↗</a> : null}
              </td>
            </tr>
            {open ? <tr className="detail-row" id={`entry-${entry.id}`}><td colSpan={7}><Detail entry={entry} mayCorrect={mayCorrect} admin={admin} person={person} onChange={() => void refresh()}
              onVenue={entry.venue_id && entry.venue_name && !filters.venue_id ? () => { setNames(current => ({ ...current, [entry.venue_id!]: entry.venue_name! })); set('venue_id', entry.venue_id!) } : null}
              onPerson={entry.person_id && !filters.person_id ? () => set('person_id', entry.person_id!) : null} /></td></tr> : null}
          </Fragment>
        })}</tbody>
      </table></div> : null}
      {data && data.items.length < data.total ? <div className="st-show-more"><button className="st-button" type="button" onClick={() => setLimit(current => current + STEP)}>Show more</button></div> : null}
    </section>
  </HydrationUnit>
}

const handedOff = (entry: LedgerEntry) => entry.route === 'handed_off'

/** A ledger state as a chip: Posted on the success tint with its dot, a failure on the danger tint, the rest neutral. */
function StateChip({ state }: { state: string }) {
  const tone = state === 'posted' ? 'success' : state === 'failed' ? 'danger' : state === 'uncertain' || state === 'removed' ? 'held' : 'neutral'
  return <Chip tone={tone}>{tone === 'success' ? <span className="st-dot" aria-hidden="true" /> : null}{STATE_WORDS[state] ?? state}</Chip>
}

function Detail({ entry, mayCorrect, admin, person, onChange, onVenue, onPerson }: { entry: LedgerEntry; mayCorrect: boolean; admin: boolean; person(id: string | null): string | null; onChange(): void; onVenue: (() => void) | null; onPerson: (() => void) | null }) {
  const [mode, setMode] = useState<'correct' | 'remove' | 'hold' | null>(null)
  const { busy, message, run } = useRun()
  const done = (text: string) => () => { setMode(null); onChange(); return text }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget), note = String(form.get('note') ?? '').trim()
    if (mode === 'correct') {
      const text = String(form.get('text') ?? '').trim(), url = String(form.get('url') ?? '').trim()
      await run(() => runAction('stump.ledger.correct', { action: 'correct', idempotency_key: key(), entry_id: entry.id, note, ...(text && text !== entry.text ? { text } : {}), ...(url && url !== entry.url ? { url } : {}) }), done('Correction recorded as a new version.'))
    } else if (mode === 'remove') await run(() => runAction('stump.ledger.correct', { action: 'mark_removed', idempotency_key: key(), entry_id: entry.id, reason: note }), done('Marked removed. It stays on the record.'))
    else if (mode === 'hold') await run(() => runAction('stump.ledger.correct', { action: 'legal_hold', idempotency_key: key(), entry_id: entry.id, reason: note }), done('Legal hold recorded.'))
  }
  const removal = entry.removal as { reason: string; at: string } | null, hold = entry.legal_hold as { reason: string } | null
  return <div className="st-detail">
    <div><h3>What went out</h3><pre>{entry.text ?? ''}</pre></div>
    <div className="st-meta">
      {[entry.disclosure_line ? `Disclosure: ${entry.disclosure_line}` : null, entry.campaign ? `Campaign ${entry.campaign}` : null, entry.network_id ? `${networkName(entry.network) || 'Network'} id ${entry.network_id}` : null,
        entry.confirmation === 'network' ? 'Read back from the network' : entry.confirmation === 'person' ? `Link recorded by ${person(entry.person_id) ?? 'the member'}` : null,
        entry.charge_usd ? `Charge $${Number(entry.charge_usd).toFixed(2)}` : null, entry.utm_content ? `Links tagged utm_content=${entry.utm_content}` : null].filter(Boolean).join(' · ')}
    </div>
    {removal ? <p className="st-error">Removed by the venue: {removal.reason}</p> : null}
    {hold ? <p className="st-note">Legal hold: {hold.reason}</p> : null}
    <div>
      <h3>Versions</h3>
      <ul className="st-versions">{[...entry.versions].reverse().map((version, index) => <li key={version.version}>
        <div className="st-name">Version {version.version}{index === 0 ? ' (current)' : ''}</div>
        <div className="st-meta">{when(version.at)}{version.note ? ` · ${version.note}` : ''}</div>
        {version.text && version.text !== entry.text ? <div style={{ whiteSpace: 'pre-wrap' }}>{version.text}</div> : null}
      </li>)}</ul>
    </div>
    {onVenue || onPerson ? <p className="st-meta st-detail-filters">Show only {onVenue ? <button className="st-row-button" type="button" onClick={onVenue}>{entry.venue_name}</button> : null}
      {onVenue && onPerson ? ' · ' : null}{onPerson ? <button className="st-row-button" type="button" onClick={onPerson}>{person(entry.person_id) ?? 'this person'}</button> : null}</p> : null}
    {mayCorrect && !mode ? <div className="st-actions">
      <button className="st-button" type="button" onClick={() => setMode('correct')}>Correct</button>
      {entry.state === 'posted' || entry.state === 'uncertain' ? <button className="st-button" type="button" onClick={() => setMode('remove')}>Mark removed</button> : null}
      {admin && !hold ? <button className="st-button" type="button" onClick={() => setMode('hold')}>Legal hold</button> : null}
    </div> : null}
    {mode ? <form onSubmit={submit} aria-label={mode === 'correct' ? 'Correct entry' : mode === 'remove' ? 'Mark removed' : 'Legal hold'}>
      <div className="st-form">
        {mode === 'correct' ? <>
          <label className="st-field">Text<textarea name="text" defaultValue={entry.text ?? ''} maxLength={20000} /></label>
          <label className="st-field">Link<input name="url" defaultValue={entry.url ?? ''} maxLength={2048} /></label>
        </> : null}
        <label className="st-field">{mode === 'correct' ? 'What was wrong?' : mode === 'remove' ? 'Why was it removed?' : 'Why hold it?'}<input name="note" required maxLength={500} autoComplete="off" /></label>
      </div>
      <div className="st-actions" style={{ marginTop: 12 }}>
        <button className="st-button primary" type="submit" disabled={busy}>{mode === 'correct' ? 'Save correction' : mode === 'remove' ? 'Mark removed' : 'Hold'}</button>
        <button className="st-button" type="button" onClick={() => setMode(null)}>Cancel</button>
      </div>
    </form> : null}
    <Outcome message={message} />
  </div>
}
