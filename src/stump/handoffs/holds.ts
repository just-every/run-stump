// What holds a hand-off at its venue (D-3): a venue rule that forbids it now,
// read from the rules as they are, or the company's shared limit there being
// full in its due period (STUMP-VENUE-003.4), held with the next open date.
import { usage } from '../venues/limits.ts'
import { rulesOf, type VenueRow } from '../venues/model.ts'
import { holdFor, routesFor } from '../venues/rules.ts'
import type { Hold } from './model.ts'

export interface RuleHold { rule: string; reason: string; source_url: string | null; next_open_at?: string | null }

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

/**
 * The shared-limit hold a hand-off due at `at` meets, if the company's limit at
 * the venue is full in that period apart from the hand-off itself: the rule, the
 * reason and the first later period with room. Null when there is room.
 */
export async function limitHold(db: D1Database, venue: VenueRow, at: number, self: string | null): Promise<RuleHold | null> {
  const use = await usage(db, venue, at)
  if (!use.limit) return null
  const others = use.counted.filter(entry => !(entry.kind === 'handoff' && entry.id === self))
  if (others.length < use.limit.posts) return null
  const { posts, per } = use.limit
  // The first later period with room, as the venue counts it: the hand-off holds no place outside its own period.
  return { rule: 'shared_limit', reason: `${venue.name} takes ${posts} post${posts === 1 ? '' : 's'} a ${per} from the whole company, and this ${per} is full.`, source_url: null, next_open_at: use.next_open_at }
}

export const ruleHoldJson = (hold: RuleHold, now: number) => JSON.stringify({ kind: 'rule', reason: hold.reason, rule: hold.rule, source_url: hold.source_url, by: null, by_name: null, agent: null,
  review_at: null, at: new Date(now).toISOString(), ...(hold.next_open_at !== undefined ? { next_open_at: hold.next_open_at } : {}) } satisfies Hold)
