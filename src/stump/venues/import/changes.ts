// What a later file changes (STUMP-VENUE-004.4): each replaced or conflicting
// row of a plan, named, with every field it would change as Stump holds it now
// and as the file has it. Nothing here is stored; a plan computes it afresh.
import { classify, targetKey, type FieldChange, type JsonObject } from '../../lib/imports/index.ts'
import { priorityWord } from '../model.ts'
import { nativeId } from './source.ts'

type Kind = 'venue' | 'product' | 'draft'
type Value = Record<string, unknown>
export interface PlanRow { kind: string; sourceId: string; conflict: boolean; reason: string | null }
export interface RowChange {
  kind: 'venue' | 'product' | 'entry'; source_id: string; id: string; name: string | null
  /** A conflict was edited in Stump since the last import: applying keeps the edit. A replacement takes the file's values. */
  conflict: boolean; cause: string | null; reason: string | null
  fields: Array<{ field: string; before: unknown; after: unknown }>
}

const SIDE: Record<Kind, { side: string; key: string; table: string; marker: string; written: string }> = {
  venue: { side: 'stump_venue_imports', key: 'venue_id', table: 'stump_venues', marker: "n.revision||''", written: "i.native_revision||''" },
  product: { side: 'stump_product_imports', key: 'product_id', table: 'stump_products', marker: "n.revision||':'||n.updated_at", written: "i.native_revision||':'||i.native_updated_at" },
  draft: { side: 'stump_item_imports', key: 'item_id', table: 'stump_items', marker: "n.revision||':'||n.updated_at", written: "i.native_revision||':'||i.native_updated_at" },
}
/** Bookkeeping the import carries that is no field a person reads. */
const HIDDEN = new Set(['namespace', 'created_by', 'person_id', 'venue_target', 'product_target', 'routes', 'external_id'])
const parse = (text: unknown) => typeof text === 'string' ? JSON.parse(text) as unknown : text ?? null

/** One value in the shape people compare: an entry's options beside its own fields, a venue's products as their ids. */
function comparable(kind: Kind, value: Value): JsonObject {
  const out: Value = {}
  for (const [key, item] of Object.entries(value)) {
    if (HIDDEN.has(key)) continue
    if (kind === 'draft' && key === 'options' && item && typeof item === 'object') Object.assign(out, item)
    else if (kind === 'venue' && key === 'products') out.products = ((item as Array<{ product_id: string }> | null) ?? []).map(link => link.product_id).sort()
    else out[key] = item
  }
  return out as JsonObject
}

/** The record as Stump holds it now, in the import's own shape. */
async function nativeNow(db: D1Database, kind: Kind, id: string, imported: Value): Promise<Value> {
  if (kind === 'venue') {
    const row = await db.prepare('SELECT kind,name,url,platform,status,priority,audience,reception,rules,shared_limit,excluded,how_to_post,details,requirements,why,reader_value FROM stump_venues WHERE id=?').bind(id).first<Record<string, unknown>>()
    if (!row) return imported
    const products = (await db.prepare('SELECT product_id FROM stump_venue_products WHERE venue_id=?').bind(id).all<{ product_id: string }>()).results
    return {
      ...imported, kind: row.kind, name: row.name, url: row.url, platform: row.platform, status: row.status, priority: priorityWord(row.priority), audience: row.audience,
      reception: row.reception, rules: parse(row.rules), shared_limit: parse(row.shared_limit), excluded: parse(row.excluded), how_to_post: parse(row.how_to_post), details: parse(row.details), products,
      requirements: parse(row.requirements), why: row.why, reader_value: row.reader_value,
    }
  }
  if (kind === 'product') {
    const row = await db.prepare('SELECT name FROM stump_products WHERE id=?').bind(id).first<{ name: string }>()
    return row ? { ...imported, name: row.name } : imported
  }
  const row = await db.prepare('SELECT format,text,venue_id,product_id,options FROM stump_items WHERE id=?').bind(id).first<Record<string, unknown>>()
  return row ? { ...imported, format: row.format, text: row.text, venue_id: row.venue_id, product_id: row.product_id, options: parse(row.options) } : imported
}

const nameOf = (kind: Kind, value: Value): string | null => {
  if (kind !== 'draft') return typeof value.name === 'string' ? value.name : null
  const options = (value.options ?? {}) as Value
  return typeof options.title === 'string' && options.title ? options.title : typeof value.text === 'string' ? value.text.slice(0, 80) : null
}

/**
 * Each replaced or conflicting row with its fields before (as Stump holds it
 * now) and after (as the file has it). `mapped` holds what the file maps each
 * row to, read during this plan.
 */
export async function rowChanges(db: D1Database, rows: PlanRow[], mapped: Map<string, Value>): Promise<RowChange[]> {
  const out: RowChange[] = []
  for (const row of rows) {
    if (!Object.hasOwn(SIDE, row.kind)) continue
    const kind = row.kind as Kind, s = SIDE[kind], incoming = mapped.get(`${kind}|${row.sourceId}`), id = nativeId(row.sourceId)
    const side = await db.prepare(`SELECT i.value_json,(${s.marker})=(${s.written}) AS unchanged FROM ${s.side} i JOIN ${s.table} n ON n.id=i.${s.key} WHERE i.target_id=?`)
      .bind(row.sourceId).first<{ value_json: string; unchanged: number }>()
    const imported = side ? JSON.parse(side.value_json) as Value : null
    const current = imported ? side!.unchanged ? imported : await nativeNow(db, kind, id, imported) : null
    let fields: FieldChange[] = [], cause: string | null = null
    if (incoming && current) {
      const targetKind = kind === 'draft' ? 'item' : kind
      const difference = classify({ targetKind, targetId: row.sourceId, value: comparable(kind, incoming) },
        { [targetKey(targetKind, row.sourceId)]: { current: comparable(kind, current), imported: comparable(kind, imported!) } })
      fields = difference.fields; cause = difference.cause ?? null
    }
    out.push({
      kind: kind === 'draft' ? 'entry' : kind, source_id: row.sourceId, id, name: nameOf(kind, incoming ?? imported ?? {}), conflict: row.conflict, cause, reason: row.reason,
      fields: fields.map(field => ({ field: field.field, before: field.current, after: field.incoming })),
    })
  }
  return out
}
