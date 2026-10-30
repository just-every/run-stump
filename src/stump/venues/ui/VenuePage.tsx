import { Link } from '@tanstack/react-router'
import { useState, type FormEvent, type ReactNode } from 'react'
import { HydrationUnit } from '../../../base/hydration/unit'
import { me, runAction } from '../../ui/api.ts'
import { Disc, Outcome, Tip, monthYear, useLoaded, useRun, when, words } from '../../ui/kit.tsx'
import type { Team } from '../../ui/types.ts'
import { DETAIL_LABELS } from '../kinds.ts'
import { kindLabel, limitWords, nextOpenWords, routeLabel, statusLabel, statusTone } from './labels.ts'
import { openingWords } from '../../today/sections.ts'
import { STATE as HANDOFF_STATE } from '../../handoffs/ui/words.ts'
import { HandoffStart } from '../../handoffs/ui/HandoffStart.tsx'
import { RulesCard, threadWords } from './RulesCard.tsx'
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
    <section className="st-page st-venue" aria-labelledby="venue-title" style={{ maxWidth: 1120 }}>
      <Link className="st-back" to="/app/venues">← All venues</Link>
      {error ? <p className="st-error" role="alert">{error}</p> : null}
      {venue ? <>
        <div className="st-toolbar" style={{ marginBottom: 4, alignItems: 'flex-start' }}>
          <h1 id="venue-title" style={{ flex: '1 1 auto', overflowWrap: 'anywhere' }}>{venue.name}</h1>
          {editor ? <VenueMenu venue={venue} onEdit={() => setEditing(true)} onChanged={changed} /> : null}
        </div>
        <p className="st-sub"><span className={`st-dot${statusTone(venue.status) === 'ok' ? '' : ' open'}`} aria-hidden="true" style={{ color: 'var(--stump-accent)' }} />{kindLabel(venue.kind, venue.platform, venue.name)} · {statusLabel(venue.status)}{venue.priority ? ` · ${venue.priority.charAt(0).toUpperCase()}${venue.priority.slice(1)} priority` : ''}{venue.archived ? ' · Archived' : ''}
          {venue.url ? <> · <a className="st-venue-link" href={venue.url} target="_blank" rel="noreferrer noopener">{bare(venue.url)} ↗</a></> : null}</p>
        {venue.excluded ? <div className="st-panel" role="note"><strong>Excluded.</strong> {venue.excluded.reason}{venue.excluded.alternative ? ` Instead: ${venue.excluded.alternative}` : ''}</div> : null}
        {editing ? <VenueForm venue={venue} onDone={() => { setEditing(false); changed() }} onCancel={() => setEditing(false)} /> : null}
        {/* Rules is the focal panel; what the company aims here (its products, items, and About when nothing says why it fits)
            follows it in the left column, and the rail holds Routes, Members and Why it fits. At 760 and under the two columns
            open into one, in the order Rules, Routes, Members, Why it fits or About, then Products. */}
        <div className="st-columns">
          <div className="st-venue-main">
            <RulesCard venue={venue} editor={editor} onSaved={changed} />
            {venue.why ? null : <WhyCard venue={venue} />}
            <ProductsCard venue={venue} items={data.items} />
          </div>
          <div className="st-aside">
            <RoutesCard venue={venue} routes={data.routes} editor={editor} onChanged={changed}
              handoff={<HandoffStart venue={venue} routes={data.routes.routes} members={data.members} team={data.team} me={data.who.person} />} />
            <MembersCard venue={venue} members={data.members} team={data.team} me={data.who.person} editor={editor} onChanged={changed} />
            {venue.why ? <WhyCard venue={venue} /> : null}
          </div>
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

function RoutesCard({ venue, routes, editor, onChanged, handoff }: { venue: Venue; routes: RouteAnswer; editor: boolean; onChanged(): void; handoff: ReactNode }) {
  const [limiting, setLimiting] = useState(false)
  const { busy, message, run } = useRun()
  async function setLimit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget), posts = Number(form.get('posts'))
    const done = await run(() => runAction('stump.venues.fit', { action: 'set_limit', idempotency_key: key(), venue_id: venue.id, expected_revision: venue.revision,
      limit: posts > 0 ? { posts, per: String(form.get('per')) } : null }))
    if (done) { setLimiting(false); onChanged() }
  }
  const closed = routes.reasons.filter(reason => !reason.open)
  return <section className="st-card st-venue-routes" aria-labelledby="routes-title">
    <h2 className="st-panel-title" id="routes-title"><Disc icon="arrows" />Routes</h2>
    {routes.routes.length ? <div className="st-chips">{routes.routes.map(route => <span className="st-chip ok" key={route}>{routeLabel(route)}</span>)}</div> : <p>No route is open.</p>}
    {closed.length ? <ul className="st-list">{closed.map(reason => <li className="st-meta" key={reason.route} style={{ padding: '2px 0' }}>{CLOSED[reason.route] ?? routeLabel(reason.route)}: {lower(reason.because)}</li>)}</ul> : null}
    {handoff}
    <div style={{ borderTop: '1px solid var(--stump-line)', marginTop: 16, paddingTop: 16 }}>
      <div className="st-meta">Next open</div>
      <div style={{ fontWeight: 560 }}>{nextOpenWords(venue)}</div>
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
  const gateWords = (gate: { gate: string; need: number | boolean }) => gate.gate === 'karma' ? `needs ${gate.need}\u00a0karma` : gate.gate === 'account_age' ? `account needs ${gate.need}\u00a0days` : gate.gate === 'approval' ? 'needs approval' : 'join first'
  const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
  const pending = members.applications.filter(application => application.state === 'applied')
  return <section className="st-card st-venue-members" aria-labelledby="members-title">
    <h2 className="st-panel-title" id="members-title"><Disc icon="people" />Members</h2>
    {members.items.length ? <ul className="st-list">{members.items.map(member => <li className="st-row" key={member.person_id}>
      <div className="st-row-main">
        <div className="st-name">{member.display_name ?? names.get(member.person_id) ?? 'Teammate'}</div>
        <div className="st-meta">{[member.handle, member.karma !== null ? `${member.karma.toLocaleString('en-US')}\u00a0karma` : null, member.joined_on ? `joined ${monthYear(member.joined_on)}` : null].filter(Boolean).join(' · ')}</div>
      </div>
      {/* Able to post is the default (H16): a chip shows only what still stands in the way. */}
      {member.eligible ? null : <span className="st-chip held">{capital(member.unmet.map(gateWords).join(', '))}</span>}
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

/** A venue's address as people write it: "reddit.com/r/healthIT". */
const bare = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
/** A closed route in words: what the person cannot do here. */
const CLOSED: Record<string, string> = { publish: 'No direct posts', handoff_draft: 'No AI drafts', handoff_brief: 'No hand-offs' }
/** A sentence continued after a colon: its first letter lower-cased, unless the first word is an initialism ("AI"). */
const lower = (text: string) => /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text

/** Why the venue is worth showing up in, and what else the company knows about it. The title and subline already say what
 * it is, where, on which platform and at what priority, so details that repeat them do not show. */
function WhyCard({ venue }: { venue: Venue }) {
  const howTo = howToWords(venue)
  const details = Object.entries(venue.details).filter(([name, value]) => name !== 'subreddit' && value !== null && value !== '')
    .map(([name, value]) => [DETAIL_LABELS[name] ?? name, Array.isArray(value) ? value.join(', ') : String(value)] as const)
  const needs = typeof venue.requirements.text === 'string' && venue.requirements.text.trim() ? venue.requirements.text.trim() : null
  const lines = ([...details, ['Who reads it', venue.audience], ['What readers get', venue.reader_value], ['How to post', howTo || null], ['What posting takes', needs], ['Reception', venue.reception], ['Notes', venue.notes]] as const)
    .filter(([, value]) => value)
  if (!venue.why && !lines.length) return null
  const link = (value: string) => /^https?:\/\//.test(value) ? <a href={value} target="_blank" rel="noreferrer noopener">{bare(value)} ↗</a> : value
  return <section className="st-card st-venue-why-card" aria-labelledby="why-title">
    <h2 className="st-panel-title" id="why-title"><Disc icon="check" />{venue.why ? 'Why it fits' : 'About'}</h2>
    {venue.why ? <p className="st-venue-why">{venue.why}</p> : null}
    {lines.length ? <dl className="st-venue-facts">{lines.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{link(value!)}</dd></div>)}</dl> : null}
  </section>
}

/** An article for a word: "a launch post", "an AMA". */
const article = (word: string) => /^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`
/**
 * How to post here, in words, never the record's field names: "Post in the weekly thread", "Post as a launch post". The thread
 * line is left out when the Self-promotion rule already names that thread.
 */
function howToWords(venue: Venue): string {
  const how = venue.how_to_post, text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null
  const promo = venue.rules.self_promotion
  const bareThread = (words: string) => words.toLowerCase().replace(/^the\s+/, '')
  const promoThread = promo?.value === 'thread' ? bareThread(threadWords(promo)) : null
  const thread = text(how.thread)
  return [
    text(how.text),
    thread && !(promoThread && promoThread.includes(bareThread(thread))) ? `Post in the ${thread.replace(/^the\s+/i, '')}` : null,
    text(how.channel) ? `Post as ${article(text(how.channel)!)}` : null,
    text(how.flair) ? `Use the ${text(how.flair)} flair` : null,
    text(how.day) ? `Post on ${text(how.day)}` : null,
    text(how.template) ? `Follow its template: ${text(how.template)}` : null,
  ].filter(Boolean).join(' · ')
}

/** Each product the venue serves, with its fit and how many items aim here, then those items with what holds them (STUMP-VENUE-001.6). */
function ProductsCard({ venue, items }: { venue: Venue; items: VenueItem[] }) {
  if (!venue.products.length && !items.length) return null
  const names = new Map(venue.products.map(product => [product.product_id, product.name ?? 'Product']))
  return <section className="st-card st-venue-products" aria-labelledby="products-title">
    <h2 className="st-panel-title" id="products-title"><Disc icon="chart" />{venue.products.length ? 'Products' : 'Items aimed here'}</h2>
    {venue.products.length ? <ul className="st-list">{venue.products.map(product => <li className="st-row" key={product.product_id}>
      <div className="st-row-main"><div className="st-name">{product.name ?? 'Product'}</div>
        <div className="st-meta">{[product.fit !== null ? `fit ${product.fit}` : null, `${product.items} ${product.items === 1 ? 'item' : 'items'} here`].filter(Boolean).join(' · ')}</div></div>
    </li>)}</ul> : null}
    {items.length ? <>
      {venue.products.length ? <h3 className="st-venue-sub">Items aimed here</h3> : null}
      <ul className="st-list st-venue-items">{items.map(item => <li className="st-row" key={item.id}>
        <div className="st-row-main"><div className="st-name">{itemName(item, names)}</div>
          <div className="st-meta">{itemWords(venue, item)}</div></div>
      </li>)}</ul>
    </> : null}
  </section>
}

const cap = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)
/**
 * An item aimed here, named as Today names it: by its product ("Brightwell post"), whether or not this venue lists that product,
 * else a post by its opening words.
 */
function itemName(item: VenueItem, names: Map<string, string>): string {
  const product = item.product_name ?? (item.product_id ? names.get(item.product_id) : null)
  if (product) return `${product} ${item.format}`
  return item.format === 'post' && item.text ? openingWords(item.text) : cap(item.format)
}

/** Where an item aimed here stands, in words: a hand-off's own state as Hand-offs says it, else the rule that holds it, never its code. */
function itemWords(venue: Venue, item: VenueItem): string {
  if (item.handoff) return HANDOFF_STATE[item.handoff.state]?.label ?? cap(words(item.handoff.state))
  if (item.state === 'held' || item.hold) {
    const rule = item.hold?.rule ?? null
    if (rule === 'self_promotion') return `Held: outside the ${venue.rules.self_promotion ? threadWords(venue.rules.self_promotion) : 'promotion thread'}`
    if (rule === 'links') return 'Held: links are not allowed here'
    if (rule === 'posting') return 'Held: members post here, so it goes to a member'
    if (rule) return `Held by the ${words(rule)} rule`
    return item.hold?.reason && !/^[a-z_]+$/.test(item.hold.reason) ? `Held: ${item.hold.reason}` : 'Held'
  }
  if (item.state === 'scheduled' && item.scheduled_at) return `Scheduled for ${when(item.scheduled_at)}`
  return cap(words(item.state))
}
