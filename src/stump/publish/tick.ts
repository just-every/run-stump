import { xPrices } from '../accounts/apps.ts'
import { readAccount, saveFollowers, type AccountRow } from '../accounts/store.ts'
import type { StumpEnv } from '../env.ts'
import { moveItem, NOT_PAUSED, type ItemState, type Mover } from '../items/state.ts'
import { annotatePosted, recordOutcome, type LedgerItem } from '../ledger/record.ts'
import { outgoing } from './outgoing.ts'
import { publishers as registered } from './publishers.ts'
import { agentRuleBroken } from './rules.ts'
import type { DueItem, Media, Publisher, PublishOutcome } from './types.ts'

export interface ItemRow extends LedgerItem {
  state: ItemState; format: DueItem['format']; reply_to: string | null; options: string; scheduled_at: number | null; flags: string; hold: string | null; queued: number
}

/** The due item as its network receives it: links to the company's own domains tagged. */
export async function sendable(db: D1Database, row: ItemRow, account: AccountRow): Promise<DueItem> {
  return outgoing(db, await dueItem(db, row, account), row.campaign)
}

/** Agents are paused by the person door's Pause agents, or by Business Pause (BASE-AGENT-011). */
async function agentsPaused(db: D1Database): Promise<boolean> {
  const row = await db.prepare("SELECT local_paused, json_extract(envelope,'$.paused') AS business FROM agent_door_state WHERE id=1").first<{ local_paused: number; business: number | null }>()
  return !!row && (row.local_paused === 1 || row.business === 1)
}

/** True when an agent asked for this item to be published. */
export const agentScheduled = (item: Pick<ItemRow, 'scheduled_by' | 'agent'>) => item.scheduled_by ? !!(JSON.parse(item.scheduled_by) as { agent?: unknown }).agent : !!item.agent
/** Who decides about an item that holds: the person who scheduled it, else the person it speaks for. */
export const holdOwner = (item: Pick<ItemRow, 'scheduled_by' | 'person_id'>) => item.scheduled_by ? (JSON.parse(item.scheduled_by) as { person_id: string }).person_id : item.person_id

const hold = (owner: string, reason: string, extra: Record<string, unknown> = {}) => JSON.stringify({ owner_id: owner, reason, next_attempt_at: null, ...extra })

export async function mediaOf(db: D1Database, itemId: string): Promise<Media[]> {
  const rows = (await db.prepare('SELECT id,name,type,size,alt,bytes FROM stump_media WHERE item_id=? ORDER BY created_at,id').bind(itemId).all<Omit<Media, 'bytes'> & { bytes: ArrayBuffer | number[] }>()).results
  return rows.map(row => ({ ...row, bytes: row.bytes instanceof ArrayBuffer ? new Uint8Array(row.bytes) : Uint8Array.from(row.bytes) }))
}

export async function dueItem(db: D1Database, row: ItemRow, account: AccountRow): Promise<DueItem> {
  return {
    id: row.id, format: row.format, network: account.network, account_id: account.id, person_id: row.person_id, revision: row.revision,
    text: row.text, parts: row.parts ? JSON.parse(row.parts) : null, reply_to: row.reply_to ? JSON.parse(row.reply_to) : null,
    options: JSON.parse(row.options), scheduled_at: row.scheduled_at ?? Date.now(), media: await mediaOf(db, row.id),
  }
}

/**
 * Claims one item for sending: only while it is still in the state and at the
 * exact revision that was read, and while no Pause covers it. Two workers
 * firing for the same item make one post (STUMP-PUBLISH-006.2).
 */
export async function claim(db: D1Database, row: ItemRow, from: 'scheduled' | 'partly_posted', now: number, reason: string): Promise<boolean> {
  const claimed = await db.prepare(`UPDATE stump_items SET state='posting',updated_at=? WHERE id=? AND state=? AND revision=? AND ${NOT_PAUSED('stump_items')} RETURNING id`)
    .bind(now, row.id, from, row.revision).first()
  if (!claimed) return false
  await db.prepare('INSERT INTO stump_item_history(id,item_id,from_state,to_state,reason,at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(), row.id, from, 'posting', reason, now).run()
  return true
}

/** Sends a claimed item through its network's publisher and records the outcome on the item and the ledger. */
export async function deliver(env: StumpEnv, row: ItemRow, mover: Mover, publishers: Readonly<Record<string, Publisher>> = registered): Promise<PublishOutcome> {
  const db = env.DB, posting = { ...row, state: 'posting' as const }
  const account = row.account_id ? await readAccount(db, row.account_id) : null
  const publisher = account ? publishers[account.network] : undefined
  let outcome: PublishOutcome
  if (!account || !publisher) {
    outcome = { state: 'held', kind: 'rule', next_attempt_at: null, error: { code: 'no_publisher', message: `Stump cannot publish to ${row.network ?? 'this item\'s network'} yet.` } }
  } else {
    const broken = agentScheduled(row) ? agentRuleBroken(account) : null
    if (broken) outcome = { state: 'held', kind: 'rule', next_attempt_at: null, error: { code: broken.reason, message: broken.message } }
    else {
      try {
        outcome = await publisher.publish(await sendable(db, row, account), { db, env, account, prices: await xPrices(db), now: () => Date.now() })
      } catch (error) {
        // An exception after a request left may hide a post that went out: never retry it blindly (D-5).
        outcome = { state: 'uncertain', error: { code: 'publisher_error', message: error instanceof Error ? error.message : 'The publisher failed.' } }
      }
    }
  }
  await db.batch(await apply(db, mover, posting, outcome))
  if (outcome.state === 'posted' && account) await afterPosted(env, row.id, account.id, outcome.followers)
  return outcome
}

/**
 * Once a post is read back and on the ledger: the account's follower count as
 * the network reported it, and the entry's annotation in Vane. Neither can undo
 * or hold the post; what Vane answered is recorded on the entry.
 */
export async function afterPosted(env: StumpEnv, itemId: string, accountId: string, followers: number | null | undefined) {
  await saveFollowers(env.DB, accountId, followers, Date.now())
  const entry = await env.DB.prepare("SELECT id FROM stump_ledger WHERE item_id=? AND account_id=? AND route='published' AND state='posted'").bind(itemId, accountId).first<{ id: string }>()
  if (entry) await annotatePosted(env, entry.id)
}

async function apply(db: D1Database, mover: Mover, item: ItemRow & { state: 'posting' }, outcome: PublishOutcome): Promise<D1PreparedStatement[]> {
  const now = mover.now(), owner = holdOwner(item)
  if (outcome.state === 'held') {
    return moveItem(mover, item, 'held', outcome.error.code, { error: JSON.stringify(outcome.error),
      hold: hold(owner, outcome.reason ?? outcome.error.message, { next_attempt_at: outcome.next_attempt_at === null ? null : new Date(outcome.next_attempt_at).toISOString(), kind: outcome.kind, code: outcome.error.code }) })
  }
  if (outcome.state === 'failed') {
    return [...moveItem(mover, item, 'failed', outcome.error.code, { error: JSON.stringify(outcome.error), hold: null }),
      ...await recordOutcome(db, item, { state: 'failed', url: null, network_id: null, error: outcome.error }, now)]
  }
  if (outcome.state === 'uncertain') {
    const reason = 'The network did not confirm this post. Check it before trying again.'
    return [...moveItem(mover, item, 'uncertain', outcome.error.code, { error: JSON.stringify(outcome.error), hold: hold(owner, reason, { kind: 'uncertain', code: outcome.error.code }) }),
      ...await recordOutcome(db, item, { state: 'uncertain', url: null, network_id: null, error: outcome.error, hold: { owner_id: owner, reason } }, now)]
  }
  if (outcome.state === 'partly_posted') {
    return [...moveItem(mover, item, 'partly_posted', outcome.error.code, { url: outcome.url, network_id: outcome.network_id, error: JSON.stringify(outcome.error) }),
      ...await recordOutcome(db, item, { state: 'failed', url: outcome.url, network_id: outcome.network_id, error: outcome.error }, now)]
  }
  return [
    ...moveItem(mover, item, 'posted', 'network confirmed', { url: outcome.url, network_id: outcome.network_id, posted_at: outcome.posted_at, error: null, hold: null }),
    ...await recordOutcome(db, item, { state: 'posted', url: outcome.url, network_id: outcome.network_id, text: outcome.text, posted_at: outcome.posted_at }, now),
  ]
}

/**
 * The scheduler tick (the Worker's scheduled event): items whose wait for a
 * rate limit or day limit is over go back on the schedule; then every due item
 * no Pause covers goes out through its network's publisher, one claim at a
 * time. While agents are paused, items an agent scheduled are not sent; once
 * due they hold until a person reschedules them.
 */
export async function publishDue(env: StumpEnv, now = Date.now(), publishers: Readonly<Record<string, Publisher>> = registered) {
  const db = env.DB, mover: Mover = { db, person: null, agent: null, now: () => now }
  const sent: string[] = [], held: string[] = []
  const waiting = (await db.prepare(`SELECT * FROM stump_items i WHERE state='held' AND json_extract(hold,'$.kind') IN ('rate_limit','day_limit')
    AND json_extract(hold,'$.next_attempt_at') IS NOT NULL AND json_extract(hold,'$.next_attempt_at')<=? AND ${NOT_PAUSED('i')} LIMIT 25`).bind(new Date(now).toISOString()).all<ItemRow>()).results
  for (const item of waiting) await db.batch(moveItem(mover, item, 'scheduled', 'next attempt time', { scheduled_at: now, hold: null }))
  const agentHold = await agentsPaused(db)
  const due = (await db.prepare(`SELECT * FROM stump_items i WHERE state='scheduled' AND scheduled_at<=? AND ${NOT_PAUSED('i')} ORDER BY scheduled_at,id LIMIT 25`).bind(now).all<ItemRow>()).results
  for (const item of due) {
    if (agentHold && agentScheduled(item)) {
      await db.batch(moveItem(mover, item, 'held', 'agents paused', { hold: hold(holdOwner(item), 'Its time passed while agents were paused. Reschedule or drop it.', { kind: 'agents_paused' }) }))
      held.push(item.id); continue
    }
    if (!await claim(db, item, 'scheduled', now, 'scheduled time')) continue
    await deliver(env, item, mover, publishers)
    sent.push(item.id)
  }
  return { sent, held }
}
