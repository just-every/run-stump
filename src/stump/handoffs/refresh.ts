// Each act on a hand-off reads the venue's rules and the person's membership as
// they are now (D-3, STUMP-HANDOFF-003.3, .4, STUMP-VENUE-006.3): a hold whose
// review date has come returns to the queue, a rule that newly forbids the post
// holds it with the rule named, a rule that no longer applies releases it, and a
// person who has joined moves from join-first to open.
import { handoffEligibility } from '../venues/members.ts'
import { readVenue, rulesOf, type VenueRow } from '../venues/model.ts'
import { holdFor, routesFor } from '../venues/rules.ts'
import { ACTIVE, move, type Actor, type HandoffRow, type Hold } from './model.ts'

export interface RuleHold { rule: string; reason: string; source_url: string | null }

/** The venue rule that forbids this hand-off now, if any. */
export function ruleHold(venue: VenueRow, handoff: { draft_text: string | null; thread_url: string | null }): RuleHold | null {
  const answer = routesFor(venue), rules = rulesOf(venue)
  const sourceOf = (rule: string | null) => rule && Object.hasOwn(rules, rule) ? rules[rule as keyof typeof rules]?.source_url ?? null : null
  if (!answer.routes.includes('handoff_draft') && !answer.routes.includes('handoff_brief')) {
    const closed = answer.reasons.find(reason => !reason.open)!
    return { rule: closed.rule ?? 'status', reason: `${venue.name}: ${closed.because}`, source_url: sourceOf(closed.rule) }
  }
  // A generated draft where the venue no longer takes AI-written text waits for the person's own words.
  if (handoff.draft_text !== null && !answer.routes.includes('handoff_draft')) {
    const reason = answer.reasons.find(entry => entry.route === 'handoff_draft')!
    return { rule: 'ai_text', reason: `${venue.name}: ${reason.because} The draft cannot be posted there.`, source_url: sourceOf('ai_text') }
  }
  const hold = holdFor(venue, { id: '', state: 'draft', format: 'post', account_id: null, text: handoff.draft_text, parts: null, reply_to: null,
    options: JSON.stringify({ thread_url: handoff.thread_url }), routes: '[]', flags: '[]', hold: null })
  return hold ? { rule: hold.rule, reason: hold.reason, source_url: hold.source_url } : null
}

export const ruleHoldJson = (hold: RuleHold, now: number) => JSON.stringify({ kind: 'rule', reason: hold.reason, rule: hold.rule, source_url: hold.source_url, by: null, by_name: null, agent: null, review_at: null, at: new Date(now).toISOString() } satisfies Hold)

/** Statements that bring these hand-offs in line with their venues' rules and their people's membership now. */
export async function refresh(actor: Actor, rows: HandoffRow[], venues = new Map<string, VenueRow>()): Promise<D1PreparedStatement[]> {
  const statements: D1PreparedStatement[] = []
  for (const row of rows) {
    if (!ACTIVE.includes(row.state)) continue
    if (!venues.has(row.venue_id)) venues.set(row.venue_id, (await readVenue(actor.db, row.venue_id))!)
    const venue = venues.get(row.venue_id)!, hold = ruleHold(venue, row)
    const current = row.hold ? JSON.parse(row.hold) as Hold : null
    // A person's hold ends at its review date and the hand-off is back in the queue (STUMP-HANDOFF-003.3).
    if (row.state === 'held' && current?.kind === 'person' && current.review_at && Date.parse(current.review_at) <= actor.now()) {
      const joined = !(await handoffEligibility(actor.db, venue, row.person_id, actor.now())).join_first
      statements.push(...move(actor, row, joined ? 'open' : 'join_first', 'review_date', { hold: null }, { held_by: current.by, reason: current.reason, review_at: current.review_at }))
      continue
    }
    if (hold && row.state !== 'held') {
      statements.push(...move(actor, row, 'held', 'rule_hold', { hold: ruleHoldJson(hold, actor.now()) }, { rule: hold.rule, reason: hold.reason, source_url: hold.source_url }))
      continue
    }
    if (hold && current?.kind === 'rule' && current.rule !== hold.rule) {
      statements.push(...move(actor, row, 'held', 'rule_hold', { hold: ruleHoldJson(hold, actor.now()) }, { rule: hold.rule, reason: hold.reason, source_url: hold.source_url }))
      continue
    }
    const eligibility = await handoffEligibility(actor.db, venue, row.person_id, actor.now())
    if (!hold && row.state === 'held' && current?.kind === 'rule') {
      statements.push(...move(actor, row, eligibility.join_first ? 'join_first' : 'open', 'rule_cleared', { hold: null }, { rule: current.rule, reason: `${venue.name}: the rule that held it no longer applies.` }))
    } else if (row.state === 'join_first' && !eligibility.join_first) {
      statements.push(...move(actor, row, 'open', 'joined', { join_steps: '[]' }, { reason: 'The person is now a member of the venue.' }))
    }
  }
  return statements
}

/** Refreshes and re-reads the given hand-offs. */
export async function refreshed(actor: Actor, rows: HandoffRow[]): Promise<HandoffRow[]> {
  const statements = await refresh(actor, rows)
  if (!statements.length) return rows
  await actor.db.batch(statements)
  const ids = rows.map(row => row.id)
  const fresh = (await actor.db.prepare('SELECT * FROM stump_handoffs WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).all<HandoffRow>()).results
  const byId = new Map(fresh.map(row => [row.id, row]))
  return ids.map(id => byId.get(id)!).filter(Boolean)
}
