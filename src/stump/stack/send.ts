import { stumpFetch } from '../net/fetch.ts'
import type { StumpEnv } from '../env.ts'
import { readConnection, secretOf, type Seed } from './connections.ts'
import { engagerEvent, postSignal, type SendOutcome } from './orbit.ts'
import { readOffer, type OfferRow } from './offers.ts'
import { SealError } from './seal.ts'
import { annotationFor, postAnnotation } from './vane.ts'

interface LedgerRow { id: string; network: string | null; network_id?: string | null; text: string | null; url: string | null; posted_at: number | null; state: string }

export type SendResult =
  | { status: 'sent' | 'failed'; offer: OfferRow; outcome: SendOutcome }
  | { status: 'already_sent'; offer: OfferRow }
  | { status: 'not_connected'; offer: OfferRow; seed: Seed }
  | { status: 'skipped'; offer: OfferRow | null; reason: string }
  | { status: 'dismissed'; offer: OfferRow }

/** A failed send stays offered with its error, so it can be sent again. */
async function record(env: StumpEnv, offer: OfferRow, outcome: SendOutcome, by: string | null, now: number): Promise<OfferRow> {
  await env.DB.batch([
    env.DB.prepare('UPDATE stump_stack_offers SET state=?,attempts=attempts+1,outcome=?,sent_by=?,sent_at=? WHERE id=?')
      .bind(outcome.ok ? 'sent' : 'offered', JSON.stringify(outcome), by, outcome.ok ? now : offer.sent_at, offer.id),
    env.DB.prepare('UPDATE stump_stack_connections SET last_sent_at=?,last_error=? WHERE seed=?').bind(now, outcome.ok ? null : outcome.error ?? 'failed', offer.seed),
  ])
  return (await readOffer(env.DB, offer.id))!
}

/**
 * Sends one offer to its seed and records what the seed answered on the offer. A
 * sent offer is never sent twice; a failed one stays offered with its error and can be
 * sent again, which Orbit and Vane both take as a repeat of the same event.
 */
export async function sendOffer(env: StumpEnv, offerId: string, by: string | null, now: number): Promise<SendResult> {
  const offer = await readOffer(env.DB, offerId)
  if (!offer) throw new Error(`No offer ${offerId}`)
  if (offer.state === 'sent') return { status: 'already_sent', offer }
  if (offer.state === 'dismissed') return { status: 'dismissed', offer }
  const connection = await readConnection(env.DB, offer.seed)
  if (!connection || connection.state !== 'connected') return { status: 'not_connected', offer, seed: offer.seed }
  let secret: string
  try { secret = await secretOf(env, connection) } catch (error) {
    const outcome: SendOutcome = { ok: false, status: null, at: new Date(now).toISOString(), detail: {}, error: error instanceof SealError ? error.message : 'The stored secret could not be read.' }
    return { status: 'failed', offer: await record(env, offer, outcome, by, now), outcome }
  }
  const fetcher = stumpFetch(env)
  let outcome: SendOutcome
  if (offer.kind === 'engager') {
    outcome = await postSignal(fetcher, { origin: connection.origin, source_id: connection.external_id, secret }, engagerEvent(connection.external_id, {
      id: offer.id, network: offer.network!, handle: offer.handle!, display_name: offer.display_name, post_url: offer.post_url!, engagement: offer.engagement, public_email: offer.public_email, network_user_id: offer.network_user_id, occurred_at: offer.occurred_at,
    }), now)
  } else {
    const entry = await env.DB.prepare('SELECT id,network,text,url,posted_at,state FROM stump_ledger WHERE id=?').bind(offer.ledger_id).first<LedgerRow>()
    if (!entry) return { status: 'skipped', offer, reason: 'The ledger entry is gone.' }
    if (entry.state !== 'posted' || entry.posted_at === null) return { status: 'skipped', offer, reason: `A ${entry.state} entry gets no annotation.` }
    outcome = await postAnnotation(fetcher, { origin: connection.origin, secret }, annotationFor(connection.external_id, entry), now)
  }
  return { status: outcome.ok ? 'sent' : 'failed', offer: await record(env, offer, outcome, by, now), outcome }
}

/**
 * The Vane data contract: the posting path calls this once a post is on the ledger
 * and posted. It adds one annotation on the post's day with its link. With Vane not
 * connected the annotation waits as an offer and goes when Vane is connected.
 */
export async function annotateLedgerEntry(env: StumpEnv, entryId: string, by: string | null = null, now = Date.now()): Promise<SendResult> {
  const entry = await env.DB.prepare('SELECT id,network,network_id,url,posted_at,state FROM stump_ledger WHERE id=?').bind(entryId).first<LedgerRow>()
  if (!entry) throw new Error(`No ledger entry ${entryId}`)
  if (entry.state !== 'posted' || entry.posted_at === null) return { status: 'skipped', offer: null, reason: `A ${entry.state} entry gets no annotation.` }
  await env.DB.prepare(`INSERT OR IGNORE INTO stump_stack_offers(id,seed,kind,state,ledger_id,network,network_id,post_url,occurred_at,created_by,created_at)
    VALUES(?,'vane','annotation','offered',?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), entry.id, entry.network, entry.network_id ?? null, entry.url, entry.posted_at, by, now).run()
  const offer = await env.DB.prepare("SELECT id FROM stump_stack_offers WHERE kind='annotation' AND ledger_id=?").bind(entry.id).first<{ id: string }>()
  return sendOffer(env, offer!.id, by, now)
}
