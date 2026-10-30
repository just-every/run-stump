// A venue's shared limit: how often the company as a whole may post there,
// across every product and person (STUMP-VENUE-003.4, .6). Usage is counted
// live from what is scheduled, handed off and on the ledger, so cancelling an
// item frees its place at once.
import { moveItem, type ItemState, type Mover } from '../items/state.ts'
import { limitOf, type Period, type SharedLimit, type VenueRow } from './model.ts'

const DAY = 86_400_000

/** The calendar period holding `at`, in UTC: weeks start on Monday. */
export function periodOf(at: number, per: Period): { start: number; end: number } {
  const date = new Date(at), y = date.getUTCFullYear(), m = date.getUTCMonth()
  const day = Date.UTC(y, m, date.getUTCDate())
  switch (per) {
    case 'day': return { start: day, end: day + DAY }
    case 'week': { const start = day - ((date.getUTCDay() + 6) % 7) * DAY; return { start, end: start + 7 * DAY } }
    case 'month': return { start: Date.UTC(y, m, 1), end: Date.UTC(y, m + 1, 1) }
    case 'quarter': { const q = m - (m % 3); return { start: Date.UTC(y, q, 1), end: Date.UTC(y, q + 3, 1) } }
    case 'year': return { start: Date.UTC(y, 0, 1), end: Date.UTC(y + 1, 0, 1) }
  }
}

// Scheduled and going-out items hold a place; posted ones count through their ledger entry.
const PLACED: readonly ItemState[] = ['scheduled', 'posting', 'paused', 'uncertain']

export interface Counted { kind: 'item' | 'handoff' | 'ledger'; id: string; at: string }

/** What counts against the limit in one period, apart from `except` (an item being placed). */
export async function counted(db: D1Database, venueId: string, window: { start: number; end: number }, except: string | null = null): Promise<Counted[]> {
  const rows = (await db.prepare(`
    SELECT 'item' AS kind,id,scheduled_at AS at FROM stump_items WHERE venue_id=?1 AND state IN (SELECT value FROM json_each(?2)) AND scheduled_at>=?3 AND scheduled_at<?4 AND id IS NOT ?5
    UNION ALL SELECT 'handoff',id,due_at FROM stump_handoffs WHERE venue_id=?1 AND state IN ('open','join_first') AND due_at>=?3 AND due_at<?4
    UNION ALL SELECT 'ledger',id,posted_at FROM stump_ledger WHERE venue_id=?1 AND state='posted' AND route IN ('published','handed_off') AND posted_at>=?3 AND posted_at<?4
      AND (item_id IS NULL OR item_id IS NOT ?5)
    ORDER BY at,id`).bind(venueId, JSON.stringify(PLACED), window.start, window.end, except).all<{ kind: Counted['kind']; id: string; at: number }>()).results
  return rows.map(row => ({ kind: row.kind, id: row.id, at: new Date(row.at).toISOString() }))
}

export interface Usage { limit: SharedLimit | null; window: { start: string; end: string } | null; used: number; counted: Counted[]; open: boolean; next_open_at: string | null }

/** The limit's use in the period holding `at`, and when the next post is allowed. */
export async function usage(db: D1Database, venue: Pick<VenueRow, 'id' | 'shared_limit'>, at: number, except: string | null = null): Promise<Usage> {
  const limit = limitOf(venue)
  if (!limit) return { limit: null, window: null, used: 0, counted: [], open: true, next_open_at: null }
  let window = periodOf(at, limit.per)
  const first = await counted(db, venue.id, window, except)
  const result = { limit, window: { start: new Date(window.start).toISOString(), end: new Date(window.end).toISOString() }, used: first.length, counted: first }
  if (first.length < limit.posts) return { ...result, open: true, next_open_at: new Date(Math.max(at, window.start)).toISOString() }
  // The first later period with room, looking a year ahead.
  for (let step = 0; step < 400; step++) {
    window = periodOf(window.end, limit.per)
    if ((await counted(db, venue.id, window, except)).length < limit.posts) return { ...result, open: false, next_open_at: new Date(window.start).toISOString() }
    if (window.start - at > 366 * DAY) break
  }
  return { ...result, open: false, next_open_at: null }
}

/**
 * The hold an item placed at this venue at `at` meets, if the shared limit is
 * full in that period: the rule and the next open date (STUMP-VENUE-003.4, D-3).
 * The scheduling path calls this before it schedules an item at a venue.
 */
export async function sharedLimitHold(db: D1Database, venue: Pick<VenueRow, 'id' | 'name' | 'shared_limit'>, at: number, itemId: string | null) {
  const use = await usage(db, venue, at, itemId)
  if (use.open || !use.limit) return null
  const per = use.limit.per, posts = use.limit.posts
  return { rule: 'shared_limit' as const, venue_id: venue.id, reason: `${venue.name} takes ${posts} post${posts === 1 ? '' : 's'} a ${per} from the whole company, and this ${per} is full.`, next_open_at: use.next_open_at }
}

/**
 * After a limit changes, scheduled items beyond it in any period are held with
 * the next open date, earliest first keeping their places.
 */
export async function holdOverLimit(db: D1Database, venue: VenueRow, mover: Mover): Promise<D1PreparedStatement[]> {
  const limit = limitOf(venue)
  if (!limit) return []
  const items = (await db.prepare("SELECT id,state,scheduled_at FROM stump_items WHERE venue_id=? AND state='scheduled' AND scheduled_at IS NOT NULL ORDER BY scheduled_at,id")
    .bind(venue.id).all<{ id: string; state: ItemState; scheduled_at: number }>()).results
  const statements: D1PreparedStatement[] = [], placed = new Map<number, number>(), over: typeof items = []
  for (const item of items) {
    const window = periodOf(item.scheduled_at, limit.per)
    // Places already taken in the period by hand-offs and posts, counted once per period.
    if (!placed.has(window.start)) placed.set(window.start, (await counted(db, venue.id, window)).filter(entry => entry.kind !== 'item').length)
    const used = placed.get(window.start)!
    if (used >= limit.posts) over.push(item)
    else placed.set(window.start, used + 1)
  }
  for (const item of over) {
    const hold = await sharedLimitHold(db, venue, item.scheduled_at, item.id)
    const next = hold?.next_open_at ?? null
    statements.push(...moveItem(mover, item, 'held', `${venue.name}: shared limit of ${limit.posts} a ${limit.per} is full`, {
      hold: JSON.stringify({ owner_id: mover.person?.id ?? null, reason: hold?.reason ?? `${venue.name}'s shared limit is full.`, rule: 'shared_limit', venue_id: venue.id, next_attempt_at: next }),
    }))
  }
  return statements
}
