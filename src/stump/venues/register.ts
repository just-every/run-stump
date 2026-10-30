// stump.venues.manage: the register of every place worth showing up
// (STUMP-VENUE-001). One venue per place, shared across products; an excluded
// venue keeps its reason and alternative, so it is not proposed again.
import { refuse } from '../actions/refusals.ts'
import type { ActionContext, Args, StumpAction } from '../actions/types.ts'
import { inferKind } from '../lib/imports/index.ts'
import { CONTRIBUTORS, EDITORS, READERS } from '../people/roles.ts'
import { usage } from './limits.ts'
import {
  KIND_FIELDS, KINDS, PRIORITIES, STATUSES, kindDetails, placeKey, priorityRank, productLinks, publicVenue, readVenue, venueHistory, venueOrRefuse,
  type PublicVenue, type VenueKind, type VenueRow,
} from './model.ts'
import { refreshItems, routesFor } from './rules.ts'

const text = (max: number) => ({ type: 'string', minLength: 1, maxLength: max })
const optionalText = (max: number) => ({ type: ['string', 'null'], maxLength: max })
export const venueId = { type: 'string', minLength: 1, maxLength: 80 }
// A product link reads product_id and fit; any other key a caller sends with it is ignored.
const product = { type: 'object', required: ['product_id'], properties: { product_id: text(80), fit: { type: ['integer', 'null'], minimum: 0, maximum: 100 } } }
const DETAIL_TYPES = { text: optionalText(300), url: optionalText(2048), list: { type: ['array', 'null'], maxItems: 20, items: text(80) }, integer: { type: ['integer', 'null'], minimum: 0 }, number: { type: ['number', 'null'], minimum: 0 }, date: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' } }
/** Every kind's own fields, also accepted at the top level of a create or update (a Slack venue's channel, a journalist's publication). */
const DETAIL_FIELDS: Record<string, unknown> = {}
for (const kind of Object.values(KIND_FIELDS)) for (const [key, type] of Object.entries(kind.details)) DETAIL_FIELDS[key] = DETAIL_TYPES[type]
// How to post and requirements are what people write: plain text is kept as {text}.
const writtenOr = (properties: Record<string, unknown>) => ({ type: ['object', 'string'], maxLength: 2000, additionalProperties: false, properties })
const FIELDS = {
  kind: { enum: [...KINDS] }, name: text(200), url: optionalText(2048), platform: optionalText(80),
  status: { enum: [...STATUSES] }, priority: { enum: [...PRIORITIES, null] },
  products: { type: 'array', maxItems: 50, items: product },
  details: { type: 'object', maxProperties: 12 },
  audience: optionalText(2000), why: optionalText(2000), reader_value: optionalText(2000), reception: optionalText(2000), notes: optionalText(4000),
  how_to_post: writtenOr({ text: optionalText(2000), thread: optionalText(300), channel: optionalText(120), flair: optionalText(120), day: optionalText(40), template: optionalText(4000) }),
  requirements: writtenOr({ text: optionalText(2000), karma: { type: ['integer', 'null'], minimum: 0 }, account_age_days: { type: ['integer', 'null'], minimum: 0 }, membership: { type: ['boolean', 'null'] }, price_usd: { type: ['number', 'null'], minimum: 0 } }),
  ...DETAIL_FIELDS,
}
const written = (value: unknown) => JSON.stringify(typeof value === 'string' ? (value.trim() ? { text: value.trim() } : {}) : value ?? {})
const standard = (measure = 1) => [{ class: 'standard' as const, facts: { measure } }]
const clean = (value: unknown) => typeof value === 'string' ? value.trim() || null : null
const mover = (ctx: ActionContext) => ({ db: ctx.db, person: ctx.person, agent: ctx.agent, now: ctx.now })

/** The venue as both doors answer it, with its routes, products and next open date now. */
export async function answer(ctx: Pick<ActionContext, 'db' | 'now'>, rows: VenueRow[]): Promise<PublicVenue[]> {
  const links = await productLinks(ctx.db, rows.map(row => row.id))
  const imported = new Set((await ctx.db.prepare('SELECT venue_id FROM stump_venue_imports WHERE venue_id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(rows.map(row => row.id))).all<{ venue_id: string }>()).results.map(row => row.venue_id))
  return Promise.all(rows.map(async row => publicVenue(row, links.get(row.id) ?? [], {
    routes: routesFor(row).routes, next_open_at: row.shared_limit ? (await usage(ctx.db, row, ctx.now())).next_open_at : null, imported: imported.has(row.id),
  })))
}
export const one = async (ctx: ActionContext, id: string) => (await answer(ctx, [(await readVenue(ctx.db, id))!]))[0]!

/** Exclusion carries a reason and an alternative, so it has its own action. */
const notExcluded = (status: unknown) => { if (status === 'excluded') refuse('invalid_arguments', { field: 'status', reason: 'Exclude a venue with its reason and alternative (action exclude).' }) }

/**
 * The items aimed at a venue, by product, with their routes, hold and latest history (STUMP-VENUE-001.6, -002.4). Each carries its
 * product's name and, when a hand-off carries it, that hand-off and its state, so every screen names and states it alike.
 */
async function itemsAt(ctx: ActionContext, id: string) {
  const items = (await ctx.db.prepare(`SELECT i.id,i.product_id,p.name AS product_name,i.format,i.state,i.routes,i.hold,i.flags,i.scheduled_at,i.text,i.parts,
      (SELECT h.id FROM stump_handoffs h WHERE h.item_id=i.id ORDER BY h.created_at DESC,h.id DESC LIMIT 1) AS handoff_id,
      (SELECT h.state FROM stump_handoffs h WHERE h.item_id=i.id ORDER BY h.created_at DESC,h.id DESC LIMIT 1) AS handoff_state
    FROM stump_items i LEFT JOIN stump_products p ON p.id=i.product_id WHERE i.venue_id=? ORDER BY i.updated_at DESC,i.id LIMIT 200`).bind(id)
    .all<{ id: string; product_id: string | null; product_name: string | null; format: string; state: string; routes: string; hold: string | null; flags: string; scheduled_at: number | null; text: string | null; parts: string | null; handoff_id: string | null; handoff_state: string | null }>()).results
  const history = (await ctx.db.prepare(`SELECT item_id,from_state,to_state,reason,at FROM stump_item_history WHERE item_id IN (SELECT value FROM json_each(?)) ORDER BY at DESC,id`)
    .bind(JSON.stringify(items.map(item => item.id))).all<{ item_id: string; from_state: string | null; to_state: string; reason: string | null; at: number }>()).results
  return items.map(item => ({
    id: item.id, product_id: item.product_id, product_name: item.product_name, format: item.format, state: item.state, routes: JSON.parse(item.routes) as string[], hold: item.hold ? JSON.parse(item.hold) : null,
    handoff: item.handoff_id ? { id: item.handoff_id, state: item.handoff_state! } : null,
    // Its words, so a screen can name an item with no product by its opening words, as Today does.
    text: item.text ?? (item.parts ? (JSON.parse(item.parts) as string[])[0] ?? null : null),
    flags: (JSON.parse(item.flags) as Array<{ code: string }>).map(flag => flag.code), scheduled_at: item.scheduled_at === null ? null : new Date(item.scheduled_at).toISOString(),
    history: history.filter(row => row.item_id === item.id).slice(0, 5).map(row => ({ from_state: row.from_state, to_state: row.to_state, reason: row.reason, at: new Date(row.at).toISOString() })),
  }))
}

/** A second venue for the same place is refused, naming the first (STUMP-VENUE-001.3, .4). */
async function samePlace(ctx: ActionContext, key: string, except: string | null = null) {
  const first = await ctx.db.prepare('SELECT id,name,status,excluded FROM stump_venues WHERE url_key=? AND id IS NOT ?').bind(key, except).first<{ id: string; name: string; status: string; excluded: string | null }>()
  if (!first) return
  if (first.status === 'excluded') refuse('venue_excluded', { venue_id: first.id, name: first.name, ...JSON.parse(first.excluded ?? '{}') })
  refuse('duplicate_venue', { venue_id: first.id, name: first.name })
}

async function checkProducts(ctx: ActionContext, products: Array<{ product_id: string }>) {
  const ids = [...new Set(products.map(item => item.product_id))]
  if (ids.length !== products.length) refuse('invalid_arguments', { field: 'products', reason: 'Each product once.' })
  const found = (await ctx.db.prepare('SELECT id FROM stump_products WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).all<{ id: string }>()).results.map(row => row.id)
  const missing = ids.find(id => !found.includes(id))
  if (missing) refuse('not_found', { product_id: missing })
}
const productStatements = (ctx: ActionContext, venueId: string, products: Array<{ product_id: string; fit?: number | null }>) => [
  ctx.db.prepare('DELETE FROM stump_venue_products WHERE venue_id=?').bind(venueId),
  ...products.map(item => ctx.db.prepare('INSERT INTO stump_venue_products(venue_id,product_id,fit) VALUES(?,?,?)').bind(venueId, item.product_id, item.fit ?? null)),
]

interface Fields { kind: VenueKind; name: string; url: string | null; url_key: string; details: Record<string, unknown> }
function fieldsOf(args: Args, current?: VenueRow): Fields {
  const kind = (args.kind ?? current?.kind) as VenueKind, name = clean(args.name) ?? current?.name ?? null
  const url = args.url !== undefined ? clean(args.url) : current?.url ?? null
  if (!name) refuse('invalid_arguments', { field: 'name' })
  // A kind's fields may come under details or at the top level; a field of another kind is refused by name, never dropped.
  const given = (args.details ?? (current && kind === current.kind ? JSON.parse(current.details) : {})) as Record<string, unknown>
  const top = Object.fromEntries(Object.keys(DETAIL_FIELDS).filter(key => args[key] !== undefined).map(key => [key, args[key]]))
  const details = kindDetails(kind, url, { ...given, ...top }, new Set(Object.keys(top)))
  return { kind, name, url, url_key: placeKey(url, name), details }
}

async function insertVenue(ctx: ActionContext, args: Args, status: string) {
  notExcluded(status)
  const fields = fieldsOf(args), products = (args.products ?? []) as Array<{ product_id: string; fit?: number | null }>
  await samePlace(ctx, fields.url_key)
  await checkProducts(ctx, products)
  const id = crypto.randomUUID(), now = ctx.now()
  await ctx.db.batch([
    ctx.db.prepare(`INSERT INTO stump_venues(id,kind,name,url,url_key,platform,status,priority,notes,created_by,created_at,updated_at,details,audience,why,reader_value,how_to_post,requirements,reception)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, fields.kind, fields.name, fields.url, fields.url_key, clean(args.platform), status, priorityRank(args.priority),
      clean(args.notes), ctx.person.id, now, now, JSON.stringify(fields.details), clean(args.audience), clean(args.why), clean(args.reader_value),
      written(args.how_to_post), written(args.requirements), clean(args.reception)),
    ...productStatements(ctx, id, products),
    venueHistory(ctx.db, id, 'create', mover(ctx), { status, kind: fields.kind }),
  ]).catch(error => {
    // Two writers racing for one place: the index keeps one, and the other is told which.
    if (/UNIQUE/.test(String(error))) return samePlace(ctx, fields.url_key).then(() => { throw error })
    throw error
  })
  ctx.emit('venue.created', `stump://venues/${id}`, { kind: fields.kind })
  return one(ctx, id)
}

const LIST_FILTERS = { kind: FIELDS.kind, status: FIELDS.status, product_id: text(80), priority: FIELDS.priority, include_excluded: { type: 'boolean' }, include_archived: { type: 'boolean' }, q: text(200) }

export async function listVenues(ctx: ActionContext, args: Args) {
  const where: string[] = [], values: unknown[] = []
  if (args.kind) { where.push('v.kind=?'); values.push(args.kind) }
  if (args.status) { where.push('v.status=?'); values.push(args.status) }
  if (args.priority !== undefined) { where.push(args.priority === null ? 'v.priority IS NULL' : 'v.priority=?'); if (args.priority !== null) values.push(priorityRank(args.priority)) }
  if (args.product_id) { where.push('EXISTS(SELECT 1 FROM stump_venue_products vp WHERE vp.venue_id=v.id AND vp.product_id=?)'); values.push(args.product_id) }
  // Excluded venues are hidden unless asked for, or unless the filter names the status itself.
  if (args.include_excluded !== true && args.status !== 'excluded') where.push("v.status<>'excluded'")
  if (args.include_archived !== true) where.push('v.archived=0')
  // instr, not LIKE: D1 refuses a LIKE pattern over 50 bytes, and a search may be any length.
  if (typeof args.q === 'string') { where.push('(instr(lower(v.name),lower(?))>0 OR instr(lower(COALESCE(v.url,\'\')),lower(?))>0)'); values.push(args.q, args.q) }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const rows = (await ctx.db.prepare(`SELECT v.* FROM stump_venues v ${clause} ORDER BY COALESCE(v.priority,0) DESC,v.name COLLATE NOCASE,v.id LIMIT 1000`).bind(...values).all<VenueRow>()).results
  const total = await ctx.db.prepare(`SELECT COUNT(*) AS n FROM stump_venues v ${clause}`).bind(...values).first<{ n: number }>()
  return { items: await answer(ctx, rows), total: total?.n ?? 0 }
}

const target = (args: Args) => ({ kind: 'venue', id: String(args.venue_id) })
const summary = async (args: Args, ctx: ActionContext) => { const venue = await readVenue(ctx.db, args.venue_id); return { target: { id: String(args.venue_id), name: venue?.name ?? undefined } } }
const revision = async (args: Args, ctx: ActionContext) => (await readVenue(ctx.db, args.venue_id))?.revision ?? null

/** Writes one change to a venue under its revision, with its history, and answers the venue record. */
async function change(ctx: ActionContext, venue: VenueRow, action: string, set: Record<string, unknown>, detail: Record<string, unknown>, extra: D1PreparedStatement[] = []) {
  const columns = Object.keys(set)
  const changed = await ctx.db.batch([
    ctx.db.prepare(`UPDATE stump_venues SET ${columns.map(column => `${column}=?`).join(',')},revision=revision+1,updated_at=? WHERE id=? AND revision=?`)
      .bind(...columns.map(column => set[column]), ctx.now(), venue.id, venue.revision),
    ...extra,
    venueHistory(ctx.db, venue.id, action, mover(ctx), detail),
  ])
  if (!changed[0]!.meta.changes) refuse('revision_conflict', { current_revision: (await readVenue(ctx.db, venue.id))?.revision ?? null })
  const next = (await readVenue(ctx.db, venue.id))!
  const refreshed = await refreshItems(ctx.db, next, mover(ctx))
  if (refreshed.length) await ctx.db.batch(refreshed)
  ctx.emit(`venue.${action}`, `stump://venues/${venue.id}`)
  return (await answer(ctx, [next]))[0]!
}

export const manageActions: Record<string, StumpAction> = {
  create: {
    roles: EDITORS, properties: FIELDS, required: ['kind', 'name'],
    classify: () => standard(),
    summary: args => ({ target: { name: String(args.name) } }),
    run: (args, ctx) => insertVenue(ctx, args, (args.status as string | undefined) ?? 'candidate'),
  },
  propose: {
    // Anyone who drafts may propose a candidate; an excluded or known place is named instead of proposed again.
    roles: CONTRIBUTORS, properties: { url: FIELDS.url, name: FIELDS.name, kind: FIELDS.kind, why: FIELDS.why, products: FIELDS.products },
    required: ['url'],
    classify: () => standard(),
    summary: args => ({ target: { name: String(args.name ?? args.url) } }),
    async run(args, ctx) {
      const url = clean(args.url)
      if (!url) refuse('invalid_arguments', { field: 'url' })
      let name = clean(args.name)
      if (!name) { try { const parsed = new URL(url); name = `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname.replace(/\/+$/, '')}` } catch { refuse('invalid_arguments', { field: 'url' }) } }
      const kind = (args.kind as VenueKind | undefined) ?? inferKind({ name: name ?? '', url }).kind
      return insertVenue(ctx, { ...args, url, name, kind, details: {} }, 'candidate')
    },
  },
  get: {
    roles: READERS, read: true, properties: { venue_id: venueId }, required: ['venue_id'],
    classify: () => standard(0), target,
    // The Venue record itself, with the items aimed at it beside its fields.
    async run(args, ctx) { const venue = await venueOrRefuse(ctx.db, args.venue_id); return { ...(await answer(ctx, [venue]))[0]!, items: await itemsAt(ctx, venue.id) } },
  },
  list: {
    roles: READERS, read: true, properties: LIST_FILTERS,
    classify: () => standard(0),
    run: (args, ctx) => listVenues(ctx, args),
  },
  update: {
    roles: EDITORS, properties: { venue_id: venueId, ...FIELDS }, required: ['venue_id'],
    classify: () => standard(), summary, target, revision,
    async run(args, ctx) {
      const venue = await venueOrRefuse(ctx.db, args.venue_id)
      const fields = fieldsOf(args, venue)
      if (fields.url_key !== venue.url_key) await samePlace(ctx, fields.url_key, venue.id)
      const set: Record<string, unknown> = { kind: fields.kind, name: fields.name, url: fields.url, url_key: fields.url_key, details: JSON.stringify(fields.details) }
      for (const key of ['platform', 'audience', 'why', 'reader_value', 'reception', 'notes'] as const) if (args[key] !== undefined) set[key] = clean(args[key])
      for (const key of ['how_to_post', 'requirements'] as const) if (args[key] !== undefined) set[key] = written(args[key])
      if (args.priority !== undefined) set.priority = priorityRank(args.priority)
      // A new status other than excluded brings an excluded venue back, without its exclusion.
      if (args.status !== undefined) { notExcluded(args.status); set.status = args.status; set.excluded = null }
      let extra: D1PreparedStatement[] = []
      if (args.products !== undefined) {
        const products = args.products as Array<{ product_id: string; fit?: number | null }>
        await checkProducts(ctx, products)
        extra = productStatements(ctx, venue.id, products)
      }
      return change(ctx, venue, 'update', set, { fields: Object.keys(args).filter(key => !['action', 'venue_id', 'idempotency_key'].includes(key)) }, extra)
    },
  },
  exclude: {
    roles: EDITORS, properties: { venue_id: venueId, reason: text(1000), alternative: text(1000) }, required: ['venue_id', 'reason', 'alternative'],
    classify: () => standard(), summary, target, revision,
    async run(args, ctx) {
      const venue = await venueOrRefuse(ctx.db, args.venue_id)
      const excluded = { reason: String(args.reason).trim(), alternative: String(args.alternative).trim() }
      return change(ctx, venue, 'exclude', { status: 'excluded', excluded: JSON.stringify(excluded) }, excluded)
    },
  },
  archive: {
    roles: EDITORS, properties: { venue_id: venueId }, required: ['venue_id'],
    classify: () => standard(), summary, target, revision,
    async run(args, ctx) {
      const venue = await venueOrRefuse(ctx.db, args.venue_id)
      if (venue.archived) return (await answer(ctx, [venue]))[0]!
      // Items, hand-offs and ledger entries keep their venue throughout (STUMP-VENUE-001.5).
      return change(ctx, venue, 'archive', { archived: 1, archived_at: ctx.now(), archived_by: ctx.person.id }, {})
    },
  },
  restore: {
    roles: EDITORS, properties: { venue_id: venueId }, required: ['venue_id'],
    classify: () => standard(), summary, target, revision,
    async run(args, ctx) {
      const venue = await venueOrRefuse(ctx.db, args.venue_id)
      if (!venue.archived) return (await answer(ctx, [venue]))[0]!
      return change(ctx, venue, 'restore', { archived: 0, archived_at: null, archived_by: null }, {})
    },
  },
}
