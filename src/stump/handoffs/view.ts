// Hand-offs as both doors answer them, read in a few queries for any number:
// the venue, the person's and product's names, the draft item's flags and the draft with the
// company's own links tagged for the hand-off route (STUMP-LINK-001).
import { shortContent } from './link-content.ts'
import type { ActionContext } from '../actions/types.ts'
import { tagOwnLinks } from '../links/index.ts'
import { readVenue, type VenueRow } from '../venues/model.ts'
import { handoffRecord, historyOf, type HandoffRecord, type HandoffRow } from './model.ts'

export async function records(ctx: Pick<ActionContext, 'db'>, rows: HandoffRow[]): Promise<HandoffRecord[]> {
  if (!rows.length) return []
  const ids = rows.map(row => row.id), history = await historyOf(ctx.db, ids), venues = new Map<string, VenueRow>()
  for (const row of rows) if (!venues.has(row.venue_id)) venues.set(row.venue_id, (await readVenue(ctx.db, row.venue_id))!)
  const people = new Map((await ctx.db.prepare('SELECT id,display_name FROM stump_people WHERE id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify([...new Set(rows.flatMap(row => [row.person_id, row.created_by]))])).all<{ id: string; display_name: string }>()).results.map(row => [row.id, row.display_name]))
  const products = new Map((await ctx.db.prepare('SELECT id,name FROM stump_products WHERE id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify([...new Set(rows.map(row => row.product_id).filter(Boolean))])).all<{ id: string; name: string }>()).results.map(row => [row.id, row.name]))
  const items = new Map((await ctx.db.prepare('SELECT id,flags,ai FROM stump_items WHERE id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(rows.map(row => row.item_id).filter(Boolean))).all<{ id: string; flags: string; ai: string | null }>()).results
    .map(row => [row.id, { flags: JSON.parse(row.flags) as unknown[], ai: row.ai === null ? null : JSON.parse(row.ai) as { fields_sent?: string[] } }]))
  const out: HandoffRecord[] = []
  for (const row of rows) {
    const venue = venues.get(row.venue_id)!
    const draft = row.draft_text === null ? null : await tagOwnLinks(ctx.db, { text: row.draft_text, route: 'handoff', source: venue.platform ?? venue.name, campaign: row.campaign, content: shortContent(row.id) })
    const item = row.item_id ? items.get(row.item_id) : undefined
    // Who wrote the draft: a draft generated with the person's voice guide is in their voice; any other is the preparer's words.
    const drafted = row.draft_text === null ? null : { ai: !!item?.ai, in_voice: !!item?.ai?.fields_sent?.includes('voice'), by: { person_id: row.created_by, name: people.get(row.created_by) ?? null } }
    out.push(handoffRecord(row, venue, { person_name: people.get(row.person_id) ?? null, product_name: row.product_id ? products.get(row.product_id) ?? null : null, history: history.get(row.id)!, flags: item?.flags ?? [], draft_text: draft, drafted }))
  }
  return out
}

export const one = async (ctx: Pick<ActionContext, 'db'>, id: string) =>
  (await records(ctx, [(await ctx.db.prepare('SELECT * FROM stump_handoffs WHERE id=?').bind(id).first<HandoffRow>())!]))[0]!
