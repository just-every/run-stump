// Each act on a hand-off, and the Worker's scheduled tick, reads the venue's rules,
// its draft's near-duplicate flag (STUMP-TRUTH-004), its shared limit and the
// person's membership as they are now (D-3,
// STUMP-HANDOFF-003, STUMP-VENUE-003.4, STUMP-VENUE-006.3): a person's hold whose
// review date has come runs the lapse action, a rule that newly forbids the post
// holds it with the rule named, a rule or full limit that no longer applies
// releases it, a person who has joined moves from join-first to open, and one past
// its due time lapses. Nothing waits in silence.
import type { StumpEnv } from '../env.ts'
import { handoffEligibility } from '../venues/members.ts'
import { readVenue, type VenueRow } from '../venues/model.ts'
import { refreshItems } from '../venues/rules.ts'
import { draftDuplicateHold, limitHold, ruleHold, ruleHoldJson } from './holds.ts'
import { lapse } from './lapse.ts'
import { ACTIVE, move, type Actor, type HandoffRow, type Hold } from './model.ts'

type Outcome = { statements: D1PreparedStatement[]; lapsed: boolean }
const none: Outcome = { statements: [], lapsed: false }

/** The statements that bring one hand-off in line with its venue and its person now. */
async function refreshRow(actor: Actor, row: HandoffRow, venue: VenueRow): Promise<Outcome> {
  if (!ACTIVE.includes(row.state)) return none
  const current = row.hold ? JSON.parse(row.hold) as Hold : null
  const now = actor.now()
  // A person's hold lasts until its review date, when the lapse action runs and is logged (STUMP-HANDOFF-003.3).
  if (row.state === 'held' && current?.kind === 'person') {
    return current.review_at && Date.parse(current.review_at) <= now ? { statements: await lapse(actor, row, venue, 'review_date'), lapsed: true } : none
  }
  const held = (hold: NonNullable<ReturnType<typeof ruleHold>>) => ({ statements: move(actor, row, 'held', 'rule_hold', { hold: ruleHoldJson(hold, now) },
    { rule: hold.rule, reason: hold.reason, source_url: hold.source_url, ...(hold.next_open_at !== undefined ? { next_open_at: hold.next_open_at } : {}), ...(hold.matches ? { matches: hold.matches } : {}) }), lapsed: false })
  // A venue rule that forbids it, else a draft that nearly repeats a queued or posted one until it is rewritten.
  const venueHold = ruleHold(venue, row) ?? await draftDuplicateHold(actor.db, row.item_id)
  if (venueHold && (row.state !== 'held' || current?.rule !== venueHold.rule)) return held(venueHold)
  if (!venueHold && row.state === 'held' && current?.kind === 'rule') {
    // A venue rule or full shared limit no longer holds it: back in the queue, unless its period is (still) full.
    const full = row.due_at === null ? null : await limitHold(actor.db, venue, row.due_at, row.id)
    if (full && current.rule !== 'shared_limit') return held(full)
    if (!full) {
      const eligibility = await handoffEligibility(actor.db, venue, row.person_id, now)
      return { statements: move(actor, row, eligibility.join_first ? 'join_first' : 'open', 'rule_cleared', { hold: null },
        { rule: current.rule, reason: current.rule === 'shared_limit' ? `${venue.name} has room in that period now.` : `${venue.name}: the rule that held it no longer applies.` }), lapsed: false }
    }
  }
  if (row.due_at !== null && row.due_at <= now) return { statements: await lapse(actor, row, venue, 'due'), lapsed: true }
  if (row.state === 'join_first' && !(await handoffEligibility(actor.db, venue, row.person_id, now)).join_first) {
    return { statements: move(actor, row, 'open', 'joined', { join_steps: '[]' }, { reason: 'The person is now a member of the venue.' }), lapsed: false }
  }
  return none
}

/** Brings each hand-off in line, one at a time so each sees the places the ones before it took, and counts what changed. */
async function refreshAll(actor: Actor, rows: HandoffRow[]) {
  const venues = new Map<string, VenueRow>()
  let changed = 0, lapsed = 0
  for (const row of rows) {
    if (!venues.has(row.venue_id)) venues.set(row.venue_id, (await readVenue(actor.db, row.venue_id))!)
    const outcome = await refreshRow(actor, row, venues.get(row.venue_id)!)
    if (!outcome.statements.length) continue
    await actor.db.batch(outcome.statements)
    if (outcome.lapsed) lapsed++
    else changed++
  }
  return { changed, lapsed }
}

/** Refreshes and re-reads the given hand-offs. */
export async function refreshed(actor: Actor, rows: HandoffRow[]): Promise<HandoffRow[]> {
  const { changed, lapsed } = await refreshAll(actor, rows)
  if (!changed && !lapsed) return rows
  const ids = rows.map(row => row.id)
  const fresh = (await actor.db.prepare('SELECT * FROM stump_handoffs WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).all<HandoffRow>()).results
  const byId = new Map(fresh.map(row => [row.id, row]))
  return ids.map(id => byId.get(id)!).filter(Boolean)
}

/**
 * The Worker's scheduled tick: every waiting hand-off, refreshed and lapsed where its time has come, each with its history.
 * The draft items at those venues are read against the rules too, with the thread each is aimed at (D-3, STUMP-VENUE-002.3),
 * so a draft inside the venue's promotion thread is never held for self-promotion and one outside it is.
 */
export async function tickHandoffs(env: StumpEnv, now: number): Promise<{ refreshed: number; lapsed: number }> {
  const actor: Actor = { db: env.DB, person: null, agent: null, now: () => now }
  const rows = (await env.DB.prepare("SELECT * FROM stump_handoffs WHERE state IN ('open','join_first','held') ORDER BY due_at,id").all<HandoffRow>()).results
  for (const venueId of new Set(rows.map(row => row.venue_id))) {
    const venue = await readVenue(env.DB, venueId)
    const statements = venue ? await refreshItems(env.DB, venue, actor) : []
    if (statements.length) await env.DB.batch(statements)
  }
  const { changed, lapsed } = await refreshAll(actor, rows)
  return { refreshed: changed, lapsed }
}
