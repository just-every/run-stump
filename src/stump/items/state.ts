// The item state machine every lane moves items through (V1 "Records": Item).
export const ITEM_STATES = ['draft', 'ready', 'scheduled', 'posting', 'posted', 'partly_posted', 'failed', 'uncertain', 'held', 'paused', 'cancelled'] as const
export type ItemState = typeof ITEM_STATES[number]

/** Allowed moves. posted and cancelled are final; uncertain becomes a hold with an owner, never a blind retry (D-5).
 * A send the network refused for now (a rate limit, a day limit, credits, a reconnect) holds with its reason. */
export const TRANSITIONS: Readonly<Record<ItemState, readonly ItemState[]>> = {
  draft: ['ready', 'scheduled', 'held', 'cancelled'],
  ready: ['draft', 'scheduled', 'posting', 'held', 'cancelled'],
  scheduled: ['draft', 'ready', 'posting', 'held', 'paused', 'cancelled'],
  posting: ['posted', 'partly_posted', 'failed', 'uncertain', 'held'],
  posted: [],
  partly_posted: ['posting', 'held', 'cancelled'],
  failed: ['draft', 'scheduled', 'held', 'cancelled'],
  uncertain: ['held', 'posted', 'failed'],
  held: ['draft', 'ready', 'scheduled', 'cancelled'],
  paused: ['scheduled', 'held', 'draft', 'cancelled'],
  cancelled: [],
}

export interface Mover { db: D1Database; person: { id: string } | null; agent: { id: string } | null; now(): number }

/**
 * Move one item from the state it is in to another, recorded in its history.
 * Answers false when the item has moved meanwhile (the guard is the old state).
 * Extra columns set in the same write are named in `set`.
 */
export function moveItem(mover: Mover, item: { id: string; state: ItemState }, to: ItemState, reason: string, set: Record<string, unknown> = {}): D1PreparedStatement[] {
  if (!TRANSITIONS[item.state].includes(to)) throw new Error(`An item cannot move from ${item.state} to ${to}`)
  const columns = Object.keys(set)
  if (columns.some(column => !/^[a-z_]+$/.test(column))) throw new Error('Invalid item column')
  const assignments = ['state=?', 'updated_at=?', ...columns.map(column => `${column}=?`)].join(',')
  const now = mover.now()
  return [
    mover.db.prepare(`UPDATE stump_items SET ${assignments} WHERE id=? AND state=?`).bind(to, now, ...columns.map(column => set[column]), item.id, item.state),
    mover.db.prepare(`INSERT INTO stump_item_history(id,item_id,from_state,to_state,person_id,agent_id,reason,at)
      SELECT ?,?,?,?,?,?,?,? WHERE changes()=1`).bind(crypto.randomUUID(), item.id, item.state, to, mover.person?.id ?? null, mover.agent?.id ?? null, reason, now),
  ]
}

/** The Pause covering an account's items now, if any: all publishing, or that account. */
export async function pauseFor(db: D1Database, accountId: string | null): Promise<{ scope: 'all' | 'account'; account_id: string | null } | null> {
  return db.prepare("SELECT scope,account_id FROM stump_pause WHERE scope_key='all' OR scope_key=? ORDER BY scope='all' DESC LIMIT 1")
    .bind(`account:${accountId ?? ''}`).first<{ scope: 'all' | 'account'; account_id: string | null }>()
}

/** SQL that is true while nothing pauses the item's account; `item` is the stump_items alias. */
export const NOT_PAUSED = (item: string) => `NOT EXISTS(SELECT 1 FROM stump_pause p WHERE p.scope_key='all' OR p.scope_key='account:'||${item}.account_id)`
