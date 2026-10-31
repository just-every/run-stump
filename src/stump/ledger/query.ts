import { refuse } from '../actions/refusals.ts'
import type { ActionContext, Args } from '../actions/types.ts'
import { toEntry, toVersion, withCurrent, type LedgerRow, type LedgerVersion } from './entry.ts'

export const FILTERS = ['venue_id', 'network', 'person_id', 'product_id', 'campaign', 'route', 'state'] as const
export const WHEN = 'COALESCE(posted_at,created_at)'
export const MAX_PAGE = 200
export const MAX_EXPORT = 20000

/** A date filter is a day (UTC) or a moment; `to` as a day includes that whole day. */
function moment(value: unknown, field: string, end: boolean): number | null {
  if (value === undefined) return null
  const text = String(value), day = /^\d{4}-\d{2}-\d{2}$/.test(text)
  const at = Date.parse(day ? `${text}T00:00:00Z` : text)
  if (!Number.isFinite(at)) refuse('invalid_arguments', { field, reason: 'Use a date like 2026-10-27 or a time like 2026-10-27T09:00:00Z.' })
  return day && end ? at + 86_400_000 : at
}

export interface Selection { where: string; args: unknown[] }

/**
 * The WHERE clause for a ledger view: every filter given, combined, plus the
 * poster's own-entries scope (STUMP-TEAM-001.2). Searching text matches the post,
 * its link, its campaign, who it reads as posted by, its venue's name and the
 * utm_content its links carry (the item's id, or the hand-off's short id).
 */
export function select(args: Args, ctx: ActionContext, extra: Partial<Record<typeof FILTERS[number], string>> = {}): Selection {
  const filters: string[] = [], values: unknown[] = []
  for (const field of FILTERS) {
    const value = extra[field] ?? args[field]
    if (typeof value === 'string') { filters.push(`${field}=?`); values.push(value) }
  }
  if (typeof args.q === 'string' && args.q.trim()) {
    // instr, not LIKE: D1 refuses a LIKE pattern over 50 bytes, and a search may be any length.
    const q = args.q.trim(), has = (column: string) => `instr(lower(COALESCE(${column},'')),lower(?))>0`
    filters.push(`(${has('text')} OR ${has('url')} OR ${has('campaign')} OR ${has('by_label')} OR venue_id IN (SELECT id FROM stump_venues WHERE ${has('name')})
      OR lower(COALESCE(item_id,''))=lower(?) OR (handoff_id IS NOT NULL AND lower(?)=substr(replace(lower(handoff_id),'-',''),1,8)))`)
    values.push(q, q, q, q, q, q, q)
  }
  const from = moment(args.from, 'from', false), to = moment(args.to, 'to', true)
  if (from !== null) { filters.push(`${WHEN}>=?`); values.push(from) }
  if (to !== null) { filters.push(`${WHEN}<?`); values.push(to) }
  if (ctx.person.role === 'poster') { filters.push('person_id=?'); values.push(ctx.person.id) }
  return { where: filters.length ? `WHERE ${filters.join(' AND ')}` : '', args: values }
}

const COLUMNS = '*,(SELECT name FROM stump_venues WHERE id=stump_ledger.venue_id) AS venue_name'
/** The export also names the account and product each row's ids point at, so a spreadsheet reads without a lookup. */
const EXPORT_COLUMNS = `${COLUMNS},(SELECT handle FROM stump_accounts WHERE id=stump_ledger.account_id) AS account_handle,
  (SELECT name FROM stump_products WHERE id=stump_ledger.product_id) AS product_name`
const ORDER = `ORDER BY ${WHEN} DESC,id`

export async function versionsFor(ctx: ActionContext, selection: Selection, limit: number, offset: number): Promise<Map<string, LedgerVersion[]>> {
  const rows = (await ctx.db.prepare(`SELECT v.* FROM stump_ledger_versions v WHERE v.entry_id IN
    (SELECT id FROM stump_ledger ${selection.where} ${ORDER} LIMIT ? OFFSET ?) ORDER BY v.at,v.rowid`).bind(...selection.args, limit, offset).all<LedgerRow>()).results
  const byEntry = new Map<string, LedgerRow[]>()
  for (const row of rows) byEntry.set(String(row.entry_id), [...byEntry.get(String(row.entry_id)) ?? [], row])
  return new Map([...byEntry].map(([id, list]) => [id, list.map((row, index) => toVersion(row, index + 1))]))
}

/** One page of matching entries, newest first, with the count of everything that matches. */
export async function page(args: Args, ctx: ActionContext, extra: Partial<Record<typeof FILTERS[number], string>> = {}) {
  const selection = select(args, ctx, extra)
  const limit = Math.min(typeof args.limit === 'number' ? args.limit : MAX_PAGE, MAX_PAGE), offset = typeof args.offset === 'number' ? args.offset : 0
  const [rows, total, versions] = await Promise.all([
    ctx.db.prepare(`SELECT ${COLUMNS} FROM stump_ledger ${selection.where} ${ORDER} LIMIT ? OFFSET ?`).bind(...selection.args, limit, offset).all<LedgerRow>(),
    ctx.db.prepare(`SELECT COUNT(*) AS n FROM stump_ledger ${selection.where}`).bind(...selection.args).first<{ n: number }>(),
    versionsFor(ctx, selection, limit, offset),
  ])
  return { items: rows.results.map(row => toEntry(row, versions.get(String(row.id)) ?? [])), total: total?.n ?? 0 }
}

/** How many entries match; this is what a read measures. */
export async function count(args: Args, ctx: ActionContext, extra: Partial<Record<typeof FILTERS[number], string>> = {}) {
  const selection = select(args, ctx, extra)
  return (await ctx.db.prepare(`SELECT COUNT(*) AS n FROM stump_ledger ${selection.where}`).bind(...selection.args).first<{ n: number }>())?.n ?? 0
}

/** Every matching row up to the export cap, for the CSV. */
export async function everything(args: Args, ctx: ActionContext) {
  const selection = select(args, ctx)
  const [rows, total, lasts] = await Promise.all([
    ctx.db.prepare(`SELECT ${EXPORT_COLUMNS} FROM stump_ledger ${selection.where} ${ORDER} LIMIT ?`).bind(...selection.args, MAX_EXPORT).all<LedgerRow>(),
    ctx.db.prepare(`SELECT COUNT(*) AS n FROM stump_ledger ${selection.where}`).bind(...selection.args).first<{ n: number }>(),
    // Per entry, the stored version count and the last stored version, to count the current state when no row holds it.
    ctx.db.prepare(`SELECT * FROM (SELECT v.*, COUNT(*) OVER (PARTITION BY v.entry_id) AS stored,
      ROW_NUMBER() OVER (PARTITION BY v.entry_id ORDER BY v.at DESC, v.rowid DESC) AS newest FROM stump_ledger_versions v
      WHERE v.entry_id IN (SELECT id FROM stump_ledger ${selection.where} ${ORDER} LIMIT ?)) WHERE newest=1`)
      .bind(...selection.args, MAX_EXPORT).all<LedgerRow>(),
  ])
  const lastStored = new Map(lasts.results.map(row => [String(row.entry_id), { stored: Number(row.stored), last: toVersion(row, Number(row.stored)) }]))
  const versions = (row: LedgerRow) => {
    const known = lastStored.get(String(row.id))
    return known ? withCurrent(row, [known.last]).length - 1 + known.stored : 1
  }
  return { rows: rows.results, total: total?.n ?? 0, versions }
}

export async function one(ctx: ActionContext, id: string) {
  const scope = ctx.person.role === 'poster' ? ' AND person_id=?' : ''
  const row = await ctx.db.prepare(`SELECT ${COLUMNS} FROM stump_ledger WHERE id=?${scope}`).bind(id, ...(scope ? [ctx.person.id] : [])).first<LedgerRow>()
  if (!row) refuse('not_found', { entry_id: id })
  const versions = (await ctx.db.prepare('SELECT * FROM stump_ledger_versions WHERE entry_id=? ORDER BY at,rowid').bind(id).all<LedgerRow>()).results
  return { row, versions: versions.map((version, index) => toVersion(version, index + 1)), entry: toEntry(row, versions.map((version, index) => toVersion(version, index + 1))) }
}
