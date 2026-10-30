import { Link } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { HydrationUnit } from '../../../base/hydration/unit'
import { me, runAction } from '../../ui/api.ts'
import { Outcome, Tip, useLoaded, useRun } from '../../ui/kit.tsx'
import type { Team } from '../../ui/types.ts'
import { DETAIL_LABELS } from '../kinds.ts'
import { kindLabel, limitWords, nextOpen, routeLabel, statusLabel, statusTone } from './labels.ts'
import { RulesCard } from './RulesCard.tsx'
import type { Members, RouteAnswer, Venue, VenueItem } from './types.ts'
import { VenueForm } from './VenueForm.tsx'

const key = () => crypto.randomUUID()
const PERIODS = ['day', 'week', 'month', 'quarter', 'year']

/** One venue: its rules with their sources, the routes they allow, the shared limit and its members (STUMP-VENUE-002, -003, -006). */
export function VenuePage({ venueId }: { venueId: string }) {
  const { data, error, refresh } = useLoaded(async () => {
    const [who, got, routes, members, team] = await Promise.all([
      me(), runAction<Venue & { items: VenueItem[] }>('stump.venues.manage', { action: 'get', venue_id: venueId }),
      runAction<RouteAnswer>('stump.venues.rules', { action: 'routes', venue_id: venueId }),
      runAction<Members>('stump.venues.members', { action: 'list', venue_id: venueId }),
      runAction<Team>('stump.team.manage', { action: 'list' }),
    ])
    const { items, ...venue } = got
    return { who, venue: venue as Venue, items, routes, members, team }
  })
  const [editing, setEditing] = useState(false)
  const editor = data ? ['owner', 'admin', 'editor'].includes(data.who.person.role) : false
  const venue = data?.venue
  const changed = () => { void refresh() }
  return <HydrationUnit>
    <section className="st-page" aria-labelledby="venue-title" style={{ maxWidth: 1120 }}>
      <Link className="st-back" to="/app/venues">← All venues</Link>
      {error ? <p className="st-error" role="alert">{error}</p> : null}
      {venue ? <>
        <div className="st-toolbar" style={{ marginBottom: 4, alignItems: 'flex-start' }}>
          <h1 id="venue-title" style={{ flex: '1 1 auto', overflowWrap: 'anywhere' }}>{venue.name}</h1>
          {editor ? <VenueMenu venue={venue} onEdit={() => setEditing(true)} onChanged={changed} /> : null}
        </div>
        <p className="st-sub"><span className={`st-dot${statusTone(venue.status) === 'ok' ? '' : ' open'}`} aria-hidden="true" style={{ color: 'var(--stump-accent)' }} />{kindLabel(venue.kind)} · {statusLabel(venue.status)}{venue.archived ? ' · Archived' : ''}</p>
        {venue.excluded ? <div className="st-panel" role="note"><strong>Excluded.</strong> {venue.excluded.reason}{venue.excluded.alternative ? ` Instead: ${venue.excluded.alternative}` : ''}</div> : null}
        {editing ? <VenueForm venue={venue} onDone={() => { setEditing(false); changed() }} onCancel={() => setEditing(false)} /> : null}
        <div className="st-columns">
          <RulesCard venue={venue} editor={editor} onSaved={changed} />
          <div className="st-aside">
            <RoutesCard venue={venue} routes={data.routes} editor={editor} onChanged={changed} />
            <MembersCard venue={venue} members={data.members} team={data.team} me={data.who.person} editor={editor} onChanged={changed} />
          </div>
          <DetailsCard venue={venue} items={data.items} />
        </div>
      </> : null}
    </section>
  </HydrationUnit>
}

function VenueMenu({ venue, onEdit, onChanged }: { venue: Venue; onEdit(): void; onChanged(): void }) {
  const [open, setOpen] = useState(false), [excluding, setExcluding] = useState(false)
  const { busy, message, run } = useRun()
  const act = (action: string, extra: Record<string, unknown> = {}) => run(() => runAction('stump.venues.manage', { action, idempotency_key: key(), venue_id: venue.id, expected_revision: venue.revision, ...extra }))
    .then(done => { if (done) { setOpen(false); setExcluding(false); onChanged() } })
  async function exclude(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget)
    await act('exclude', { reason: String(form.get('reason')), alternative: String(form.get('alternative')) })
  }
  return <div className="st-pop-anchor">
    <Tip label="More actions" align="end"><button className="st-button pill outline" type="button" aria-haspopup="menu" aria-expanded={open} aria-label="More actions" onClick={() => setOpen(!open)}>⋯</button></Tip>
    {open ? <div className="st-menu" role="menu">
      <button role="menuitem" type="button" onClick={() => { setOpen(false); onEdit() }}>Edit venue</button>
      {venue.status !== 'excluded' ? <button role="menuitem" type="button" onClick={() => { setOpen(false); setExcluding(true) }}>Exclude…</button> : null}
      <button role="menuitem" type="button" disabled={busy} onClick={() => void act(venue.archived ? 'restore' : 'archive')}>{venue.archived ? 'Restore' : 'Archive'}</button>
    </div> : null}
    {excluding ? <form className="st-card" role="dialog" aria-label="Exclude this venue" onSubmit={exclude} style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', width: 'min(360px, calc(100vw - 32px))', zIndex: 6 }}>
      <h2>Exclude this venue</h2>
      <label className="st-field">Why not<input name="reason" required maxLength={1000} /></label>
      <label className="st-field" style={{ marginTop: 12 }}>Where instead<input name="alternative" required maxLength={1000} /></label>
      <Outcome message={message} />
      <div className="st-actions" style={{ marginTop: 12 }}><button className="st-button primary pill" type="submit" disabled={busy}>Exclude</button><button className="st-button pill" type="button" onClick={() => setExcluding(false)}>Cancel</button></div>
    </form> : <Outcome message={message} />}
  </div>
}

function RoutesCard({ venue, routes, editor, onChanged }: { venue: Venue; routes: RouteAnswer; editor: boolean; onChanged(): void }) {
  const [limiting, setLimiting] = useState(false)
  const { busy, message, run } = useRun()
  async function setLimit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget), posts = Number(form.get('posts'))
    const done = await run(() => runAction('stump.venues.fit', { action: 'set_limit', idempotency_key: key(), venue_id: venue.id, expected_revision: venue.revision,
      limit: posts > 0 ? { posts, per: String(form.get('per')) } : null }))
    if (done) { setLimiting(false); onChanged() }
  }
  const closed = routes.reasons.filter(reason => !reason.open)
  return <section className="st-card" aria-labelledby="routes-title">
    <h2 id="routes-title">Routes</h2>
    {routes.routes.length ? <div className="st-chips">{routes.routes.map(route => <span className="st-chip ok" key={route}>{routeLabel(route)}</span>)}</div> : <p>No route is open.</p>}
    {closed.length ? <ul className="st-list">{closed.map(reason => <li className="st-meta" key={reason.route} style={{ padding: '2px 0' }}>{routeLabel(reason.route)}: {reason.because}</li>)}</ul> : null}
    <div style={{ borderTop: '1px solid var(--stump-line)', marginTop: 16, paddingTop: 16 }}>
      <div className="st-meta">Next open</div>
      <div style={{ fontWeight: 560 }}>{venue.shared_limit ? nextOpen(venue.next_open_at) ?? 'Not within a year' : 'Any time'}</div>
      <div className="st-meta">{venue.shared_limit ? `${limitWords(venue.shared_limit)}, for the whole company` : 'No shared limit'}</div>
      {editor && !limiting ? <button className="st-button pill outline" type="button" style={{ marginTop: 12 }} onClick={() => setLimiting(true)}>{venue.shared_limit ? 'Change limit' : 'Set a limit'}</button> : null}
      {limiting ? <form onSubmit={setLimit} style={{ marginTop: 12 }}>
        <div className="st-form">
          <label className="st-field">Posts<input name="posts" type="number" min={0} max={1000} defaultValue={venue.shared_limit?.posts ?? 1} /></label>
          <label className="st-field">Per<select name="per" defaultValue={venue.shared_limit?.per ?? 'week'}>{PERIODS.map(per => <option key={per} value={per}>{per}</option>)}</select></label>
        </div>
        <p className="st-note">Set posts to 0 to remove the limit.</p>
        <Outcome message={message} />
        <div className="st-actions"><button className="st-button primary pill" type="submit" disabled={busy}>Save limit</button><button className="st-button pill" type="button" onClick={() => setLimiting(false)}>Cancel</button></div>
      </form> : null}
    </div>
  </section>
}

function MembersCard({ venue, members, team, me: self, editor, onChanged }: { venue: Venue; members: Members; team: Team; me: { id: string }; editor: boolean; onChanged(): void }) {
  const [adding, setAdding] = useState(false)
  const { busy, message, run } = useRun()
  const names = new Map(team.items.map(person => [person.id, person.display_name]))
  const choices = team.items.filter(person => person.status !== 'removed' && (editor || person.id === self.id) && !members.items.some(member => member.person_id === person.id))
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget), karma = String(form.get('karma') ?? '').trim()
    const done = await run(() => runAction('stump.venues.members', { action: 'add', idempotency_key: key(), venue_id: venue.id, person_id: String(form.get('person')), handle: String(form.get('handle')),
      ...(form.get('joined_on') ? { joined_on: String(form.get('joined_on')) } : {}), ...(karma ? { karma: Number(karma) } : {}) }))
    if (done) { setAdding(false); onChanged() }
  }
  const approve = (id: string) => run(() => runAction('stump.venues.members', { action: 'approve_application', idempotency_key: key(), application_id: id })).then(done => { if (done) onChanged() })
  const gateWords = (gate: { gate: string; need: number | boolean }) => gate.gate === 'karma' ? `needs ${gate.need} karma` : gate.gate === 'account_age' ? `account needs ${gate.need} days` : gate.gate === 'approval' ? 'needs approval' : 'not a member'
  const pending = members.applications.filter(application => application.state === 'applied')
  return <section className="st-card" aria-labelledby="members-title">
    <h2 id="members-title">Members</h2>
    {members.items.length ? <ul className="st-list">{members.items.map(member => <li className="st-row" key={member.person_id}>
      <div className="st-row-main">
        <div className="st-name">{member.display_name ?? names.get(member.person_id) ?? 'Teammate'}</div>
        <div className="st-meta">{[member.handle, member.karma !== null ? `${member.karma.toLocaleString('en-US')} karma` : null, member.joined_on ? `joined ${member.joined_on}` : null].filter(Boolean).join(' · ')}</div>
      </div>
      {member.eligible ? <span className="st-chip ok">Can post</span> : <span className="st-chip held">{member.unmet.map(gateWords).join(', ')}</span>}
    </li>)}</ul> : <p className="st-meta">No one on the team is a member yet.</p>}
    {pending.length ? <>
      <h3 style={{ fontSize: 'var(--stump-size-body)', margin: '16px 0 4px' }}>Applied to join</h3>
      <ul className="st-list">{pending.map(application => <li className="st-row" key={application.id}>
        <div className="st-row-main"><div className="st-name">{names.get(application.person_id) ?? 'Teammate'}</div><div className="st-meta">{application.handle}</div></div>
        {editor ? <button className="st-button pill outline" type="button" disabled={busy} onClick={() => void approve(application.id)}>Approved</button> : <span className="st-chip">Waiting</span>}
      </li>)}</ul>
    </> : null}
    {choices.length && !adding ? <button className="st-button pill outline" type="button" style={{ marginTop: 12 }} onClick={() => setAdding(true)}>Record a member</button> : null}
    {adding ? <form onSubmit={add} style={{ marginTop: 12 }}>
      <div className="st-form">
        <label className="st-field">Person<select name="person" required>{choices.map(person => <option key={person.id} value={person.id}>{person.display_name}</option>)}</select></label>
        <label className="st-field">Their handle there<input name="handle" required maxLength={120} autoComplete="off" /></label>
        <label className="st-field">Joined on<input name="joined_on" type="date" /></label>
        <label className="st-field">Karma (optional)<input name="karma" type="number" min={0} /></label>
      </div>
      <div className="st-actions" style={{ marginTop: 12 }}><button className="st-button primary pill" type="submit" disabled={busy}>Record member</button><button className="st-button pill" type="button" onClick={() => setAdding(false)}>Cancel</button></div>
    </form> : null}
    <Outcome message={message} />
  </section>
}

function DetailsCard({ venue, items }: { venue: Venue; items: VenueItem[] }) {
  const howTo = Object.entries(venue.how_to_post).filter(([, value]) => value).map(([name, value]) => name === 'text' ? String(value) : `${name}: ${String(value)}`).join(' · ')
  const rows: Array<[string, string | null]> = [
    ['Address', venue.url], ['Platform', venue.platform], ['Priority', venue.priority],
    ...Object.entries(venue.details).filter(([, value]) => value !== null && value !== '').map(([name, value]) => [DETAIL_LABELS[name] ?? name, Array.isArray(value) ? value.join(', ') : String(value)] as [string, string]),
    ['Who reads it', venue.audience], ['Why it matters', venue.why], ['What readers get', venue.reader_value], ['How to post', howTo || null],
    ['Reception', venue.reception], ['Notes', venue.notes],
  ]
  return <section className="st-card" aria-labelledby="details-title">
    <h2 id="details-title">About this venue</h2>
    <dl className="st-kv">{rows.filter(([, value]) => value).map(([label, value]) => <div key={label} style={{ display: 'contents' }}><dt>{label}</dt><dd>{label === 'Address' || label === DETAIL_LABELS.guest_intake_url ? <a href={value!} target="_blank" rel="noreferrer noopener">{value}</a> : value}</dd></div>)}</dl>
    {venue.products.length ? <>
      <h3 style={{ fontSize: 'var(--stump-size-body)', margin: '16px 0 4px' }}>Products</h3>
      <ul className="st-list">{venue.products.map(product => <li className="st-row" key={product.product_id}><div className="st-row-main"><div className="st-name">{product.name ?? 'Product'}</div>
        <div className="st-meta">{[product.fit !== null ? `fit ${product.fit}` : null, `${product.items} ${product.items === 1 ? 'item' : 'items'} here`].filter(Boolean).join(' · ')}</div></div></li>)}</ul>
    </> : null}
    {items.length ? <>
      <h3 style={{ fontSize: 'var(--stump-size-body)', margin: '16px 0 4px' }}>Items aimed here</h3>
      <ul className="st-list">{items.map(item => <li className="st-row" key={item.id}><div className="st-row-main"><div className="st-name">{item.format[0]!.toUpperCase() + item.format.slice(1)} · {item.state}</div>
        <div className="st-meta">{item.hold?.reason ?? item.history[0]?.reason ?? ''}</div></div></li>)}</ul>
    </> : null}
  </section>
}
