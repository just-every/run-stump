import type { Seed } from './connections.ts'

export interface OfferRow {
  id: string; seed: Seed; kind: 'engager' | 'annotation'; state: 'offered' | 'sent' | 'failed' | 'dismissed'; ledger_id: string | null
  network: string | null; handle: string | null; display_name: string | null; post_url: string | null; engagement: string | null; public_email: string | null
  occurred_at: number; attempts: number; outcome: string | null; created_by: string | null; created_at: number; sent_by: string | null; sent_at: number | null
}

const iso = (at: number | null) => at === null ? null : new Date(at).toISOString()

export function publicOffer(row: OfferRow) {
  return {
    id: row.id, seed: row.seed, kind: row.kind, state: row.state, ledger_id: row.ledger_id, network: row.network, handle: row.handle, display_name: row.display_name,
    post_url: row.post_url, engagement: row.engagement, email: row.public_email, occurred_at: iso(row.occurred_at), attempts: row.attempts,
    outcome: row.outcome ? JSON.parse(row.outcome) as Record<string, unknown> : null, created_at: iso(row.created_at), sent_by: row.sent_by, sent_at: iso(row.sent_at),
  }
}

export async function readOffer(db: D1Database, id: string): Promise<OfferRow | null> {
  return db.prepare('SELECT * FROM stump_stack_offers WHERE id=?').bind(id).first<OfferRow>()
}

function filtered(filter: { state?: string; seed?: string }) {
  const where: string[] = [], values: string[] = []
  if (filter.state) { where.push('state=?'); values.push(filter.state) }
  if (filter.seed) { where.push('seed=?'); values.push(filter.seed) }
  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', values }
}

/** How many offers match, and how many of those are people (engagers): what a read of the list exposes. */
export async function countOffers(db: D1Database, filter: { state?: string; seed?: string }) {
  const { clause, values } = filtered(filter)
  const row = await db.prepare(`SELECT COUNT(*) AS offers, COALESCE(SUM(kind='engager'),0) AS people FROM stump_stack_offers ${clause}`).bind(...values).first<{ offers: number; people: number }>()
  return { offers: row?.offers ?? 0, people: row?.people ?? 0 }
}

export async function listOffers(db: D1Database, filter: { state?: string; seed?: string }) {
  const { clause, values } = filtered(filter)
  const rows = (await db.prepare(`SELECT * FROM stump_stack_offers ${clause} ORDER BY created_at DESC,id LIMIT 200`).bind(...values).all<OfferRow>()).results
  const total = await db.prepare(`SELECT COUNT(*) AS n FROM stump_stack_offers ${clause}`).bind(...values).first<{ n: number }>()
  return { items: rows.map(publicOffer), total: total?.n ?? 0 }
}

export interface NewEngager {
  network: string
  handle: string
  display_name?: string | null
  post_url: string
  /** What the person did, in a word or two: asked a question, replied, mentioned the product. */
  engagement?: string | null
  /** Only an email the person shows publicly on their own profile. */
  public_email?: string | null
  occurred_at: number
}

/**
 * The inbox lane offers an engager to Orbit by calling this. The same person on the
 * same post is one offer however often it is offered.
 */
export async function offerEngager(db: D1Database, input: NewEngager, by: string | null, now: number): Promise<OfferRow> {
  const network = input.network.trim().toLowerCase(), handle = input.handle.trim()
  await db.prepare(`INSERT OR IGNORE INTO stump_stack_offers(id,seed,kind,state,network,handle,display_name,post_url,engagement,public_email,occurred_at,created_by,created_at)
    VALUES(?,'orbit','engager','offered',?,?,?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(), network, handle, input.display_name ?? null, input.post_url, input.engagement ?? null, input.public_email ?? null, input.occurred_at, by, now).run()
  return (await db.prepare("SELECT * FROM stump_stack_offers WHERE kind='engager' AND network=? AND handle=? AND post_url=?").bind(network, handle, input.post_url).first<OfferRow>())!
}
