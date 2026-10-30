import type { ItemRow } from './tick.ts'

// The item record every door answers (V1 "Records": Item). Media bytes stay in Stump.

const json = <T>(value: string | null): T | null => value ? JSON.parse(value) as T : null
const iso = (value: number | null) => value === null ? null : new Date(value).toISOString()

export interface FullItemRow extends ItemRow {
  master_id: string | null; routes: string; sources: string; ai: string | null; url: string | null; network_id: string | null; time_zone: string | null
  posted_at: number | null; error: string | null; recipient: string | null; subject: string | null; differs_from_master: number; created_at: number; updated_at: number
}

export const readItem = (db: D1Database, id: string) => db.prepare('SELECT * FROM stump_items WHERE id=?').bind(id).first<FullItemRow>()

export async function itemView(db: D1Database, row: FullItemRow) {
  const media = (await db.prepare('SELECT id,name,type,size,alt FROM stump_media WHERE item_id=? ORDER BY created_at,id').bind(row.id).all<{ id: string; name: string; type: string; size: number; alt: string | null }>()).results
  const history = (await db.prepare('SELECT from_state,to_state,person_id,agent_id,reason,at FROM stump_item_history WHERE item_id=? ORDER BY at DESC,id LIMIT 50').bind(row.id)
    .all<{ from_state: string | null; to_state: string; person_id: string | null; agent_id: string | null; reason: string | null; at: number }>()).results
  const parts = (await db.prepare('SELECT part,network_id,url FROM stump_item_parts WHERE item_id=? ORDER BY part').bind(row.id).all<{ part: number; network_id: string; url: string }>()).results
  const charge = await db.prepare('SELECT COALESCE(SUM(usd_micro),0) AS micro FROM stump_network_calls WHERE item_id=?').bind(row.id).first<{ micro: number }>()
  return {
    id: row.id, format: row.format, network: row.network, account_id: row.account_id, venue_id: row.venue_id, person_id: row.person_id, product_id: row.product_id,
    master_id: row.master_id, state: row.state, revision: row.revision, text: row.text, parts: json<string[]>(row.parts), flags: json<unknown[]>(row.flags) ?? [],
    routes: json<unknown[]>(row.routes) ?? [], claims_used: json<unknown[]>(row.claims_used) ?? [], sources: json<unknown[]>(row.sources) ?? [], ai: json(row.ai),
    media, url: row.url, network_id: row.network_id, posted_parts: parts, scheduled_at: iso(row.scheduled_at), time_zone: row.time_zone, queued: row.queued === 1,
    posted_at: iso(row.posted_at), hold: json(row.hold), error: json(row.error), recipient: json(row.recipient), subject: row.subject, reply_to: json(row.reply_to),
    options: json(row.options) ?? {}, differs_from_master: row.differs_from_master === 1, agent: json(row.agent), scheduled_by: json(row.scheduled_by),
    charges_usd: (charge?.micro ?? 0) / 1e6,
    history: history.map(entry => ({ ...entry, at: iso(entry.at) })),
  }
}
