// Starting a hand-off from a venue whose rules keep posting for its members
// (STUMP-HANDOFF-001): pick the member who posts, the product, when it is due
// and what happens if it lapses, and optionally the thread and a draft. The
// brief opens next. stump.handoffs.prepare decides the route and every check.
import { useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { runAction } from '../../ui/api.ts'
import { Outcome, useLoaded, useRun, SelectField } from '../../ui/kit.tsx'
import type { Team } from '../../ui/types.ts'
import type { Members, Venue } from '../../venues/ui/types.ts'
import { US_ZONES, deviceZone, instantIn, storeZone, workingZone, zoneName } from '../../ui/zones.ts'

const key = () => crypto.randomUUID()
const LAPSE_WORDS: Record<string, string> = { expire: 'Let it expire', reassign: 'Hand it to the next member', next_slot: 'Move it to the next opening' }
const inDays = (days: number) => { const at = new Date(Date.now() + days * 86_400_000); return new Date(at.getTime() - at.getTimezoneOffset() * 60_000).toISOString().slice(0, 10) }

export function HandoffStart({ venue, routes, members, team, me }: { venue: Venue; routes: string[]; members: Members; team: Team; me: { id: string; role: string } }) {
  const [open, setOpen] = useState(false)
  // A venue the company's account posts to takes a scheduled post instead; one with no route open takes nothing.
  if (routes.includes('publish') || (!routes.includes('handoff_draft') && !routes.includes('handoff_brief'))) return null
  if (me.role === 'viewer') return null
  return open ? <HandoffForm venue={venue} routes={routes} members={members} team={team} me={me} onClose={() => setOpen(false)} />
    : <button className="st-button pill primary" type="button" style={{ marginTop: 12 }} onClick={() => setOpen(true)}>Hand off</button>
}

function HandoffForm({ venue, routes, members, team, me, onClose }: { venue: Venue; routes: string[]; members: Members; team: Team; me: { id: string; role: string }; onClose(): void }) {
  const navigate = useNavigate()
  const products = useLoaded(() => runAction<{ items: Array<{ id: string; name: string }> }>('stump.brand.manage', { action: 'product_list' }))
  const { busy, message, run } = useRun()
  const editor = ['owner', 'admin', 'editor'].includes(me.role)
  // Members first (a non-member gets the venue's join steps), then the rest of the team who post; a contributor hands off only to themselves.
  const memberIds = new Set(members.items.map(member => member.person_id))
  const people = team.items.filter(person => person.status !== 'removed' && person.role !== 'viewer' && (editor || person.id === me.id))
    .sort((a, b) => Number(memberIds.has(b.id)) - Number(memberIds.has(a.id)))
  const draftable = routes.includes('handoff_draft')
  const listed = new Set(venue.products.map(product => product.product_id))
  const choices = [...(products.data?.items ?? [])].sort((a, b) => Number(listed.has(b.id)) - Number(listed.has(a.id)))
  // Due at 5 PM on the day, in the zone the team schedules in (the person's last pick, as Compose remembers it), never only the computer's.
  const [zone, setZone] = useState(workingZone)
  const zones = [...new Set([zone, ...US_ZONES.map(([id]) => id), deviceZone()])]
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget), text = String(form.get('text') ?? '').trim(), thread = String(form.get('thread') ?? '').trim()
    const made = await run(() => runAction<{ id: string }>('stump.handoffs.prepare', { action: 'prepare', idempotency_key: key(), venue_id: venue.id, person_id: String(form.get('person')),
      product_id: String(form.get('product')), due_at: new Date(instantIn(`${String(form.get('due'))}T17:00`, zone)).toISOString(), lapse: String(form.get('lapse')),
      ...(thread ? { thread_url: thread } : {}), ...(draftable && text ? { text } : draftable && form.get('generate') ? { generate: true } : {}) }))
    if (made) await navigate({ to: '/app/handoffs/$handoffId', params: { handoffId: made.id } })
  }
  if (products.data && !choices.length) return <p className="st-meta" style={{ marginTop: 12 }}>Add your product first in <a href="/app/settings/brand">Brand</a>, then hand off.</p>
  return <form onSubmit={submit} aria-label={`Hand off at ${venue.name}`} style={{ marginTop: 12 }}>
    <div className="st-form">
      <SelectField label="Who posts" name="person" required defaultValue={people.find(person => person.status === 'active')?.id}>
        {people.map(person => <option key={person.id} value={person.id} disabled={person.status !== 'active'}>
          {person.display_name}{person.status !== 'active' ? ' (has not signed in yet)' : memberIds.has(person.id) ? '' : ' (joins first)'}</option>)}</SelectField>
      <SelectField label="Product" name="product" required>{choices.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</SelectField>
      <label className="st-field">Due (5 PM)<input name="due" type="date" required defaultValue={inDays(2)} min={inDays(0)} /></label>
      <SelectField label="Time zone" value={zone} onChange={event => { setZone(event.target.value); storeZone(event.target.value) }}>
        {zones.map(id => <option key={id} value={id}>{zoneName(id)}</option>)}</SelectField>
      <SelectField label="If it is not posted by then" name="lapse" defaultValue="expire">{Object.entries(LAPSE_WORDS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</SelectField>
      <label className="st-field">Thread (optional)<input name="thread" type="url" maxLength={2048} placeholder="https://" autoComplete="off" /></label>
    </div>
    {draftable ? <>
      <label className="st-field" style={{ marginTop: 12 }}>Draft (optional)<textarea name="text" rows={3} maxLength={25_000} placeholder="Leave empty for a brief with talking points" /></label>
      <label className="st-field st-check"><input name="generate" type="checkbox" />Or draft it with your AI provider</label>
    </> : <p className="st-note">{venue.name} bans AI-written text: the member gets talking points and facts, and writes their own words.</p>}
    <Outcome message={message} />
    <div className="st-actions" style={{ marginTop: 12 }}>
      <button className="st-button primary pill" type="submit" disabled={busy || !products.data || !people.length}>Hand off</button>
      <button className="st-button pill" type="button" onClick={onClose}>Cancel</button>
    </div>
  </form>
}
