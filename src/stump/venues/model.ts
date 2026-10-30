// The venue register's record (V1 "Records": Venue), read from D1 and shaped
// the same for the person door, MCP and the screens (STUMP-VENUE-001).
import { foldName, normalizeVenueUrl, VENUE_KINDS, VENUE_STATUSES } from '../lib/imports/index.ts'
import { refuse } from '../actions/refusals.ts'
import { KIND_FIELDS } from './kinds.ts'

export const KINDS = VENUE_KINDS
export type VenueKind = typeof KINDS[number]
export const STATUSES = VENUE_STATUSES
export type VenueStatus = typeof STATUSES[number]

/** Priority words, strongest first. The column holds the rank; the import's "strong" and "fallback" read as high and low. */
export const PRIORITIES = ['top', 'high', 'medium', 'low'] as const
export type Priority = typeof PRIORITIES[number]
const RANK: Record<string, number> = { top: 4, high: 3, strong: 3, medium: 2, low: 1, fallback: 1 }
export const priorityRank = (word: unknown): number | null => typeof word === 'string' && Object.hasOwn(RANK, word) ? RANK[word]! : null
export const priorityWord = (rank: unknown): Priority | null => typeof rank === 'number' ? PRIORITIES[4 - rank] ?? null : null

export const RULE_KEYS = ['posting', 'ai_text', 'self_promotion', 'links', 'disclosure_line', 'gates'] as const
export type RuleKey = typeof RULE_KEYS[number]
export interface Rule { value: unknown; source_url: string | null; read_at: string | null; sourced: boolean; detail?: string | null; origin?: string }
export type Rules = Record<RuleKey, Rule | null>

export const PERIODS = ['day', 'week', 'month', 'quarter', 'year'] as const
export type Period = typeof PERIODS[number]
export interface SharedLimit { posts: number; per: Period; text?: string | null }

export { KIND_FIELDS }

/** The register's one key for a place: the canonical URL, or the folded name when it has none. */
export function placeKey(url: string | null, name: string): string {
  if (url) {
    const key = normalizeVenueUrl(url)
    if (!key) refuse('invalid_arguments', { field: 'url', reason: 'Give an http(s) address.' })
    return key
  }
  return `name:${foldName(name)}`
}

/** A kind's details, each key present (null when unset), checked against its type. */
export function kindDetails(kind: VenueKind, url: string | null, input: Record<string, unknown>): Record<string, unknown> {
  const fields: { url: boolean; details: Record<string, string>; required: readonly string[] } = KIND_FIELDS[kind], out: Record<string, unknown> = {}
  for (const key of Object.keys(input)) if (!Object.hasOwn(fields.details, key)) refuse('invalid_arguments', { field: `details.${key}`, reason: `A ${kind} has no ${key}.` })
  for (const [key, type] of Object.entries(fields.details)) {
    const value = input[key] ?? null
    const valid = value === null || (type === 'text' ? typeof value === 'string' && value.length <= 300
      : type === 'integer' ? Number.isSafeInteger(value) && (value as number) >= 0
        : type === 'number' ? typeof value === 'number' && Number.isFinite(value) && value >= 0
          : typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))
    if (!valid) refuse('invalid_arguments', { field: `details.${key}` })
    out[key] = typeof value === 'string' ? value.trim() || null : value
  }
  // A subreddit's name comes from its address when not given: reddit.com/r/<name>.
  if (kind === 'subreddit' && !out.subreddit && url) {
    const name = /\/r\/([A-Za-z0-9_]+)/.exec(new URL(url).pathname)?.[1]
    out.subreddit = name ? `r/${name}` : null
  }
  if (fields.url && !url) refuse('invalid_arguments', { field: 'url', reason: `A ${kind} needs its address.` })
  for (const key of fields.required) if (!out[key]) refuse('invalid_arguments', { field: `details.${key}`, reason: `A ${kind} needs its ${key}.` })
  return out
}

export interface VenueRow {
  id: string; kind: VenueKind; name: string; url: string | null; url_key: string | null; platform: string | null; status: VenueStatus
  priority: number | null; rules: string; shared_limit: string | null; archived: number; excluded: string | null; notes: string | null
  revision: number; created_by: string; created_at: number; updated_at: number; details: string; audience: string | null; why: string | null
  reader_value: string | null; how_to_post: string; requirements: string; reception: string | null; archived_at: number | null; archived_by: string | null
}

const json = <T,>(value: string | null, fallback: T): T => value === null ? fallback : JSON.parse(value) as T
const iso = (ms: number | null) => ms === null ? null : new Date(ms).toISOString()

/** Every rule key, with a missing rule as an unsourced empty rule. */
export function rulesOf(row: Pick<VenueRow, 'rules'>): Rules {
  const stored = json<Partial<Record<RuleKey, Rule>>>(row.rules, {})
  return Object.fromEntries(RULE_KEYS.map(key => [key, stored[key] ?? null])) as Rules
}
export const limitOf = (row: Pick<VenueRow, 'shared_limit'>): SharedLimit | null => {
  const limit = json<{ posts?: unknown; per?: unknown; text?: string } | null>(row.shared_limit, null)
  return limit && Number.isSafeInteger(limit.posts) && PERIODS.includes(limit.per as Period) ? { posts: limit.posts as number, per: limit.per as Period, text: limit.text ?? null } : null
}

export async function readVenue(db: D1Database, id: unknown): Promise<VenueRow | null> {
  return typeof id === 'string' ? db.prepare('SELECT * FROM stump_venues WHERE id=?').bind(id).first<VenueRow>() : null
}
export async function venueOrRefuse(db: D1Database, id: unknown): Promise<VenueRow> {
  const venue = await readVenue(db, id)
  if (!venue) refuse('not_found', { venue_id: String(id) })
  return venue
}

export interface ProductLink { product_id: string; name: string | null; fit: number | null; items: number }

/** Each venue's products with their fit and the items aimed at the venue for that product, in three reads for any number of venues. */
export async function productLinks(db: D1Database, ids: string[]): Promise<Map<string, ProductLink[]>> {
  const links = new Map<string, ProductLink[]>(ids.map(id => [id, []]))
  if (!ids.length) return links
  const list = JSON.stringify(ids)
  const rows = (await db.prepare(`SELECT vp.venue_id,vp.product_id,vp.fit,p.name FROM stump_venue_products vp LEFT JOIN stump_products p ON p.id=vp.product_id
    WHERE vp.venue_id IN (SELECT value FROM json_each(?)) ORDER BY p.name,vp.product_id`).bind(list).all<{ venue_id: string; product_id: string; fit: number | null; name: string | null }>()).results
  const counts = (await db.prepare(`SELECT venue_id,product_id,COUNT(*) AS n FROM stump_items WHERE venue_id IN (SELECT value FROM json_each(?)) GROUP BY venue_id,product_id`)
    .bind(list).all<{ venue_id: string; product_id: string | null; n: number }>()).results
  const items = new Map(counts.map(row => [`${row.venue_id}|${row.product_id}`, row.n]))
  for (const row of rows) links.get(row.venue_id)!.push({ product_id: row.product_id, name: row.name, fit: row.fit, items: items.get(`${row.venue_id}|${row.product_id}`) ?? 0 })
  return links
}

/** The venue as both doors answer it. Routes and the next open date are computed by the caller. */
export function publicVenue(row: VenueRow, products: ProductLink[], computed: { routes: string[]; next_open_at: string | null; imported: boolean }) {
  return {
    id: row.id, kind: row.kind, name: row.name, url: row.url, platform: row.platform, status: row.status, priority: priorityWord(row.priority),
    products, rules: rulesOf(row), routes: computed.routes, shared_limit: limitOf(row), next_open_at: computed.next_open_at,
    archived: row.archived === 1, excluded: json<{ reason: string; alternative: string | null } | null>(row.excluded, null),
    details: json<Record<string, unknown>>(row.details, {}), audience: row.audience, why: row.why, reader_value: row.reader_value,
    how_to_post: json<Record<string, unknown>>(row.how_to_post, {}), requirements: json<Record<string, unknown>>(row.requirements, {}),
    reception: row.reception, notes: row.notes, imported: computed.imported, revision: row.revision,
    created_at: iso(row.created_at), updated_at: iso(row.updated_at), archived_at: iso(row.archived_at),
  }
}
export type PublicVenue = ReturnType<typeof publicVenue>

/** One history row for a venue change, with who made it. */
export function venueHistory(db: D1Database, venueId: string, action: string, actor: { person: { id: string } | null; agent: { id: string } | null; now(): number }, detail: Record<string, unknown> = {}) {
  return db.prepare('INSERT INTO stump_venue_history(id,venue_id,action,person_id,agent_id,detail,at) VALUES(?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), venueId, action, actor.person?.id ?? null, actor.agent?.id ?? null, JSON.stringify(detail), actor.now())
}
