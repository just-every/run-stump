// Hand-offs as both doors answer them, read in a few queries for any number:
// the venue, the person's and product's names, the draft item's flags, the draft with the
// company's own links tagged for the hand-off route (STUMP-LINK-001), and the product's own
// link tagged the same way for the person to paste, so the post joins to its signups.
import { shortContent } from './link-content.ts'
import type { ActionContext } from '../actions/types.ts'
import { readRules, tagOwnLinks, type StoredRules } from '../links/index.ts'
import { tagLinks } from '../lib/text/index.ts'
import { readVenue, rulesOf, type VenueRow } from '../venues/model.ts'
import { handoffRecord, historyOf, type HandoffRecord, type HandoffRow } from './model.ts'

export async function records(ctx: Pick<ActionContext, 'db'>, rows: HandoffRow[]): Promise<HandoffRecord[]> {
  if (!rows.length) return []
  const ids = rows.map(row => row.id), history = await historyOf(ctx.db, ids), venues = new Map<string, VenueRow>()
  for (const row of rows) if (!venues.has(row.venue_id)) venues.set(row.venue_id, (await readVenue(ctx.db, row.venue_id))!)
  const people = new Map((await ctx.db.prepare('SELECT id,display_name FROM stump_people WHERE id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify([...new Set(rows.flatMap(row => [row.person_id, row.created_by]))])).all<{ id: string; display_name: string }>()).results.map(row => [row.id, row.display_name]))
  const products = new Map((await ctx.db.prepare('SELECT id,name,urls FROM stump_products WHERE id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify([...new Set(rows.map(row => row.product_id).filter(Boolean))])).all<{ id: string; name: string; urls: string }>()).results.map(row => [row.id, row]))
  const rules = await readRules(ctx.db)
  const items = new Map((await ctx.db.prepare('SELECT id,flags,ai FROM stump_items WHERE id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(rows.map(row => row.item_id).filter(Boolean))).all<{ id: string; flags: string; ai: string | null }>()).results
    .map(row => [row.id, { flags: JSON.parse(row.flags) as unknown[], ai: row.ai === null ? null : JSON.parse(row.ai) as { fields_sent?: string[] } }]))
  const out: HandoffRecord[] = []
  for (const row of rows) {
    const venue = venues.get(row.venue_id)!
    const draft = row.draft_text === null ? null : await tagOwnLinks(ctx.db, { text: row.draft_text, route: 'handoff', source: venue.platform ?? venue.name, campaign: row.campaign, content: shortContent(row.id) })
    const product = row.product_id ? products.get(row.product_id) : undefined
    const link = productLink(row, venue, product ? JSON.parse(product.urls) as string[] : [], rules)
    const item = row.item_id ? items.get(row.item_id) : undefined
    // Who wrote the draft: a draft generated with the person's voice guide is in their voice; any other is the preparer's words.
    const drafted = row.draft_text === null ? null : { ai: !!item?.ai, in_voice: !!item?.ai?.fields_sent?.includes('voice'), by: { person_id: row.created_by, name: people.get(row.created_by) ?? null } }
    out.push(handoffRecord(row, venue, { person_name: people.get(row.person_id) ?? null, product_name: product?.name ?? null, history: history.get(row.id)!, flags: item?.flags ?? [], draft_text: draft, drafted, link }))
  }
  return out
}

/**
 * The product's own page, tagged for this hand-off (utm_content its short id), for the person to
 * paste: the product's first link on a company domain, else the company's own site. None where
 * the venue does not allow links, or with no company domain to tag.
 */
function productLink(row: HandoffRow, venue: VenueRow, urls: string[], rules: StoredRules | null): string | null {
  if (String(rulesOf(venue).links?.value ?? '') === 'banned' || !rules?.own_domains.length) return null
  for (const url of [...urls, `https://${rules.own_domains[0]}/`]) {
    const tagged = tagLinks(url, rules, { source: venue.platform ?? venue.name, route: 'handoff', campaign: row.campaign ?? '', content: shortContent(row.id) }).links[0]
    if (tagged?.own) return tagged.tagged
  }
  return null
}

export const one = async (ctx: Pick<ActionContext, 'db'>, id: string) =>
  (await records(ctx, [(await ctx.db.prepare('SELECT * FROM stump_handoffs WHERE id=?').bind(id).first<HandoffRow>())!]))[0]!
