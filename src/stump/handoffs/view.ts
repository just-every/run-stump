// Hand-offs as both doors answer them, read in a few queries for any number:
// the venue, the person's name, the draft item's flags and the draft with the
// company's own links tagged for the hand-off route (STUMP-LINK-001).
import type { ActionContext } from '../actions/types.ts'
import { tagOwnLinks } from '../links/index.ts'
import { readVenue, type VenueRow } from '../venues/model.ts'
import { handoffRecord, historyOf, type HandoffRecord, type HandoffRow } from './model.ts'

export async function records(ctx: Pick<ActionContext, 'db'>, rows: HandoffRow[]): Promise<HandoffRecord[]> {
  if (!rows.length) return []
  const ids = rows.map(row => row.id), history = await historyOf(ctx.db, ids), venues = new Map<string, VenueRow>()
  for (const row of rows) if (!venues.has(row.venue_id)) venues.set(row.venue_id, (await readVenue(ctx.db, row.venue_id))!)
  const people = new Map((await ctx.db.prepare('SELECT id,display_name FROM stump_people WHERE id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify([...new Set(rows.map(row => row.person_id))])).all<{ id: string; display_name: string }>()).results.map(row => [row.id, row.display_name]))
  const items = new Map((await ctx.db.prepare('SELECT id,flags FROM stump_items WHERE id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(rows.map(row => row.item_id).filter(Boolean))).all<{ id: string; flags: string }>()).results.map(row => [row.id, JSON.parse(row.flags) as unknown[]]))
  const out: HandoffRecord[] = []
  for (const row of rows) {
    const venue = venues.get(row.venue_id)!
    const draft = row.draft_text === null ? null : await tagOwnLinks(ctx.db, { text: row.draft_text, route: 'handoff', source: venue.platform ?? venue.name, campaign: row.campaign, content: row.id })
    out.push(handoffRecord(row, venue, { person_name: people.get(row.person_id) ?? null, history: history.get(row.id)!, flags: row.item_id ? items.get(row.item_id) ?? [] : [], draft_text: draft }))
  }
  return out
}

export const one = async (ctx: Pick<ActionContext, 'db'>, id: string) =>
  (await records(ctx, [(await ctx.db.prepare('SELECT * FROM stump_handoffs WHERE id=?').bind(id).first<HandoffRow>())!]))[0]!
