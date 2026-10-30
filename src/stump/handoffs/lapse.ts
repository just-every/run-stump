// Hand-offs never wait in silence (STUMP-HANDOFF-003): on the scheduled tick a
// held hand-off whose review date has come returns to the queue, every open one
// is read against its venue's rules again, and one past its due time lapses by
// the action its creator chose. Removing a person answers their open hand-offs.
import type { ActionContext } from '../actions/types.ts'
import { loadBrand } from '../drafting/check.ts'
import type { StumpEnv } from '../env.ts'
import { moveItem, type ItemState } from '../items/state.ts'
import { readPerson } from '../people/store.ts'
import { handoffEligibility } from '../venues/members.ts'
import { readVenue, type VenueRow } from '../venues/model.ts'
import { disclosureFor, factsFor, nextOpening, outsideVoice, talkingPoints } from './brief.ts'
import { ACTIVE, move, type Actor, type HandoffRow } from './model.ts'
import { refresh } from './refresh.ts'

const DAY = 86_400_000

/** The draft item a hand-off no longer uses is superseded: cancelled with the reason, unless it has gone further. */
async function supersede(actor: Actor, itemId: string | null, reason: string): Promise<D1PreparedStatement[]> {
  if (!itemId) return []
  const item = await actor.db.prepare('SELECT id,state FROM stump_items WHERE id=?').bind(itemId).first<{ id: string; state: ItemState }>()
  return item && ['draft', 'ready', 'held'].includes(item.state) ? moveItem(actor, item, 'cancelled', reason) : []
}

/** The next member of the venue who may take it: active, able to post, meeting the gates, not the person it leaves, earliest joined first. */
async function nextMember(actor: Actor, venue: VenueRow, row: HandoffRow, leaving: string) {
  const members = (await actor.db.prepare(`SELECT m.person_id FROM stump_venue_members m JOIN stump_people p ON p.id=m.person_id
    WHERE m.venue_id=? AND m.person_id<>? AND p.status='active' AND p.role<>'viewer' ORDER BY COALESCE(m.joined_on,''),m.created_at,m.person_id`).bind(venue.id, leaving).all<{ person_id: string }>()).results
  const before = new Set((await actor.db.prepare("SELECT detail FROM stump_handoff_history WHERE handoff_id=? AND action='reassigned'").bind(row.id).all<{ detail: string }>()).results
    .map(entry => (JSON.parse(entry.detail) as { from_person_id?: string }).from_person_id))
  const eligible = []
  for (const member of members) if ((await handoffEligibility(actor.db, venue, member.person_id, actor.now())).eligible) eligible.push(member.person_id)
  // Someone who has not had it yet goes first; nobody is handed it back while another member could take it.
  return eligible.find(id => !before.has(id)) ?? eligible[0] ?? null
}

/** Reassigns to the next member, with the brief rebuilt for them: their disclosure, the facts, and talking points in place of another person's draft. */
async function reassign(actor: Actor, row: HandoffRow, venue: VenueRow, action: string, reason: string): Promise<{ statements: D1PreparedStatement[]; to: string | null }> {
  const to = await nextMember(actor, venue, row, row.person_id)
  if (!to) return { statements: await expire(actor, row, action, `${reason} No other member of ${venue.name} can take it.`), to: null }
  const person = (await readPerson(actor.db, to))!, brand = await loadBrand(actor.db)
  const product = brand.products.find(entry => entry.id === row.product_id) ?? { name: venue.name, description: null, id: '' }
  const disclosure = disclosureFor(venue, person, brand, product.name), facts = row.product_id ? factsFor(brand, row.product_id, actor.now()) : []
  const eligibility = await handoffEligibility(actor.db, venue, to, actor.now())
  const due = Math.max(row.due_at ?? 0, actor.now()) + DAY
  return {
    to,
    statements: [
      ...await supersede(actor, row.item_id, `The hand-off moved to ${person.display_name}; the draft spoke for someone else.`),
      ...move(actor, row, eligibility.join_first ? 'join_first' : 'open', action, {
        person_id: to, due_at: due, disclosure_line: disclosure, draft_text: null, item_id: null, facts: JSON.stringify(facts), own_words_required: 1,
        talking_points: JSON.stringify(talkingPoints(venue, product, facts, disclosure)), attestation_required: row.recommends === 1 && outsideVoice(person) ? 1 : 0,
        join_steps: JSON.stringify(eligibility.join_steps), hold: null,
      }, { from_person_id: row.person_id, to_person_id: to, due_at: new Date(due).toISOString(), reason }),
    ],
  }
}

async function expire(actor: Actor, row: HandoffRow, action: string, reason: string) {
  return [...await supersede(actor, row.item_id, 'The hand-off expired.'), ...move(actor, row, 'expired', action, { hold: null }, { reason })]
}

/** Runs one hand-off's lapse action now. */
async function lapse(actor: Actor, row: HandoffRow, venue: VenueRow): Promise<D1PreparedStatement[]> {
  const due = new Date(row.due_at!).toISOString()
  if (row.lapse === 'reassign') return (await reassign(actor, row, venue, 'lapsed', `Past due at ${due}.`)).statements
  if (row.lapse === 'next_slot') {
    // The venue's next opening from tomorrow on, due by the end of that day; with no thread day or limit, a day later.
    const tomorrow = Math.floor(actor.now() / DAY) * DAY + DAY, opening = await nextOpening(actor.db, venue, tomorrow, row.id)
    const next = (opening ?? actor.now()) + DAY
    return move(actor, row, row.state, 'lapsed', { due_at: next, next_open_at: opening }, { lapse: 'next_slot', from_due_at: due, due_at: new Date(next).toISOString(), next_open_at: opening === null ? null : new Date(opening).toISOString() })
  }
  return expire(actor, row, 'lapsed', `Past due at ${due}.`)
}

/** The scheduled tick: review dates and rule changes, then lapses, each with its history. */
export async function tickHandoffs(env: StumpEnv, now: number): Promise<{ refreshed: number; lapsed: number }> {
  const actor: Actor = { db: env.DB, person: null, agent: null, now: () => now }
  const active = () => env.DB.prepare("SELECT * FROM stump_handoffs WHERE state IN ('open','join_first','held') ORDER BY due_at,id").all<HandoffRow>().then(result => result.results)
  let rows = await active()
  // Review dates and rule changes first (refresh), then what is past due lapses.
  const ruled = await refresh(actor, rows)
  if (ruled.length) await env.DB.batch(ruled)
  rows = ruled.length ? await active() : rows
  let lapsed = 0
  for (const row of rows) {
    if (row.state === 'held' || row.due_at === null || row.due_at > now) continue
    const statements = await lapse(actor, row, (await readVenue(env.DB, row.venue_id))!)
    if (statements.length) { await env.DB.batch(statements); lapsed++ }
  }
  return { refreshed: ruled.length / 2, lapsed }
}

/**
 * Removing a person answers each hand-off still waiting on them (STUMP-HANDOFF-003.5):
 * it moves to the venue's next member with its history, or expires when nobody
 * else there can take it. None is lost. The call stump.team.manage remove makes.
 */
export async function answerRemovedPerson(ctx: Pick<ActionContext, 'db' | 'person' | 'agent' | 'now'>, personId: string) {
  const actor: Actor = { db: ctx.db, person: ctx.person, agent: ctx.agent, now: ctx.now }
  const rows = (await ctx.db.prepare("SELECT * FROM stump_handoffs WHERE person_id=? AND state IN (SELECT value FROM json_each(?)) ORDER BY due_at,id").bind(personId, JSON.stringify(ACTIVE)).all<HandoffRow>()).results
  const answered: Array<{ handoff_id: string; outcome: 'reassigned' | 'expired'; person_id: string | null }> = []
  for (const row of rows) {
    const venue = (await readVenue(ctx.db, row.venue_id))!
    const { statements, to } = await reassign(actor, row, venue, 'person_removed', 'The person was removed from the team.')
    await ctx.db.batch(statements)
    answered.push({ handoff_id: row.id, outcome: to ? 'reassigned' : 'expired', person_id: to })
  }
  return answered
}
