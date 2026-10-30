import type { StumpEnv } from '../env.ts'
import { retryDueDeliveries } from './alerts.ts'
import { claimLease, pollWatch } from './poll.ts'
import { readWatch } from './store.ts'

/** Watches one scheduled tick polls at most; the rest wait for the next minute. */
const PER_TICK = 3

/**
 * The scheduled event's share for watches: each watch whose own interval has come is polled (its
 * sources keep their own cadence and rate limits), then alerts a receiver asked to retry go again.
 */
export async function pollDueWatches(env: StumpEnv, now = Date.now()) {
  const ctx = { db: env.DB, env, now: () => Date.now() }
  const due = (await env.DB.prepare(`SELECT id FROM stump_watches WHERE sources<>'[]' AND (next_poll_at IS NULL OR next_poll_at<=?) AND (lease_until IS NULL OR lease_until<?) ORDER BY next_poll_at IS NOT NULL,next_poll_at,id LIMIT ?`)
    .bind(now, now, PER_TICK).all<{ id: string }>()).results
  const polled: string[] = []
  for (const { id } of due) {
    if (!await claimLease(env.DB, id, now)) continue
    try {
      const watch = await readWatch(env.DB, id)
      if (watch) { await pollWatch(ctx, watch, { manual: false }); polled.push(id) }
    } catch (error) {
      // One watch failing never stops the others; its lease lapses and it is polled again.
      await env.DB.prepare('UPDATE stump_watches SET lease_until=NULL WHERE id=?').bind(id).run()
      console.error(`watch ${id} poll failed`, error instanceof Error ? error.message : 'unknown')
    }
  }
  const redelivered = await retryDueDeliveries(ctx)
  return { polled, redelivered }
}
