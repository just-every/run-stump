// A journalist's erasure reaches what the venue-list import keeps (STUMP-DATA-002):
// the list's records of their venue and of the entries aimed at it or naming
// them, in every import job, and the uploaded file itself. Base import-kit's
// custody retirement erases those records and withdraws the files that hold them,
// in one D1 batch with Stump's own erasure, so nothing changes unless all of it does.
// The records are severed from the import (an Undo leaves the anonymised venue
// and pitches alone), a later upload of a list holding them is refused, and an
// archive taken before the erasure no longer restores over it.
import { toD1Sql } from '@runeditrun/rer/modules/erasure/fence'
import { redactionStatements } from '@runeditrun/rer/modules/portability/journal'
import { retireD1ImportCustody, type D1ImportContext, type D1Sql } from '../../modules/import-kit/src/d1/index.ts'
import { readOriginals } from '../../modules/import-kit/src/d1/originals.ts'
import { loadPlans } from '../../modules/import-kit/src/d1/plans.ts'
import type { SourceRecord } from '../../modules/import-kit/src/types.ts'
import type { ActionContext } from '../actions/types.ts'
import { foldName, REJECTED_KIND } from '../lib/imports/index.ts'
import { fullNameMatcher } from './anonymise.ts'
import { VENUE_DESTINATION } from '../venues/import/source.ts'
import { venueListTargets } from '../venues/import/targets.ts'

/** The import-side copies Stump keeps of a venue or a pitch the list wrote. */
export async function importedVenues(db: D1Database, venues: string[]): Promise<Array<{ venue_id: string; target_id: string }>> {
  return venues.length ? (await db.prepare(`SELECT venue_id,target_id FROM stump_venue_imports WHERE venue_id IN (${venues.map(() => '?').join(',')}) ORDER BY venue_id`).bind(...venues)
    .all<{ venue_id: string; target_id: string }>()).results : []
}

/** Every table that names a venue by its id. */
const VENUE_REFERENCES = ['stump_items', 'stump_handoffs', 'stump_ledger', 'stump_venue_products', 'stump_venue_members', 'stump_venue_applications', 'stump_venue_history']

/**
 * A venue the import wrote keeps the id the import gave it; once erased it takes
 * a new one, with every reference to it, so the import's target for it is gone
 * and the import can never write it again.
 */
export function rekeyVenue(from: string): D1Sql[] {
  const to = `ven_${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`
  return [{ sql: 'UPDATE stump_venues SET id=? WHERE id=?', params: [to, from] },
    ...VENUE_REFERENCES.map(table => ({ sql: `UPDATE ${table} SET venue_id=? WHERE venue_id=?`, params: [to, from] }))]
}

/** Whether the venue-list import holds anything at all: a job, or an upload waiting at the door. */
export async function holdsImports(db: D1Database): Promise<boolean> {
  return !!await db.prepare('SELECT 1 FROM ik_jobs WHERE destination=? UNION ALL SELECT 1 FROM ik_door_scopes WHERE destination=? LIMIT 1').bind(VENUE_DESTINATION, VENUE_DESTINATION).first()
}

export interface Journalist { name: string; venueTargets: string[] }

const bytesOf = (base64: string) => Uint8Array.from(atob(base64), char => char.charCodeAt(0))
const textOf = (base64: string) => new TextDecoder().decode(bytesOf(base64))
/** A refused row's key: its id and the line it starts on in its file. */
const rowKey = (payload: Record<string, unknown>) => `${String(payload.id)}|${String(payload.line)}`

/**
 * The rows of the list's files that the reader refused and that name the
 * journalist where the file has them: a refused row keeps only its id and line,
 * so each is read back in the file it came from. In a Markdown list that is the
 * row's block, from its heading to the next; in a CSV it is the row's line.
 */
async function refusedRowsNaming(context: D1ImportContext, name: string): Promise<Set<string>> {
  const db = context.storage.database as unknown as D1Database, full = fullNameMatcher(name), found = new Set<string>()
  const jobs = (await db.prepare('SELECT * FROM ik_jobs WHERE destination=? ORDER BY id').bind(VENUE_DESTINATION).all<Record<string, unknown> & { id: string }>()).results
  for (const raw of jobs) {
    const plan = (await loadPlans([raw], db, context.storage.targets.planCodec)).get(raw.id)
    if (!plan) continue
    const files = (await readOriginals(plan, raw.id, context)).flatMap(original => original.kind === 'artifact' && original.original.status === 'retained' ? [textOf(original.original.base64).replace(/\r\n?/g, '\n').split('\n')] : [])
    if (!files.some(lines => lines.some(line => full.test(line)))) continue
    for (const entry of plan.entries) {
      if (entry.source.kind !== REJECTED_KIND) continue
      const payload = (entry.source.payload ?? {}) as Record<string, unknown>, at = Number(payload.line)
      if (!Number.isSafeInteger(at) || at < 1) continue
      for (const lines of files) {
        const start = lines[at - 1] ?? ''
        const end = start.startsWith('#') ? lines.findIndex((line, index) => index >= at && /^#{2,3} /.test(line)) : at
        if (lines.slice(at - 1, end < 0 ? lines.length : end).some(line => full.test(line))) found.add(rowKey(payload))
      }
    }
  }
  return found
}

/** Uploads of the list waiting at the door that hold the journalist's name: the erasure drops them, as Base's door drops a refused upload. */
async function pendingUploadsNaming(db: D1Database, name: string): Promise<D1Sql[]> {
  const full = fullNameMatcher(name), statements: D1Sql[] = []
  const uploads = (await db.prepare(`SELECT u.id FROM ik_door_uploads u JOIN ik_door_scopes s ON s.installation_id=u.installation_id AND s.namespace=u.namespace
    WHERE s.destination=? ORDER BY u.id`).bind(VENUE_DESTINATION).all<{ id: string }>()).results
  for (const upload of uploads) {
    const chunks = (await db.prepare('SELECT base64 FROM ik_door_chunks WHERE upload_id=? ORDER BY ordinal').bind(upload.id).all<{ base64: string }>()).results
    const parts = chunks.map(chunk => bytesOf(chunk.base64)), bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    parts.reduce((at, part) => { bytes.set(part, at); return at + part.length }, 0)
    if (!full.test(new TextDecoder().decode(bytes))) continue
    statements.push({ sql: 'DELETE FROM ik_door_chunks WHERE upload_id=?', params: [upload.id] }, { sql: 'DELETE FROM ik_door_uploads WHERE id=?', params: [upload.id] })
  }
  return statements
}

/**
 * Which of the list's records hold the journalist: their venue (by its import
 * target, or a journalist venue under their name), an entry aimed at that venue
 * or naming them, and a refused row naming them, in its own words or where its
 * file has it. Matched on the decoded record, never logged.
 */
function holdsJournalist(person: Journalist, refused: Set<string>) {
  const full = fullNameMatcher(person.name)
  const targets = new Set(person.venueTargets), folded = foldName(person.name)
  return (record: SourceRecord) => {
    const payload = (record.payload ?? {}) as Record<string, unknown>
    if (record.kind === 'venue') return targets.has(record.sourceId) || (payload.kind === 'journalist' && typeof payload.name === 'string' && foldName(payload.name) === folded)
    if (record.kind === 'draft') return targets.has(String(payload.venue_key)) || full.test(JSON.stringify(payload))
    if (record.kind === REJECTED_KIND) return full.test(JSON.stringify(payload)) || refused.has(rowKey(payload))
    return false
  }
}

/**
 * Runs Stump's erasure statements (`native`) in the import kit's custody batch.
 * The kit erases one target and binds what else it severs to it: the
 * journalist's venue as the import wrote it (`target`, which `native` re-keys),
 * or, with none, the erasure's own target, which no record of Stump's can share.
 * Authority is the acting person still being an active owner or admin, checked
 * before and after the batch.
 */
export async function eraseWithImportCustody(ctx: ActionContext, erasureId: string, person: Journalist, native: D1Sql[], target: string | null) {
  const context: D1ImportContext = {
    destination: VENUE_DESTINATION, namespace: 'erasure', mappingVersion: 'erasure',
    originalErasurePolicy: 'withdraw-affected-artifacts',
    storage: { database: ctx.db as never, targets: venueListTargets },
    authorization: {
      principalId: ctx.person.id,
      predicate: (_action, destination) => destination === VENUE_DESTINATION
        ? { sql: "EXISTS(SELECT 1 FROM stump_people WHERE id=? AND status='active' AND role IN ('owner','admin'))", params: [ctx.person.id] }
        : { sql: '0', params: [] },
    },
  }
  const holds = holdsJournalist(person, await refusedRowsNaming(context, person.name)), full = fullNameMatcher(person.name)
  // Portability's restore checkpoint: an archive older than this erasure is refused whole.
  const checkpoint: D1Sql[] = (await redactionStatements(ctx.db)).map(toD1Sql)
  return retireD1ImportCustody({
    target: { kind: 'venue', id: target ?? `venue:erased:${erasureId}` },
    related: { source: holds, original: bytes => full.test(new TextDecoder().decode(bytes)) },
  }, [...native, ...await pendingUploadsNaming(ctx.db, person.name)], context, checkpoint)
}
