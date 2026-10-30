// Hand-offs never wait in silence (STUMP-HANDOFF-003): one past its due time, or
// held by a person until a review date that has come, lapses by the action its
// creator chose, logged with the draft it supersedes. Removing a person answers
// their open hand-offs.
import type { ActionContext } from '../actions/types.ts'
import { loadBrand } from '../drafting/check.ts'
import { moveItem, type ItemState } from '../items/state.ts'
import { readPerson } from '../people/store.ts'
import { handoffEligibility } from '../venues/members.ts'
import { readVenue, type VenueRow } from '../venues/model.ts'
import { disclosureFor, factsFor, nextOpening, outsideVoice, talkingPoints } from './brief.ts'
import { draftDuplicateHold, limitHold, ruleHold, ruleHoldJson } from './holds.ts'
import { ACTIVE, move, type Actor, type HandoffRow, type HandoffState, type Hold } from './model.ts'

const DAY = 86_400_000

/**
 * The draft item a hand-off no longer uses is superseded: cancelled with the
 * reason, unless it has gone further. The hand-off's history names it.
 */
async function supersede(actor: Actor, itemId: string | null, reason: string): Promise<{ statements: D1PreparedStatement[]; detail: Record<string, unknown> }> {
  if (!itemId) return { statements: [], detail: {} }
  const item = await actor.db.prepare('SELECT id,state FROM stump_items WHERE id=?').bind(itemId).first<{ id: string; state: ItemState }>()
  if (!item || !['draft', 'ready', 'held'].includes(item.state)) return { statements: [], detail: {} }
  return { statements: moveItem(actor, item, 'cancelled', reason), detail: { item_id: item.id, draft: 'superseded' } }
}

/** The next member of the venue who may take it: active, able to post, meeting the gates, not the person it leaves, earliest joined first. */
async function nextMember(actor: Actor, venue: VenueRow, row: HandoffRow, leaving: string) {
  const members = (await actor.db.prepare(`SELECT m.person_id FROM stump_venue_members m JOIN stump_people p ON p.id=m.person_id
    WHERE m.venue_id=? AND m.person_id<>? AND p.status='active' AND p.role<>'viewer' ORDER BY COALESCE(m.joined_on,''),m.created_at,m.person_id`).bind(venue.id, leaving).all<{ person_id: string }>()).results
  const before = new Set((await actor.db.prepare("SELECT detail FROM stump_handoff_history WHERE handoff_id=? AND action IN ('reassigned','lapsed','person_removed')").bind(row.id).all<{ detail: string }>()).results
    .map(entry => (JSON.parse(entry.detail) as { from_person_id?: string }).from_person_id).filter(Boolean))
  const eligible = []
  for (const member of members) if ((await handoffEligibility(actor.db, venue, member.person_id, actor.now())).eligible) eligible.push(member.person_id)
  // Someone who has not had it yet goes first; nobody is handed it back while another member could take it.
  return eligible.find(id => !before.has(id)) ?? eligible[0] ?? null
}

/**
 * Where a hand-off lands at a new due time: held by a venue rule or the shared
 * limit in that period (with the next open date), else open, or join-first for
 * someone not yet a member.
 */
async function placed(actor: Actor, venue: VenueRow, row: Pick<HandoffRow, 'id' | 'thread_url' | 'item_id'>, draft: string | null, personId: string, due: number) {
  // A draft it keeps still nearly repeating a queued or posted one stays held until rewritten (STUMP-TRUTH-004).
  const hold = ruleHold(venue, { draft_text: draft, thread_url: row.thread_url }) ?? (draft === null ? null : await draftDuplicateHold(actor.db, row.item_id))
    ?? await limitHold(actor.db, venue, due, row.id)
  const eligibility = await handoffEligibility(actor.db, venue, personId, actor.now())
  const state: HandoffState = hold ? 'held' : eligibility.join_first ? 'join_first' : 'open'
  return { state, eligibility, hold: hold ? ruleHoldJson(hold, actor.now()) : null, detail: hold ? { rule: hold.rule, reason_held: hold.reason, ...(hold.next_open_at !== undefined ? { next_open_at: hold.next_open_at } : {}), ...(hold.matches ? { matches: hold.matches } : {}) } : {} }
}

/** Reassigns to the next member, with the brief rebuilt for them: their disclosure, the facts, and talking points in place of another person's draft. */
async function reassign(actor: Actor, row: HandoffRow, venue: VenueRow, action: string, detail: Record<string, unknown>): Promise<{ statements: D1PreparedStatement[]; to: string | null }> {
  const to = await nextMember(actor, venue, row, row.person_id)
  if (!to) return { statements: await expire(actor, row, action, { ...detail, reason: `${String(detail.reason)} No other member of ${venue.name} can take it.` }), to: null }
  const person = (await readPerson(actor.db, to))!, brand = await loadBrand(actor.db)
  const product = brand.products.find(entry => entry.id === row.product_id) ?? { name: venue.name, description: null, id: '' }
  const disclosure = disclosureFor(venue, person, brand, product.name), facts = row.product_id ? factsFor(brand, row.product_id, actor.now()) : []
  const due = Math.max(row.due_at ?? 0, actor.now()) + DAY
  const land = await placed(actor, venue, row, null, to, due)
  const draft = await supersede(actor, row.item_id, `The hand-off moved to ${person.display_name}; the draft spoke for someone else.`)
  return {
    to,
    statements: [
      ...draft.statements,
      ...move(actor, row, land.state, action, {
        person_id: to, due_at: due, disclosure_line: disclosure, draft_text: null, item_id: null, facts: JSON.stringify(facts), own_words_required: 1,
        talking_points: JSON.stringify(talkingPoints(venue, product, facts, disclosure)), attestation_required: row.recommends === 1 && outsideVoice(person) ? 1 : 0,
        join_steps: JSON.stringify(land.eligibility.join_steps), hold: land.hold,
      }, { ...detail, ...draft.detail, ...land.detail, from_person_id: row.person_id, to_person_id: to, due_at: new Date(due).toISOString() }),
    ],
  }
}

async function expire(actor: Actor, row: HandoffRow, action: string, detail: Record<string, unknown>) {
  const draft = await supersede(actor, row.item_id, 'The hand-off expired.')
  return [...draft.statements, ...move(actor, row, 'expired', action, { hold: null }, { ...detail, ...draft.detail })]
}

/** Moves it to the venue's next opening from tomorrow on, due by the end of that day; with no thread day or limit, a day later. A venue rule's hold stays. */
async function nextSlot(actor: Actor, row: HandoffRow, venue: VenueRow, detail: Record<string, unknown>) {
  const tomorrow = Math.floor(actor.now() / DAY) * DAY + DAY, opening = await nextOpening(actor.db, venue, tomorrow, row.id)
  const next = (opening ?? actor.now()) + DAY
  const land = await placed(actor, venue, row, row.draft_text, row.person_id, next)
  return move(actor, row, land.state, 'lapsed', { due_at: next, next_open_at: opening, hold: land.hold }, {
    ...detail, ...land.detail, lapse: 'next_slot', from_due_at: row.due_at === null ? null : new Date(row.due_at).toISOString(), due_at: new Date(next).toISOString(),
    next_open_at: opening === null ? null : new Date(opening).toISOString(),
  })
}

/**
 * Runs one hand-off's lapse action now: when it is past due, or when a person's
 * hold reaches its review date (STUMP-HANDOFF-003.1-.3).
 */
export async function lapse(actor: Actor, row: HandoffRow, venue: VenueRow, trigger: 'due' | 'review_date'): Promise<D1PreparedStatement[]> {
  const hold = row.hold ? JSON.parse(row.hold) as Hold : null
  const detail: Record<string, unknown> = trigger === 'review_date'
    ? { trigger: 'review_date', lapse: row.lapse, review_at: hold?.review_at ?? null, held_by: hold?.by ?? null, held_reason: hold?.reason ?? null, reason: `The review date ${hold?.review_at ?? ''} came.` }
    : { trigger: 'due', lapse: row.lapse, reason: `Past due at ${new Date(row.due_at!).toISOString()}.` }
  if (row.lapse === 'reassign') return (await reassign(actor, row, venue, 'lapsed', detail)).statements
  if (row.lapse === 'next_slot') return nextSlot(actor, row, venue, detail)
  return expire(actor, row, 'lapsed', detail)
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
    const { statements, to } = await reassign(actor, row, venue, 'person_removed', { reason: 'The person was removed from the team.' })
    await ctx.db.batch(statements)
    answered.push({ handoff_id: row.id, outcome: to ? 'reassigned' : 'expired', person_id: to })
  }
  return answered
}
