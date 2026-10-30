// The import kit's native target for the venue list: venues (with their
// product links), the products the list names, and each entry's draft item.
// A side row per target keeps the exact value the import wrote and the native
// revision right after, so any later edit in Stump reads as an edit: a rerun
// names it as a conflict, and Undo keeps it and every record it depends on.
import { canonicalJson } from '../../../modules/import-kit/src/provenance/identity.ts'
import type { D1Database, D1Sql, D1TargetAdapter, D1UndoDependency, TargetRow } from '../../../modules/import-kit/src/d1/index.ts'
import type { Json } from '../../../modules/import-kit/src/types.ts'
import { nativeId } from './source.ts'

const sql = (text: string, ...params: unknown[]): D1Sql => ({ sql: text, params })
const NOW = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)"
type Kind = 'venue' | 'product' | 'item'
type Value = Record<string, Json>

interface Shape { side: string; key: string; table: string; marker: string }
const SHAPES: Record<Kind, Shape> = {
  venue: { side: 'stump_venue_imports', key: 'venue_id', table: 'stump_venues', marker: "n.revision||''" },
  product: { side: 'stump_product_imports', key: 'product_id', table: 'stump_products', marker: "n.revision||':'||n.updated_at" },
  item: { side: 'stump_item_imports', key: 'item_id', table: 'stump_items', marker: "n.revision||':'||n.updated_at" },
}
const sideMarker = (kind: Kind) => kind === 'venue' ? "i.native_revision||''" : "i.native_revision||':'||i.native_updated_at"
const shape = (kind: string) => { if (!Object.hasOwn(SHAPES, kind)) throw new Error('IMPORT_TARGET_SCOPE_INVALID'); return SHAPES[kind as Kind] }

/** The select every read uses: the side row, the native row's current marker and whether it is unchanged since the import wrote it. */
const selectRows = (kind: Kind, where: string) =>
  `SELECT i.target_id,i.kit_revision,i.value_json,${SHAPES[kind].marker} AS current,${sideMarker(kind)} AS written FROM ${SHAPES[kind].side} i JOIN ${SHAPES[kind].table} n ON n.id=i.${SHAPES[kind].key} ${where}`
interface Read { target_id: string; kit_revision: string; value_json: string; current: string; written: string }
/** Unchanged rows carry the kit's applied revision; an edited one carries its native marker, so it never matches the applied snapshot. */
const toRow = (destination: string, kind: Kind, row: Read): TargetRow => ({
  destination, targetKind: kind, targetId: row.target_id, value: JSON.parse(row.value_json) as Json,
  revision: row.current === row.written ? row.kit_revision : `edited:${row.current}`,
})

function writeVenue(row: TargetRow, value: Value): D1Sql[] {
  const id = nativeId(row.targetId), products = (value.products as Array<{ product_id: string }>) ?? []
  return [
    sql(`INSERT INTO stump_venues(id,kind,name,url,url_key,platform,status,priority,rules,shared_limit,archived,excluded,notes,created_by,created_at,updated_at,details,audience,how_to_post,requirements,reception)
      VALUES(?,?,?,?,?,?,?,?,?,?,0,?,?,?,${NOW},${NOW},?,?,?,'{}',?)
      ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,name=excluded.name,url=excluded.url,url_key=excluded.url_key,platform=excluded.platform,status=excluded.status,
        priority=excluded.priority,rules=excluded.rules,shared_limit=excluded.shared_limit,excluded=excluded.excluded,notes=excluded.notes,details=excluded.details,
        audience=excluded.audience,how_to_post=excluded.how_to_post,reception=excluded.reception,revision=stump_venues.revision+1,updated_at=excluded.updated_at`,
      id, value.kind, value.name, value.url, value.url_key, value.platform, value.status, value.priority === null ? null : ['low', 'medium', 'high', 'top'].indexOf(String(value.priority)) + 1,
      JSON.stringify(value.rules ?? {}), value.shared_limit ? JSON.stringify(value.shared_limit) : null, value.excluded ? JSON.stringify(value.excluded) : null,
      [value.notes, value.limit_text ? `Shared limit as the list states it: ${String(value.limit_text)}` : null].filter(Boolean).join('\n') || null, value.created_by,
      JSON.stringify(value.details ?? {}), value.audience, JSON.stringify(value.how_to_post ?? {}), value.reception),
    sql('DELETE FROM stump_venue_products WHERE venue_id=?', id),
    ...products.map(item => sql('INSERT INTO stump_venue_products(venue_id,product_id,fit) VALUES(?,?,NULL)', id, item.product_id)),
    sql(`INSERT INTO stump_venue_history(id,venue_id,action,person_id,agent_id,detail,at) VALUES(lower(hex(randomblob(16))),?,'import',?,NULL,?,${NOW})`, id, value.created_by, JSON.stringify({ source: value.namespace })),
  ]
}
function writeProduct(row: TargetRow, value: Value): D1Sql[] {
  return [sql(`INSERT INTO stump_products(id,name,created_by,created_at,updated_at) VALUES(?,?,?,${NOW},${NOW})
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,revision=stump_products.revision+1,updated_at=excluded.updated_at`, nativeId(row.targetId), value.name, value.created_by)]
}
function writeItem(row: TargetRow, value: Value): D1Sql[] {
  const id = nativeId(row.targetId)
  return [
    // Imported drafts wait for the draft check before anything schedules them (blocking until checked).
    sql(`INSERT INTO stump_items(id,format,venue_id,person_id,product_id,state,text,flags,routes,options,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,'draft',?,?,?,?,?,${NOW},${NOW})
      ON CONFLICT(id) DO UPDATE SET format=excluded.format,venue_id=excluded.venue_id,product_id=excluded.product_id,text=excluded.text,routes=excluded.routes,
        options=excluded.options,revision=stump_items.revision+1,updated_at=excluded.updated_at`,
      id, value.format, value.venue_id, value.person_id, value.product_id, value.text, JSON.stringify([{ code: 'not_checked', blocking: true, reason: 'Imported; run the draft check before scheduling.' }]),
      JSON.stringify(value.routes ?? []), JSON.stringify(value.options ?? {}), value.created_by),
    sql(`INSERT INTO stump_item_revisions(item_id,revision,text,saved_by,at) SELECT id,revision,text,?,${NOW} FROM stump_items WHERE id=? ON CONFLICT(item_id,revision) DO UPDATE SET text=excluded.text`, value.created_by, id),
    sql(`INSERT INTO stump_item_history(id,item_id,from_state,to_state,person_id,reason,at) VALUES(lower(hex(randomblob(16))),?,NULL,'draft',?,'imported from the venue list',${NOW})`, id, value.created_by),
  ]
}

const sideWrite = (kind: Kind, row: TargetRow, value: Value): D1Sql => {
  const { side, key, table } = SHAPES[kind], id = nativeId(row.targetId)
  const columns = kind === 'venue' ? 'native_revision' : 'native_revision,native_updated_at'
  const select = kind === 'venue' ? 'revision' : 'revision,updated_at'
  return sql(`INSERT INTO ${side}(${key},target_id,namespace,kit_revision,value_json,${columns}) SELECT ?,?,?,?,?,${select} FROM ${table} WHERE id=?
    ON CONFLICT(${key}) DO UPDATE SET kit_revision=excluded.kit_revision,value_json=excluded.value_json,${columns.split(',').map(column => `${column}=excluded.${column}`).join(',')}`,
    id, row.targetId, value.namespace, row.revision, canonicalJson(row.value), id)
}

/** Native rows outside this import that use an imported venue or product: Undo keeps what they need. */
async function outsideUse(db: D1Database, kind: Kind, id: string): Promise<{ table: string; recordId: string; count: number } | null> {
  const checks = kind === 'venue' ? [
    ['stump_items', 'SELECT id FROM stump_items WHERE venue_id=?1 AND id NOT IN (SELECT item_id FROM stump_item_imports)'],
    ['stump_handoffs', 'SELECT id FROM stump_handoffs WHERE venue_id=?1'],
    ['stump_ledger', 'SELECT id FROM stump_ledger WHERE venue_id=?1'],
    ['stump_venue_members', 'SELECT person_id AS id FROM stump_venue_members WHERE venue_id=?1'],
    ['stump_venue_applications', 'SELECT id FROM stump_venue_applications WHERE venue_id=?1'],
  ] : kind === 'product' ? [
    ['stump_items', 'SELECT id FROM stump_items WHERE product_id=?1 AND id NOT IN (SELECT item_id FROM stump_item_imports)'],
    ['stump_claims', 'SELECT id FROM stump_claims WHERE product_id=?1'],
    ['stump_venue_products', 'SELECT venue_id AS id FROM stump_venue_products WHERE product_id=?1 AND venue_id NOT IN (SELECT venue_id FROM stump_venue_imports)'],
  ] : []
  for (const [table, query] of checks) {
    const rows = (await db.prepare(query!).bind(id).all<{ id: string }>()).results
    if (rows.length) return { table: table!, recordId: rows[0]!.id, count: rows.length }
  }
  return null
}
// Plain placeholders only: the kit joins guard fragments into one statement, so numbered ones would bind the wrong values.
const outsideCount = (kind: Kind, id: string): D1Sql => kind === 'venue'
  ? sql(`(SELECT COUNT(*) FROM stump_items WHERE venue_id=? AND id NOT IN (SELECT item_id FROM stump_item_imports))+(SELECT COUNT(*) FROM stump_handoffs WHERE venue_id=?)
    +(SELECT COUNT(*) FROM stump_ledger WHERE venue_id=?)+(SELECT COUNT(*) FROM stump_venue_members WHERE venue_id=?)+(SELECT COUNT(*) FROM stump_venue_applications WHERE venue_id=?)`, id, id, id, id, id)
  : sql(`(SELECT COUNT(*) FROM stump_items WHERE product_id=? AND id NOT IN (SELECT item_id FROM stump_item_imports))+(SELECT COUNT(*) FROM stump_claims WHERE product_id=?)
    +(SELECT COUNT(*) FROM stump_venue_products WHERE product_id=? AND venue_id NOT IN (SELECT venue_id FROM stump_venue_imports))`, id, id, id)

export const venueListTargets: D1TargetAdapter = {
  async read(db, destination, kind, id) {
    const found = await db.prepare(selectRows(kind as Kind, 'WHERE i.target_id=?')).bind(id).first<Read>()
    if (found) return toRow(destination, kind as Kind, found)
    // A native record in the import's place is never treated as absent (it is refused, not overwritten).
    const collision = kind === 'venue'
      ? await db.prepare('SELECT 1 FROM stump_venues WHERE id=? OR url_key=?').bind(nativeId(id), id.slice('venue:'.length)).first()
      : await db.prepare(`SELECT 1 FROM ${shape(kind).table} WHERE id=?`).bind(nativeId(id)).first()
    if (collision) throw new Error('IMPORT_TARGET_COLLISION')
    return undefined
  },
  matches(row, _destination, kind, id) {
    const { side, key, table, marker } = shape(kind)
    if (!row) return kind === 'venue'
      ? sql(`NOT EXISTS(SELECT 1 FROM ${side} WHERE target_id=?) AND NOT EXISTS(SELECT 1 FROM stump_venues WHERE id=? OR url_key=?)`, id, nativeId(id), id.slice('venue:'.length))
      : sql(`NOT EXISTS(SELECT 1 FROM ${side} WHERE target_id=?) AND NOT EXISTS(SELECT 1 FROM ${table} WHERE id=?)`, id, nativeId(id))
    const join = `FROM ${side} i JOIN ${table} n ON n.id=i.${key} WHERE i.target_id=? AND i.value_json=?`
    return row.revision.startsWith('edited:')
      ? sql(`EXISTS(SELECT 1 ${join} AND ${marker}=? AND ${marker}<>${sideMarker(kind as Kind)})`, id, canonicalJson(row.value), row.revision.slice('edited:'.length))
      : sql(`EXISTS(SELECT 1 ${join} AND i.kit_revision=? AND ${marker}=${sideMarker(kind as Kind)})`, id, canonicalJson(row.value), row.revision)
  },
  matchesCount(count) {
    return sql('(SELECT COUNT(*) FROM stump_venue_imports)+(SELECT COUNT(*) FROM stump_product_imports)+(SELECT COUNT(*) FROM stump_item_imports)=?', count)
  },
  write(row) {
    const kind = row.targetKind as Kind, value = row.value as Value
    shape(kind)
    const native = kind === 'venue' ? writeVenue(row, value) : kind === 'product' ? writeProduct(row, value) : writeItem(row, value)
    return [...native, sideWrite(kind, row, value)]
  },
  remove(_destination, kind, id) {
    const native = nativeId(id), { side } = shape(kind)
    // Only a record the import still holds: one an earlier Undo kept and released is Stump's own and is never removed by an import.
    const held = ` AND EXISTS(SELECT 1 FROM ${side} WHERE target_id=?)`
    const del = (text: string) => sql(text + held, native, id)
    const rows = kind === 'venue'
      ? [del('DELETE FROM stump_venue_products WHERE venue_id=?'), del('DELETE FROM stump_venue_history WHERE venue_id=?'), del('DELETE FROM stump_venues WHERE id=?')]
      : kind === 'product' ? [del('DELETE FROM stump_products WHERE id=?')]
        : [del('DELETE FROM stump_item_revisions WHERE item_id=?'), del('DELETE FROM stump_item_history WHERE item_id=?'), del('DELETE FROM stump_items WHERE id=?')]
    return [...rows, sql(`DELETE FROM ${side} WHERE target_id=?`, id)]
  },
  async list(db, destination) {
    const rows: TargetRow[] = []
    for (const kind of ['product', 'venue', 'item'] as const) rows.push(...(await db.prepare(selectRows(kind, 'ORDER BY i.target_id')).all<Read>()).results.map(row => toRow(destination, kind, row)))
    return rows
  },
  // Undo keeps an edited record, every record it needs (its venue and product),
  // and a venue or product something outside the import now uses.
  async preparePreservedUndo(db, destination, effects) {
    const rows = await this.list(db, destination)
    const byTarget = new Map(effects.map(effect => [`${effect.expected.targetKind}|${effect.expected.targetId}`, effect.provenance.id]))
    const dependencies: D1UndoDependency[] = [], guards: D1Sql[] = [this.matchesCount!(rows.length, destination), ...rows.map(row => this.matches(row, destination, row.targetKind, row.targetId))]
    for (const effect of effects) {
      const kind = effect.expected.targetKind as Kind, value = effect.expected.value as Value, id = nativeId(effect.expected.targetId)
      const needs = kind === 'item' ? [['venue', value.venue_target], ['product', value.product_target]] : kind === 'venue' ? ((value.products as Array<{ product_target: string | null }>) ?? []).map(item => ['product', item.product_target]) : []
      for (const [needKind, target] of needs) {
        const required = target ? byTarget.get(`${needKind}|${target}`) : undefined
        if (required) dependencies.push({ requiredEffectId: required, dependentEffectId: effect.provenance.id, cause: { table: SHAPES[kind].table, recordId: id }, evidence: { needs: `${needKind} ${String(target)}` } })
      }
      if (kind !== 'item') {
        const used = await outsideUse(db, kind, id)
        if (used) dependencies.push({ requiredEffectId: effect.provenance.id, cause: { table: used.table, recordId: used.recordId }, evidence: { used_by: used.count } })
        guards.push(sql(`(${outsideCount(kind, id).sql})=?`, ...outsideCount(kind, id).params!, used?.count ?? 0))
      }
    }
    return {
      observations: effects.map(effect => ({
        effectId: effect.provenance.id, current: rows.find(row => row.targetKind === effect.expected.targetKind && row.targetId === effect.expected.targetId) ?? null,
        entity: { table: shape(effect.expected.targetKind).table, recordId: nativeId(effect.expected.targetId) },
      })),
      dependencies, guards,
    }
  },
}
