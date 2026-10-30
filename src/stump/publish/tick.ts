import type { StumpEnv } from '../env.ts'
import { moveItem, NOT_PAUSED, type ItemState, type Mover } from '../items/state.ts'
import { stumpFetch } from '../net/fetch.ts'
import { publishers as registered } from './publishers.ts'
import type { DueItem, Publisher, PublishOutcome } from './types.ts'

interface Row { id: string; state: ItemState; format: DueItem['format']; network: string | null; account_id: string | null; person_id: string; revision: number
  text: string | null; parts: string | null; reply_to: string | null; options: string; scheduled_at: number; agent: string | null; venue_id: string | null
  product_id: string | null; campaign: string | null; approved_by: string | null; claims_used: string }

/** Agents are paused by the person door's Pause agents, or by Business Pause (BASE-AGENT-011). */
async function agentsPaused(db: D1Database): Promise<boolean> {
  const row = await db.prepare("SELECT local_paused, json_extract(envelope,'$.paused') AS business FROM agent_door_state WHERE id=1").first<{ local_paused: number; business: number | null }>()
  return !!row && (row.local_paused === 1 || row.business === 1)
}

const hold = (ownerId: string, reason: string) => JSON.stringify({ owner_id: ownerId, reason, next_attempt_at: null })

/**
 * The scheduler tick (the Worker's scheduled event): sends every due item no
 * Pause covers through its network's publisher, one claim at a time. Nothing
 * a paused scope covers is sent. While agents are paused, items an agent
 * scheduled are not sent; once due they hold until a person reschedules them.
 */
export async function publishDue(env: StumpEnv, now = Date.now(), publishers: Readonly<Record<string, Publisher>> = registered) {
  const db = env.DB, mover: Mover = { db, person: null, agent: null, now: () => now }
  const sent: string[] = [], held: string[] = []
  const agentHold = await agentsPaused(db)
  const due = (await db.prepare(`SELECT * FROM stump_items i WHERE state='scheduled' AND scheduled_at<=? AND ${NOT_PAUSED('i')} ORDER BY scheduled_at,id LIMIT 25`).bind(now).all<Row>()).results
  for (const item of due) {
    const publisher = item.network ? publishers[item.network] : undefined
    if (agentHold && item.agent) {
      await db.batch(moveItem(mover, item, 'held', 'agents paused', { hold: hold(item.person_id, 'Its time passed while agents were paused. Reschedule or drop it.') }))
      held.push(item.id); continue
    }
    if (!publisher || !item.account_id || !item.network) {
      await db.batch(moveItem(mover, item, 'held', 'no publisher', { hold: hold(item.person_id, `Stump cannot publish to ${item.network ?? 'this item\'s network'} yet.`) }))
      held.push(item.id); continue
    }
    // Claim it: only one tick sends an item, and only while no Pause covers it.
    const claim = await db.prepare(`UPDATE stump_items SET state='posting',updated_at=? WHERE id=? AND state='scheduled' AND ${NOT_PAUSED('stump_items')} RETURNING id`).bind(now, item.id).first()
    if (!claim) continue
    await db.prepare("INSERT INTO stump_item_history(id,item_id,from_state,to_state,reason,at) VALUES(?,?,'scheduled','posting','scheduled time',?)").bind(crypto.randomUUID(), item.id, now).run()
    const posting = { ...item, state: 'posting' as const }
    let outcome: PublishOutcome
    try {
      outcome = await publisher.publish({ id: item.id, format: item.format, network: item.network, account_id: item.account_id, person_id: item.person_id, revision: item.revision,
        text: item.text, parts: item.parts ? JSON.parse(item.parts) : null, reply_to: item.reply_to ? JSON.parse(item.reply_to) : null,
        options: JSON.parse(item.options), scheduled_at: item.scheduled_at }, { db, env, fetch: stumpFetch(env), now: () => Date.now() })
    } catch (error) {
      // An exception after the request left may hide a post that went out: never retry it blindly (D-5).
      outcome = { state: 'uncertain', error: { code: 'publisher_error', message: error instanceof Error ? error.message : 'The publisher failed.' } }
    }
    await db.batch(await apply(db, mover, posting, outcome))
    sent.push(item.id)
  }
  return { sent, held }
}

async function apply(db: D1Database, mover: Mover, item: Row & { state: 'posting' }, outcome: PublishOutcome): Promise<D1PreparedStatement[]> {
  if (outcome.state === 'failed') return moveItem(mover, item, 'failed', outcome.error.code, { error: JSON.stringify(outcome.error) })
  if (outcome.state === 'uncertain') return moveItem(mover, item, 'uncertain', outcome.error.code, { error: JSON.stringify(outcome.error), hold: hold(item.person_id, 'The network did not confirm this post. Check it before trying again.') })
  if (outcome.state === 'partly_posted') return moveItem(mover, item, 'partly_posted', outcome.error.code, { url: outcome.url, network_id: outcome.network_id, error: JSON.stringify(outcome.error) })
  const person = await db.prepare('SELECT display_name FROM stump_people WHERE id=?').bind(item.person_id).first<{ display_name: string }>()
  const agent = item.agent ? JSON.parse(item.agent) as { id: string; name: string } : null
  const by = agent ? `${agent.name} for ${person?.display_name ?? item.person_id}` : person?.display_name ?? item.person_id
  return [
    ...moveItem(mover, item, 'posted', 'network confirmed', { url: outcome.url, network_id: outcome.network_id, posted_at: outcome.posted_at }),
    db.prepare(`INSERT INTO stump_ledger(id,item_id,url,network,network_id,venue_id,account_id,person_id,agent,by_label,text,claims,product_id,campaign,route,state,confirmation,revision,posted_at,charge_usd,approved_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'published','posted','network',?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(), item.id, outcome.url, item.network, outcome.network_id, item.venue_id, item.account_id, item.person_id, item.agent, by,
        outcome.text ?? item.text, item.claims_used, item.product_id, item.campaign, item.revision, outcome.posted_at, outcome.charge_usd ?? null, item.approved_by, mover.now(), mover.now()),
  ]
}
