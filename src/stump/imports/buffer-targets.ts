// The import kit's native target for a Buffer export (STUMP-IMPORT-001): the
// accounts its channels become (waiting for their owners to connect), each
// channel's queue slots, its sent posts as published ledger entries (written by
// ledger/record.ts) and its queued and draft posts as items. A side row per
// target keeps the exact value the import wrote and the native marker right
// after, so any later edit in Stump reads as an edit: a rerun names it, and
// Undo keeps it and every record it depends on. For an item the marker is what
// a person changes (its text revision, time and account) and whether it has
// begun posting; the import's own release from paused to scheduled, the draft
// check and a hold are not edits, so Undo removes a released post that has not
// gone out.
import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import type { D1Database, D1Sql, D1TargetAdapter, D1UndoDependency, TargetRow } from '../../modules/import-kit/src/d1/index.ts'
import type { Json } from '../../modules/import-kit/src/types.ts'
import { importedEntrySql, removeImportedEntrySql } from '../ledger/record.ts'

export type BufferKind = 'account' | 'slots' | 'ledger_entry' | 'item'
export type Value = Record<string, Json>
const sql = (text: string, ...params: unknown[]): D1Sql => ({ sql: text, params })
const NOW = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)"
const SIDE = 'stump_buffer_imports'

/** A target's native id: stable for the same target, so a rerun and Undo find it. */
export const bufferId = (targetId: string) => `buf_${sha256(targetId).slice(0, 24)}`
/** The page where an account waiting for its owner is connected. */
export const reconnectPath = (accountId: string) => `/app/settings/accounts?reconnect=${encodeURIComponent(accountId)}`

interface Shape { table: string; key: string; marker: string }
export const SHAPES: Record<BufferKind, Shape> = {
  account: { table: 'stump_accounts', key: 'id', marker: "n.revision||''" },
  slots: { table: 'stump_queue_slots', key: 'account_id', marker: "n.updated_at||''" },
  ledger_entry: { table: 'stump_ledger', key: 'id', marker: "n.updated_at||''" },
  item: {
    table: 'stump_items', key: 'id',
    marker: `n.revision||':'||COALESCE(n.scheduled_at,'')||':'||COALESCE(n.account_id,'')||':'||CASE WHEN n.state IN ('posting','posted','partly_posted','failed','uncertain')
      OR EXISTS(SELECT 1 FROM stump_item_history h WHERE h.item_id=n.id AND h.to_state='posting') THEN 'posting' ELSE '' END`,
  },
}
const shape = (kind: string) => { if (!Object.hasOwn(SHAPES, kind)) throw new Error('IMPORT_TARGET_SCOPE_INVALID'); return SHAPES[kind as BufferKind] }
/** The native record a target names: the id its value carries. */
export const nativeOf = (kind: BufferKind, value: Value) => String(kind === 'slots' ? value.account_id : value.id)

const selectRows = (kind: BufferKind, where: string) =>
  `SELECT i.target_id,i.kit_revision,i.value_json,${SHAPES[kind].marker} AS current,i.native_marker AS written FROM ${SIDE} i JOIN ${SHAPES[kind].table} n ON n.${SHAPES[kind].key}=i.native_id WHERE i.kind='${kind}' ${where}`
interface Read { target_id: string; kit_revision: string; value_json: string; current: string; written: string }
/** Unchanged rows carry the kit's applied revision; an edited one carries its native marker, so it never matches the applied snapshot. */
const toRow = (destination: string, kind: BufferKind, row: Read): TargetRow => ({
  destination, targetKind: kind, targetId: row.target_id, value: JSON.parse(row.value_json) as Json,
  revision: row.current === row.written ? row.kit_revision : `edited:${row.current}`,
})

function writeAccount(value: Value): D1Sql[] {
  return [sql(`INSERT INTO stump_accounts(id,network,handle,display_name,owner_kind,owner_person_id,connected_by,connected_at,state,reconnect_url,created_at,updated_at)
    VALUES(?,?,?,?,'company',NULL,NULL,NULL,'awaiting_reconnect',?,${NOW},${NOW})
    ON CONFLICT(id) DO UPDATE SET network=excluded.network,handle=excluded.handle,display_name=excluded.display_name,revision=stump_accounts.revision+1,updated_at=excluded.updated_at`,
  value.id, value.network, value.handle, value.display_name, reconnectPath(String(value.id)))]
}
function writeSlots(value: Value): D1Sql[] {
  return [sql(`INSERT INTO stump_queue_slots(account_id,time_zone,slots,updated_by,updated_at) VALUES(?,?,?,?,${NOW})
    ON CONFLICT(account_id) DO UPDATE SET time_zone=excluded.time_zone,slots=excluded.slots,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
  value.account_id, value.time_zone, JSON.stringify(value.slots), value.created_by)]
}
function writeEntry(value: Value): D1Sql[] {
  const results = value.results as { values: Record<string, number> } | null
  return importedEntrySql(String(value.id), {
    network: String(value.network), account_id: String(value.account_id), url: value.url as string | null, network_id: value.network_id as string | null, text: String(value.text),
    posted_at: Number(value.posted_at), by: 'Buffer', results: results ? { source: 'buffer', values: results.values, read_at: null } : null,
  }, Date.now()).map(statement => sql(statement.sql, ...statement.params))
}
function writeItem(value: Value): D1Sql[] {
  const id = value.id
  const options = { imported_from: 'buffer', buffer_update_id: value.update_id, ...(value.media ? { media: value.media } : {}) }
  const hold = value.state === 'paused'
    ? { owner_id: value.person_id, reason: 'Imported from Buffer. Clear it from Buffer\'s queue, then release it here so it never posts twice.', next_attempt_at: null, kind: 'import' }
    : null
  return [
    // Each imported item waits for the draft check before anything schedules it (blocking until checked).
    sql(`INSERT INTO stump_items(id,format,network,account_id,person_id,state,text,flags,options,hold,scheduled_at,time_zone,queued,created_by,created_at,updated_at)
      VALUES(?,'post',?,?,?,?,?,?,?,?,?,?,?,?,${NOW},${NOW})
      ON CONFLICT(id) DO UPDATE SET network=excluded.network,account_id=excluded.account_id,text=excluded.text,options=excluded.options,
        hold=CASE WHEN stump_items.state='paused' THEN excluded.hold ELSE stump_items.hold END,scheduled_at=excluded.scheduled_at,
        time_zone=excluded.time_zone,queued=excluded.queued,revision=stump_items.revision+1,updated_at=excluded.updated_at`,
    id, value.network, value.account_id, value.person_id, value.state, value.text,
    JSON.stringify([{ code: 'not_checked', blocking: true, reason: 'Imported; the draft check runs once the import is applied.' }]),
    JSON.stringify(options), hold ? JSON.stringify(hold) : null, value.scheduled_at, value.time_zone, value.queued ? 1 : 0, value.person_id),
    sql(`INSERT INTO stump_item_revisions(item_id,revision,text,saved_by,at) SELECT id,revision,text,?,${NOW} FROM stump_items WHERE id=? ON CONFLICT(item_id,revision) DO UPDATE SET text=excluded.text`, value.person_id, id),
    sql(`INSERT INTO stump_item_history(id,item_id,from_state,to_state,person_id,reason,at) VALUES(lower(hex(randomblob(16))),?,NULL,?,?,'imported from Buffer',${NOW})`, id, value.state, value.person_id),
  ]
}

const sideWrite = (kind: BufferKind, row: TargetRow, value: Value): D1Sql => {
  const { table, key, marker } = SHAPES[kind], native = nativeOf(kind, value)
  return sql(`INSERT INTO ${SIDE}(target_id,kind,native_id,kit_revision,value_json,native_marker) SELECT ?,?,?,?,?,${marker} FROM ${table} n WHERE n.${key}=?
    ON CONFLICT(target_id) DO UPDATE SET kit_revision=excluded.kit_revision,value_json=excluded.value_json,native_marker=excluded.native_marker`,
  row.targetId, kind, native, row.revision, canonicalJson(row.value), native)
}

/** Native rows outside this import that use an imported account: Undo keeps the account they need. */
const OUTSIDE = [
  ['stump_items', `SELECT id FROM stump_items WHERE account_id=? AND id NOT IN (SELECT native_id FROM ${SIDE} WHERE kind='item')`],
  ['stump_ledger', `SELECT id FROM stump_ledger WHERE account_id=? AND id NOT IN (SELECT native_id FROM ${SIDE} WHERE kind='ledger_entry')`],
  ['stump_queue_slots', `SELECT account_id AS id FROM stump_queue_slots WHERE account_id=? AND account_id NOT IN (SELECT native_id FROM ${SIDE} WHERE kind='slots')`],
  ['stump_pause', 'SELECT scope_key AS id FROM stump_pause WHERE account_id=?'],
] as const
async function outsideUse(db: D1Database, id: string): Promise<{ table: string; recordId: string; count: number } | null> {
  for (const [table, query] of OUTSIDE) {
    const rows = (await db.prepare(query).bind(id).all<{ id: string }>()).results
    if (rows.length) return { table, recordId: rows[0]!.id, count: rows.length }
  }
  return null
}
// Plain placeholders only: the kit joins guard fragments into one statement, so numbered ones would bind the wrong values.
const outsideCount = (id: string): D1Sql => sql(OUTSIDE.map(([, query]) => `(SELECT COUNT(*) FROM (${query}))`).join('+'), id, id, id, id)

export const bufferTargets: D1TargetAdapter = {
  async read(db, destination, kind, id) {
    const found = await db.prepare(selectRows(kind as BufferKind, 'AND i.target_id=?')).bind(id).first<Read>()
    if (found) return toRow(destination, kind as BufferKind, found)
    if (await db.prepare(`SELECT 1 FROM ${SIDE} WHERE target_id=?`).bind(id).first()) throw new Error('IMPORT_TARGET_COLLISION')
    // A native record in the import's place is never treated as absent (it is refused, not overwritten).
    const { table, key } = shape(kind)
    const native = kind === 'slots' ? bufferId(`buffer-channel:${id.slice('buffer-schedule:'.length)}`) : bufferId(id)
    if (await db.prepare(`SELECT 1 FROM ${table} WHERE ${key}=?`).bind(native).first()) throw new Error('IMPORT_TARGET_COLLISION')
    return undefined
  },
  matches(row, _destination, kind, id) {
    const { table, key, marker } = shape(kind)
    if (!row) return kind === 'slots'
      ? sql(`NOT EXISTS(SELECT 1 FROM ${SIDE} WHERE target_id=?)`, id)
      : sql(`NOT EXISTS(SELECT 1 FROM ${SIDE} WHERE target_id=?) AND NOT EXISTS(SELECT 1 FROM ${table} WHERE ${key}=?)`, id, bufferId(id))
    const join = `FROM ${SIDE} i JOIN ${table} n ON n.${key}=i.native_id WHERE i.target_id=? AND i.value_json=?`
    return row.revision.startsWith('edited:')
      ? sql(`EXISTS(SELECT 1 ${join} AND ${marker}=? AND ${marker}<>i.native_marker)`, id, canonicalJson(row.value), row.revision.slice('edited:'.length))
      : sql(`EXISTS(SELECT 1 ${join} AND i.kit_revision=? AND ${marker}=i.native_marker)`, id, canonicalJson(row.value), row.revision)
  },
  matchesCount(count) {
    return sql(`(SELECT COUNT(*) FROM ${SIDE})=?`, count)
  },
  write(row) {
    const kind = row.targetKind as BufferKind, value = row.value as Value
    shape(kind)
    const native = kind === 'account' ? writeAccount(value) : kind === 'slots' ? writeSlots(value) : kind === 'ledger_entry' ? writeEntry(value) : writeItem(value)
    return [...native, sideWrite(kind, row, value)]
  },
  remove(_destination, kind, id) {
    const { table, key } = shape(kind)
    // Only a record the import still holds: one an earlier Undo kept and released is Stump's own and is never removed by an import.
    const native = `(SELECT native_id FROM ${SIDE} WHERE target_id=?)`, held = { sql: `EXISTS(SELECT 1 FROM ${SIDE} WHERE target_id=?)`, params: [id] }
    const rows = kind === 'ledger_entry'
      ? removeImportedEntrySql(bufferId(id), held).map(statement => sql(statement.sql, ...statement.params))
      : kind === 'item'
        ? ['stump_item_revisions', 'stump_item_history'].map(child => sql(`DELETE FROM ${child} WHERE item_id=${native} AND ${held.sql}`, id, id))
          .concat(sql(`DELETE FROM stump_items WHERE id=${native} AND ${held.sql}`, id, id))
        : [sql(`DELETE FROM ${table} WHERE ${key}=${native} AND ${held.sql}`, id, id)]
    return [...rows, sql(`DELETE FROM ${SIDE} WHERE target_id=?`, id)]
  },
  async list(db, destination) {
    const rows: TargetRow[] = []
    for (const kind of ['account', 'slots', 'ledger_entry', 'item'] as const) rows.push(...(await db.prepare(selectRows(kind, 'ORDER BY i.target_id')).all<Read>()).results.map(row => toRow(destination, kind, row)))
    return rows
  },
  // Undo keeps an edited record and the account it needs, and an account something outside the import now uses.
  async preparePreservedUndo(db, destination, effects) {
    const rows = await this.list(db, destination)
    const byTarget = new Map(effects.map(effect => [`${effect.expected.targetKind}|${effect.expected.targetId}`, effect.provenance.id]))
    const dependencies: D1UndoDependency[] = [], guards: D1Sql[] = [this.matchesCount!(rows.length, destination), ...rows.map(row => this.matches(row, destination, row.targetKind, row.targetId))]
    for (const effect of effects) {
      const kind = effect.expected.targetKind as BufferKind, value = effect.expected.value as Value
      if (kind !== 'account') {
        const required = typeof value.account_target === 'string' ? byTarget.get(`account|${value.account_target}`) : undefined
        if (required) dependencies.push({ requiredEffectId: required, dependentEffectId: effect.provenance.id, cause: { table: SHAPES[kind].table, recordId: nativeOf(kind, value) }, evidence: { needs: `account ${String(value.account_target)}` } })
        continue
      }
      const id = nativeOf(kind, value), used = await outsideUse(db, id), count = outsideCount(id)
      if (used) dependencies.push({ requiredEffectId: effect.provenance.id, cause: { table: used.table, recordId: used.recordId }, evidence: { used_by: used.count } })
      guards.push(sql(`(${count.sql})=?`, ...count.params!, used?.count ?? 0))
    }
    return {
      observations: effects.map(effect => ({
        effectId: effect.provenance.id, current: rows.find(row => row.targetKind === effect.expected.targetKind && row.targetId === effect.expected.targetId) ?? null,
        entity: { table: shape(effect.expected.targetKind).table, recordId: nativeOf(effect.expected.targetKind as BufferKind, effect.expected.value as Value) },
      })),
      dependencies, guards,
    }
  },
}
