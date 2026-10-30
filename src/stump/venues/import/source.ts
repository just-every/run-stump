// The venue-list import's two sources, outreach-md and venues-csv
// (STUMP-VENUE-004): the file is read whole by lib/imports, products the list
// names are created once, venues arrive with their rules, limits and
// exclusions, and each entry becomes a draft for its product and venue.
// A place or product already in Stump is kept as it is; the list's entries
// attach to it.
import { canonicalJson, sha256 } from '../../../modules/import-kit/src/provenance/identity.ts'
import type { ImportDoorRawSource } from '../../../modules/import-kit/src/door/types.ts'
import type { Json, MappingResult, ParsedRecord, SourceRecord } from '../../../modules/import-kit/src/types.ts'
import { foldName, mapRecord, parseOutreachMarkdown, parseVenuesCsv, REJECTED_KIND, toRecords, type VenueListSummary } from '../../lib/imports/index.ts'
import { KIND_FIELDS, priorityRank, priorityWord, type VenueKind } from '../model.ts'
import { routesFor } from '../rules.ts'

export const VENUE_DESTINATION = 'stump-venues'
export const VENUE_SOURCES = ['outreach-md', 'venues-csv'] as const
export type VenueSource = typeof VENUE_SOURCES[number]
const MAPPING_VERSION = 'stump-venue-list-1'

/** A target's native id: stable for the same target, so a rerun and Undo find it. */
export const nativeId = (targetId: string) => `${targetId.split(':')[0]!.slice(0, 3)}_${sha256(targetId).slice(0, 24)}`
export const productTarget = (name: string) => `product:${foldName(name)}`

interface Known { id: string; namespace: string | null; name: string; rules?: string; status?: string; archived?: number }

/** What Stump holds now that the import could meet: products, places and imported entries, read once per request. */
async function known(db: D1Database) {
  const products = new Map<string, Known>(), venues = new Map<string, Known>(), items = new Map<string, Known>()
  const productRows = (await db.prepare('SELECT p.id,p.name,p.names,i.namespace FROM stump_products p LEFT JOIN stump_product_imports i ON i.product_id=p.id').all<{ id: string; name: string; names: string; namespace: string | null }>()).results
  for (const row of productRows) for (const name of [row.name, ...JSON.parse(row.names) as string[]]) if (!products.has(foldName(name))) products.set(foldName(name), { id: row.id, name: row.name, namespace: row.namespace })
  const venueRows = (await db.prepare('SELECT v.id,v.name,v.url_key,v.rules,v.status,v.archived,i.namespace FROM stump_venues v LEFT JOIN stump_venue_imports i ON i.venue_id=v.id WHERE v.url_key IS NOT NULL')
    .all<{ id: string; name: string; url_key: string; rules: string; status: string; archived: number; namespace: string | null }>()).results
  for (const row of venueRows) venues.set(row.url_key, { id: row.id, name: row.name, namespace: row.namespace, rules: row.rules, status: row.status, archived: row.archived })
  for (const row of (await db.prepare('SELECT item_id,target_id,namespace FROM stump_item_imports').all<{ item_id: string; target_id: string; namespace: string }>()).results) items.set(row.target_id, { id: row.item_id, namespace: row.namespace, name: row.target_id })
  return { products, venues, items }
}

/** The import's rules, as the register stores them: each {value, source_url, read_at, sourced}. */
function importedRules(rules: Record<string, Json>): Record<string, Json> {
  const out: Record<string, Json> = {}
  for (const [key, rule] of Object.entries(rules)) {
    const value = rule as Record<string, Json>
    out[key] = { value: value.value ?? null, source_url: value.source_url ?? null, read_at: value.read_at ?? null, sourced: value.sourced === true, origin: 'import' }
  }
  return out
}

function venueDetails(kind: VenueKind, url: string | null): Record<string, Json> {
  const details: Record<string, Json> = Object.fromEntries(Object.keys(KIND_FIELDS[kind].details).map(key => [key, null]))
  if (kind === 'subreddit' && url) { const name = /\/r\/([A-Za-z0-9_]+)/.exec(url)?.[1]; details.subreddit = name ? `r/${name}` : null }
  return details
}

/**
 * One request's source: its reader, its mapping (bound to what Stump holds now
 * and to the owner who imports), and the summary the reader counted.
 */
export async function venueListSource(db: D1Database, namespace: VenueSource, ownerId: string) {
  const state = await known(db)
  let summary: VenueListSummary | null = null, rejected: Array<{ kind: string; sourceId: string; reason: string }> | null = null
  // What each row maps to in this request, by "<kind>|<sourceId>": a plan names a changed row's fields from it.
  const mapped = new Map<string, Record<string, unknown>>()
  // The list's own venues, by target, as the reader read them: their rules decide their drafts' routes.
  const listedVenues = new Map<string, { status: string; rules: Record<string, Json> }>()
  const productRef = (name: string) => {
    const found = state.products.get(foldName(name))
    return found && found.namespace !== namespace ? { product_id: found.id, target: null } : { product_id: nativeId(productTarget(name)), target: productTarget(name) }
  }
  const venueRef = (target: string) => {
    const found = state.venues.get(target.slice('venue:'.length))
    return found && found.namespace !== namespace ? { venue_id: found.id, target: null, found } : { venue_id: nativeId(target), target, found: null }
  }

  function mapVenue(record: SourceRecord): MappingResult {
    const p = record.payload as Record<string, Json>, key = String(p.url_key)
    const found = state.venues.get(key)
    if (found && found.namespace !== namespace) return { effects: [], unmapped: [{ reason: `Already in the register as "${found.name}" (${found.id}); it is kept as it is and the list's entries attach to it.` }] }
    const kind = p.kind as VenueKind, products = (p.products as Array<{ name: string }>).map(item => ({ name: item.name, ...productRef(item.name) }))
    const limit = p.shared_limit as { text: string; posts: number | null; per: string | null } | null
    const value: Record<string, Json> = {
      namespace, created_by: ownerId, kind, name: p.name!, url: p.url ?? null, url_key: key, platform: p.platform ?? null, status: p.status!,
      priority: priorityWord(priorityRank(p.priority)), audience: p.audience ?? null, how_to_post: p.how_to_post ? { text: p.how_to_post } : {},
      reception: p.reception ?? null, notes: p.rules_text ? `Rules as the list states them: ${String(p.rules_text)}` : null, details: venueDetails(kind, (p.url as string | null) ?? null),
      rules: importedRules((p.rules ?? {}) as Record<string, Json>),
      shared_limit: limit && limit.posts && limit.per ? { posts: limit.posts, per: limit.per, text: limit.text } : null,
      limit_text: limit && !(limit.posts && limit.per) ? limit.text : null,
      excluded: p.excluded ?? null, products: products.map(item => ({ product_id: item.product_id, product_target: item.target })),
      external_id: p.external_id ?? null, listed_status: p.listed_status ?? null, rules_urls: p.rules_urls ?? [], sources: p.sources ?? [],
    }
    return { effects: [{ targetKind: 'venue', targetId: record.sourceId, value }] }
  }

  function mapProduct(record: SourceRecord): MappingResult {
    const name = String((record.payload as { name: string }).name), found = state.products.get(foldName(name))
    if (found && found.namespace !== namespace) return { effects: [], unmapped: [{ reason: `The product "${found.name}" is already in Stump (${found.id}).` }] }
    return { effects: [{ targetKind: 'product', targetId: record.sourceId, value: { namespace, created_by: ownerId, name } }] }
  }

  function mapDraft(record: SourceRecord): MappingResult {
    const p = record.payload as Record<string, Json>
    const existing = state.items.get(record.sourceId)
    if (existing && existing.namespace !== namespace) return { effects: [], unmapped: [{ reason: `This entry was already imported from ${existing.namespace}.` }] }
    const venue = venueRef(String(p.venue_key)), product = productRef(String(p.product_name))
    const options: Record<string, Json> = {}
    for (const key of ['title', 'alternates', 'extra_copy', 'own_words_required', 'post_type', 'listed_status', 'priority', 'post_url', 'community_url', 'rules_urls',
      'evidence_urls', 'link_check', 'audience', 'why', 'reader_value', 'how_to_post', 'requirements', 'notes', 'sources', 'entry_id'] as const) options[key] = p[key] ?? null
    // The draft's routes, from the rules of the venue it is aimed at: the one already in Stump, or the list's own.
    const listed = listedVenues.get(String(p.venue_key))
    const aimed = venue.found ?? { archived: 0, status: listed?.status ?? 'candidate', rules: canonicalJson(listed?.rules ?? {}) }
    const value: Record<string, Json> = {
      namespace, created_by: ownerId, person_id: ownerId, format: p.format!, text: p.text!, venue_id: venue.venue_id, venue_target: venue.target,
      product_id: product.product_id, product_target: product.target, options,
      routes: routesFor({ id: venue.venue_id, archived: aimed.archived ?? 0, status: aimed.status ?? 'candidate', rules: aimed.rules ?? '{}' } as never).routes,
    }
    return { effects: [{ targetKind: 'item', targetId: record.sourceId, value }] }
  }

  const source: ImportDoorRawSource = {
    format: 'raw',
    mapping: {
      version: MAPPING_VERSION,
      map(record) {
        if (record.kind === REJECTED_KIND) return mapRecord(record as never)
        const result = record.kind === 'product' ? mapProduct(record) : record.kind === 'venue' ? mapVenue(record) : record.kind === 'draft' ? mapDraft(record) : null
        if (!result) return { effects: [], rejection: `unknown record kind "${record.kind}"` }
        const value = result.effects[0]?.value
        if (value) mapped.set(`${record.kind}|${record.sourceId}`, value as Record<string, unknown>)
        return result
      },
    },
    readRaw(upload) {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(upload.bytes)
      const parsed = namespace === 'outreach-md' ? parseOutreachMarkdown(text) : parseVenuesCsv(text)
      summary = parsed.summary
      for (const row of parsed.rows) if (row.kind === 'venue') listedVenues.set(row.sourceId, { status: String(row.payload.status), rules: importedRules((row.payload.rules ?? {}) as Record<string, Json>) })
      const names = new Map<string, string>()
      for (const row of parsed.rows) {
        const listed = row.kind === 'venue' ? (row.payload.products as Array<{ name: string }>).map(item => item.name) : row.kind === 'draft' ? [String(row.payload.product_name)] : []
        for (const name of listed) if (!names.has(foldName(name))) names.set(foldName(name), name)
      }
      // Products first, then venues, then their entries, then each refused row with its reasons.
      const products: ParsedRecord[] = [...names.values()].map(name => ({ kind: 'product', sourceId: productTarget(name), payload: { name } }))
      const records = toRecords(parsed)
      rejected = records.filter(record => record.kind === REJECTED_KIND).map(record => ({ kind: record.kind, sourceId: record.sourceId, reason: mapRecord(record).rejection! }))
      return [...products, ...records as ParsedRecord[]]
    },
  }
  return { source, summary: () => summary, rejected: () => rejected, mapped }
}
