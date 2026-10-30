// Switching from Buffer (STUMP-IMPORT-001): the import door's buffer source.
// The file is the JSON bundle of Buffer's published v1 API objects,
//   { format, profiles[], updates{<profile_id>: {pending, sent}} },
// read whole by lib/imports. Each channel becomes an account that waits for its
// owner to connect (Buffer's export carries no tokens), its posting schedule
// becomes the account's queue slots, its sent posts become published ledger
// entries with Buffer's statistics as imported results, and its queued posts
// become items in those slots, paused until the person confirms Buffer's queue
// is cleared (stump.calendar.plan release_import). An account Stump already
// has on the same network and handle is kept as it is, and the file's posts
// attach to it.
import type { ImportDoorRawSource } from '../../modules/import-kit/src/door/types.ts'
import type { Json, MappingResult, ParsedRecord, SourceRecord } from '../../modules/import-kit/src/types.ts'
import { recheckItems } from '../data/recheck.ts'
import { classify, mapRecord, parseBufferBundle, REJECTED_KIND, targetKey, toRecords, type BufferSummary, type ImportRow, type JsonObject, type ParsedBuffer, type RejectedRow } from '../lib/imports/index.ts'
import { onSlot, type Slot, type Weekday } from '../publish/time.ts'
import { bufferId, nativeOf, SHAPES, type BufferKind, type Value } from './buffer-targets.ts'

export const BUFFER_DESTINATION = 'stump-buffer'
const MAPPING_VERSION = 'stump-buffer-1'
/** The networks Stump publishes to; a Buffer channel on any other network is refused by name, with its posts. */
const NETWORKS = ['x', 'bluesky', 'mastodon', 'linkedin']
const DAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const scheduleTarget = (profileId: string) => `buffer-schedule:${profileId}`

/** A row of the file that is already Stump's own record. */
export interface Existing { kind: 'account' | 'slots'; source_id: string; id: string; name: string | null; reason: string }
export interface RowChange { kind: BufferKind; source_id: string; id: string; name: string | null; conflict: boolean; cause: string | null; reason: string | null; fields: Array<{ field: string; before: unknown; after: unknown }> }
export interface PlanRow { kind: string; sourceId: string; conflict: boolean; reason: string | null }

/** What Stump holds now that the import could meet, read once per request. */
async function known(db: D1Database) {
  const ours = new Map((await db.prepare('SELECT target_id,kind,native_id FROM stump_buffer_imports').all<{ target_id: string; kind: BufferKind; native_id: string }>()).results.map(row => [row.target_id, row]))
  const oursAccounts = new Set([...ours.values()].filter(row => row.kind === 'account').map(row => row.native_id))
  const accounts = new Map<string, { id: string; handle: string }>()
  for (const row of (await db.prepare('SELECT id,network,handle FROM stump_accounts').all<{ id: string; network: string; handle: string }>()).results) {
    if (!oursAccounts.has(row.id)) accounts.set(`${row.network}|${row.handle.toLowerCase()}`, { id: row.id, handle: row.handle })
  }
  const slotted = new Set((await db.prepare('SELECT account_id FROM stump_queue_slots').all<{ account_id: string }>()).results.map(row => row.account_id))
  return { ours, accounts, slotted }
}

/** The handle as each network names it: an atproto handle or X username has no '@' (LinkedIn keeps its own form). */
const handleOf = (network: string, handle: string) => network === 'linkedin' ? handle.trim() : handle.trim().replace(/^@/, '')

/** Buffer's day-and-time slots for one channel, regrouped as Stump keeps them: days that share their times together. */
function slotsOf(rows: ImportRow[]): Slot[] {
  const byDay = new Map<string, string[]>()
  for (const row of rows) { const day = String(row.payload.day), times = byDay.get(day) ?? []; times.push(String(row.payload.time)); byDay.set(day, times) }
  const groups = new Map<string, Weekday[]>()
  for (const day of DAYS) {
    const times = byDay.get(day)
    if (!times) continue
    const key = [...new Set(times)].sort().join(','), days = groups.get(key) ?? []
    days.push(day); groups.set(key, days)
  }
  return [...groups].map(([times, days]) => ({ days, times: times.split(',') }))
}

/** The reader's result with every channel on a network Stump does not publish to refused, with its posts and slots. */
function supportedOnly(parsed: ParsedBuffer): { rows: ImportRow[]; rejected: RejectedRow[]; summary: BufferSummary } {
  const refused = new Map<string, string>()
  for (const row of parsed.rows) if (row.kind === 'channel' && !NETWORKS.includes(String(row.payload.network))) refused.set(row.sourceId, String(row.payload.network))
  const rejected: RejectedRow[] = [...parsed.rejected], rows: ImportRow[] = []
  const refuse = (id: string, kind: string, reason: string) => rejected.push({ id, kind, line: null, reason, reasons: [reason] })
  for (const row of parsed.rows) {
    const channel = row.kind === 'channel' ? row.sourceId : String(row.payload.channel_key ?? '')
    const network = refused.get(channel)
    if (!network) { rows.push(row); continue }
    if (row.kind === 'channel') refuse(row.sourceId.slice('buffer-channel:'.length), 'channel', `Stump does not publish to ${network}; this channel and its posts are not imported`)
    else if (row.kind !== 'slot') refuse(row.sourceId.slice(row.sourceId.indexOf(':') + 1), row.kind, `its channel is on ${network}, which Stump does not publish to`)
  }
  const count = (kind: string) => rows.filter(row => row.kind === kind).length
  return { rows, rejected, summary: { channels: count('channel'), sent: count('sent'), queued: count('queued') } }
}

/**
 * One request's source: its reader, its mapping (bound to what Stump holds now
 * and to the owner who imports) and the summary the reader counted.
 */
export async function bufferSource(db: D1Database, ownerId: string) {
  const state = await known(db)
  let summary: BufferSummary | null = null, rejected: Array<{ kind: string; sourceId: string; reason: string }> | null = null
  const mapped = new Map<string, Value>()
  const existing = new Map<string, Existing>()
  // Each channel's account in this request: the file's own (with its target) or one Stump already has.
  const accountFor = new Map<string, { id: string; target: string | null; slotted: boolean }>()
  // Each channel's slots and time zone as the reader read them, for the queued posts that sit in them.
  const scheduleFor = new Map<string, { zone: string | null; slots: Slot[] }>()

  const keep = (kind: Existing['kind'], sourceId: string, id: string, name: string | null, reason: string): MappingResult => {
    existing.set(`${kind}|${sourceId}`, { kind, source_id: sourceId, id, name, reason })
    return { effects: [], unmapped: [{ reason }] }
  }
  const effect = (kind: BufferKind, record: SourceRecord, value: Value): MappingResult => {
    mapped.set(`${kind}|${record.sourceId}`, value)
    return { effects: [{ targetKind: kind, targetId: record.sourceId, value }] }
  }

  function mapChannel(record: SourceRecord): MappingResult {
    const p = record.payload as Record<string, Json>, network = String(p.network), handle = handleOf(network, String(p.handle))
    const found = state.ours.has(record.sourceId) ? null : state.accounts.get(`${network}|${handle.toLowerCase()}`)
    if (found) {
      accountFor.set(record.sourceId, { id: found.id, target: null, slotted: state.slotted.has(found.id) })
      return keep('account', record.sourceId, found.id, handle, `Stump already has ${network} ${found.handle} (${found.id}); it is kept as it is and Buffer's posts attach to it.`)
    }
    const id = bufferId(record.sourceId)
    accountFor.set(record.sourceId, { id, target: record.sourceId, slotted: false })
    return effect('account', record, { id, network, handle, display_name: (p.display_name as string | null) ?? handle })
  }

  function mapSchedule(record: SourceRecord): MappingResult {
    const p = record.payload as Record<string, Json>, account = accountFor.get(String(p.channel_key))
    if (!account) return { effects: [], rejection: `schedule ${record.sourceId}: its channel is not imported` }
    if (account.slotted) return keep('slots', record.sourceId, account.id, null, `The account ${account.id} already has queue slots in Stump; they are kept as they are.`)
    return effect('slots', record, { account_id: account.id, account_target: account.target, time_zone: p.time_zone!, slots: p.slots!, created_by: ownerId })
  }

  function mapSent(record: SourceRecord): MappingResult {
    const p = record.payload as Record<string, Json>, account = accountFor.get(String(p.channel_key))
    if (!account) return { effects: [], rejection: `sent ${record.sourceId}: its channel is not imported` }
    const values = (p.results ?? {}) as Record<string, number>
    return effect('ledger_entry', record, {
      id: bufferId(record.sourceId), account_id: account.id, account_target: account.target, network: p.network!, url: p.url ?? null, network_id: p.network_id ?? null,
      text: p.text!, posted_at: Date.parse(String(p.posted_at)), results: Object.keys(values).length ? { values } : null,
    })
  }

  function mapPending(record: SourceRecord): MappingResult {
    const p = record.payload as Record<string, Json>, account = accountFor.get(String(p.channel_key))
    if (!account) return { effects: [], rejection: `${record.kind} ${record.sourceId}: its channel is not imported` }
    const draft = record.kind === 'buffer_draft', at = !draft && typeof p.scheduled_at === 'string' ? Date.parse(p.scheduled_at) : null
    const schedule = scheduleFor.get(String(p.channel_key))
    return effect('item', record, {
      id: bufferId(record.sourceId), state: draft ? 'draft' : 'paused', network: p.network!, account_id: account.id, account_target: account.target, person_id: ownerId,
      text: p.text!, scheduled_at: at, time_zone: schedule?.zone ?? null, media: p.media ?? null, update_id: (p.import_ref as { update_id: string }).update_id,
      // A queued post that falls on one of the channel's slots sits in that slot, as it did in Buffer.
      queued: at !== null && !!schedule?.zone && onSlot(at, schedule.slots, schedule.zone),
    })
  }

  const source: ImportDoorRawSource = {
    format: 'raw',
    mapping: {
      version: MAPPING_VERSION,
      map(record) {
        if (record.kind === REJECTED_KIND) return mapRecord(record as never)
        if (record.kind === 'channel') return mapChannel(record)
        if (record.kind === 'schedule') return mapSchedule(record)
        if (record.kind === 'sent') return mapSent(record)
        if (record.kind === 'queued' || record.kind === 'buffer_draft') return mapPending(record)
        return { effects: [], rejection: `unknown record kind "${record.kind}"` }
      },
    },
    readRaw(upload) {
      const read = supportedOnly(parseBufferBundle(new TextDecoder('utf-8', { fatal: true }).decode(upload.bytes)))
      summary = read.summary
      // Slots travel as one schedule per channel; the channel's other rows follow it.
      const slotRows = new Map<string, ImportRow[]>()
      for (const row of read.rows) if (row.kind === 'slot') slotRows.set(String(row.payload.channel_key), [...slotRows.get(String(row.payload.channel_key)) ?? [], row])
      const records: ParsedRecord[] = []
      for (const row of read.rows) {
        if (row.kind === 'slot') continue
        records.push({ kind: row.kind, sourceId: row.sourceId, payload: row.payload })
        if (row.kind !== 'channel') continue
        const zone = (row.payload.time_zone as string | null) ?? null, rows = slotRows.get(row.sourceId) ?? []
        scheduleFor.set(row.sourceId, { zone, slots: slotsOf(rows) })
        if (zone && rows.length) records.push({ kind: 'schedule', sourceId: scheduleTarget(row.sourceId.slice('buffer-channel:'.length)), payload: { channel_key: row.sourceId, time_zone: zone, slots: slotsOf(rows) as unknown as Json } })
      }
      // Channels first, then their schedules and posts, then each refused row with its reasons.
      const ordered = [...records.filter(record => record.kind === 'channel'), ...records.filter(record => record.kind !== 'channel')]
      const refusedRows = toRecords({ rows: [], rejected: read.rejected })
      rejected = refusedRows.map(record => ({ kind: record.kind, sourceId: record.sourceId, reason: mapRecord(record).rejection! }))
      return [...ordered, ...refusedRows as ParsedRecord[]]
    },
  }
  return { source, summary: () => summary as Record<string, number> | null, rejected: () => rejected, existing: () => [...existing.values()], changes: (rows: PlanRow[]) => rowChanges(db, rows, mapped) }
}

const nameOf = (kind: BufferKind, value: Value): string | null =>
  kind === 'account' ? `${String(value.network)} ${String(value.handle)}` : kind === 'slots' ? String(value.account_id) : typeof value.text === 'string' ? value.text.slice(0, 80) : null

/** Each replaced or conflicting row with its fields before (as Stump holds it now) and after (as the file has it). */
async function rowChanges(db: D1Database, rows: PlanRow[], mapped: Map<string, Value>): Promise<RowChange[]> {
  const out: RowChange[] = []
  for (const row of rows) {
    if (!Object.hasOwn(SHAPES, row.kind)) continue
    const kind = row.kind as BufferKind, s = SHAPES[kind], incoming = mapped.get(`${kind}|${row.sourceId}`)
    const side = await db.prepare(`SELECT i.native_id,i.value_json,(${s.marker})=i.native_marker AS unchanged FROM stump_buffer_imports i JOIN ${s.table} n ON n.${s.key}=i.native_id WHERE i.target_id=?`)
      .bind(row.sourceId).first<{ native_id: string; value_json: string; unchanged: number }>()
    const imported = side ? JSON.parse(side.value_json) as Value : null
    const current = imported && !side!.unchanged ? { ...imported, ...await nativeNow(db, kind, side!.native_id) } : imported
    let fields: Array<{ field: string; current: unknown; incoming: unknown }> = [], cause: string | null = null
    if (incoming && current) {
      const difference = classify({ targetKind: kind, targetId: row.sourceId, value: incoming as JsonObject },
        { [targetKey(kind, row.sourceId)]: { current: current as JsonObject, imported: imported as JsonObject } })
      fields = difference.fields; cause = difference.cause ?? null
    }
    out.push({ kind, source_id: row.sourceId, id: imported ? nativeOf(kind, imported) : incoming ? nativeOf(kind, incoming) : '', name: nameOf(kind, incoming ?? imported ?? {}),
      conflict: row.conflict, cause, reason: row.reason, fields: fields.map(field => ({ field: field.field, before: field.current, after: field.incoming })) })
  }
  return out
}

/** The fields a person may have changed since the import, as Stump holds them now. */
async function nativeNow(db: D1Database, kind: BufferKind, id: string): Promise<Value> {
  const query = kind === 'account' ? 'SELECT handle,display_name FROM stump_accounts WHERE id=?'
    : kind === 'slots' ? 'SELECT time_zone,slots FROM stump_queue_slots WHERE account_id=?'
      : kind === 'ledger_entry' ? 'SELECT url,network_id,text FROM stump_ledger WHERE id=?'
        : 'SELECT state,text,scheduled_at,account_id FROM stump_items WHERE id=?'
  const row = await db.prepare(query).bind(id).first<Record<string, Json>>()
  if (!row) return {}
  return kind === 'slots' ? { time_zone: row.time_zone!, slots: JSON.parse(String(row.slots)) as Json } : row
}

/** Every record the undone import wrote that the kit retained, because a person edited it since or an edited record needs it. */
export interface Kept { kind: BufferKind; id: string; target_id: string; name: string | null; reason: 'edited' | 'in_use' }

export async function bufferKept(db: D1Database, jobId: string): Promise<Kept[]> {
  const rows = (await db.prepare('SELECT record_json FROM ik_d1_reversal_reports WHERE job_id=? ORDER BY position').bind(jobId).all<{ record_json: string }>()).results
  const kept: Kept[] = []
  for (const record of rows.map(row => JSON.parse(row.record_json) as { disposition: string; reason: string; targetKind?: string; targetId?: string })) {
    if (record.disposition !== 'retained' || typeof record.targetId !== 'string' || !Object.hasOwn(SHAPES, record.targetKind ?? '')) continue
    const kind = record.targetKind as BufferKind
    const side = await db.prepare('SELECT native_id,value_json FROM stump_buffer_imports WHERE target_id=?').bind(record.targetId).first<{ native_id: string; value_json: string }>()
    if (!side) continue
    const still = await db.prepare(`SELECT 1 FROM ${SHAPES[kind].table} WHERE ${SHAPES[kind].key}=?`).bind(side.native_id).first()
    if (!still) continue
    kept.push({ kind, id: side.native_id, target_id: record.targetId, name: nameOf(kind, JSON.parse(side.value_json) as Value), reason: record.reason === 'edited' ? 'edited' : 'in_use' })
  }
  return kept
}

/** Releases every record a finished Undo kept: Stump's own from then on, met by a later import as already in Stump. */
export async function releaseBufferKept(db: D1Database, kept: Kept[]): Promise<void> {
  if (kept.length) await db.batch(kept.map(item => db.prepare('DELETE FROM stump_buffer_imports WHERE target_id=?').bind(item.target_id)))
}

/**
 * Runs the draft check on every imported item still waiting for it, now that
 * its account exists, and stores the result in the item's flags (the check
 * every created item gets). The import's own marker is untouched: a check is
 * not an edit.
 */
export async function checkImportedItems(db: D1Database, now: number): Promise<void> {
  const ids = (await db.prepare(`SELECT n.id FROM stump_items n JOIN stump_buffer_imports i ON i.kind='item' AND i.native_id=n.id
    WHERE EXISTS(SELECT 1 FROM json_each(n.flags) f WHERE json_extract(f.value,'$.code')='not_checked')`).all<{ id: string }>()).results.map(row => row.id)
  await recheckItems(db, ids, now)
}
