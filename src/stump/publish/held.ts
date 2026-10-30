import type { NotReady } from '../accounts/clients.ts'
import { needsReconnect, type RefusedBecause } from '../accounts/store.ts'
import type { NetworkError, PublishContext, PublishOutcome, RemoveOutcome } from './types.ts'

// What every publisher answers when an account cannot post: the network refused
// its credentials (it reads expired and waits for its owner, STUMP-CONNECT-001.4),
// or it already waits for a reconnect or the company's app.

/** The network refused the account's credentials now: mark it and hold the item with the reconnect step. */
export async function credentialsRefused(ctx: PublishContext, because: RefusedBecause, error: NetworkError): Promise<PublishOutcome> {
  const reason = await needsReconnect(ctx.db, ctx.env, ctx.account, because, ctx.now())
  return { state: 'held', kind: 'reconnect', next_attempt_at: null, error, reason }
}

/** The account could not be opened for posting. */
export const notReady = (opened: NotReady): PublishOutcome => ({
  state: 'held', kind: opened.code === 'app_not_set' ? 'rule' : 'reconnect', next_attempt_at: null,
  error: { code: opened.code, message: opened.message }, ...(opened.reason ? { reason: opened.reason } : {}),
})

/** The network ids of a post Stump made, with a thread's later parts first so a reply never outlives its parent's delete. */
export async function partsToRemove(ctx: Pick<PublishContext, 'db'>, accountId: string, networkId: string): Promise<string[]> {
  const rows = (await ctx.db.prepare(`SELECT network_id FROM stump_item_parts WHERE account_id=? AND item_id=(SELECT item_id FROM stump_item_parts WHERE account_id=? AND network_id=? LIMIT 1)
    ORDER BY part DESC`).bind(accountId, accountId, networkId).all<{ network_id: string }>()).results.map(row => row.network_id)
  return rows.length ? rows : [networkId]
}

/** One answer for a post and its parts: deleted when any went, not_found when none was there, failed on the first refusal. */
export async function removeEach(ids: string[], one: (id: string) => Promise<RemoveOutcome>): Promise<RemoveOutcome> {
  let deleted = false
  for (const id of ids) {
    const answer = await one(id)
    if (answer.outcome === 'failed') return answer
    deleted ||= answer.outcome === 'deleted'
  }
  return { outcome: deleted ? 'deleted' : 'not_found' }
}
