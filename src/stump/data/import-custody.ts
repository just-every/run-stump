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

const textOf = (base64: string) => new TextDecoder().decode(Uint8Array.from(atob(base64), char => char.charCodeAt(0)))
/** A refused row's key: its id and the line it starts on in its file. */
const rowKey = (payload: Record<string, unknown>) => `${String(payload.id)}|${String(payload.line)}`

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Whether a refused row's lines refer to one of these list ids: a Markdown `venue_id:` line naming it, or a CSV
 * cell holding exactly it.
 */
function carriesListId(lines: string[], ids: Set<string>) {
  if (!ids.size) return false
  const alternatives = [...ids].map(escape).join('|')
  const markdown = new RegExp(`^\\s*-?\\s*venue_id\\s*:\\s*["'\`]?(?:${alternatives})["'\`]?\\s*$`, 'i')
  const cell = new RegExp(`(?:^|,)\\s*"?(?:${alternatives})"?\\s*(?:,|$)`)
  return lines.some(line => markdown.test(line) || cell.test(line))
}

/** Whether a refused row's own id is one of these list ids or an entry under one (`<id>-...`). */
const underListId = (id: string, ids: Set<string>) => [...ids].some(listId => id === listId || id.startsWith(`${listId}-`))

/**
 * The rows of the list's files that the reader refused and that hold the journalist. A refused row keeps only
 * its id and line, so each is read back in the file it came from: in a Markdown list that is the row's block,
 * from its heading to the next; in a CSV it is the row's line. A refused row holds her when that block names
 * her in full, and, once her venue's list ids are known (the id of each venue record of hers the list wrote,
 * and of each refused venue row naming her), when its own id is one of them or an entry under one, or its block
 * points at one by `venue_id`.
 */
async function refusedRowsHolding(context: D1ImportContext, name: string, holdsVenue: (record: SourceRecord) => boolean): Promise<Set<string>> {
  const db = context.storage.database as unknown as D1Database, full = fullNameMatcher(name), found = new Set<string>(), ids = new Set<string>()
  const jobs = (await db.prepare('SELECT * FROM ik_jobs WHERE destination=? ORDER BY id').bind(VENUE_DESTINATION).all<Record<string, unknown> & { id: string }>()).results
  const refused: Array<{ payload: Record<string, unknown>; block: string[] }> = []
  for (const raw of jobs) {
    const plan = (await loadPlans([raw], db, context.storage.targets.planCodec)).get(raw.id)
    if (!plan) continue
    const files = (await readOriginals(plan, raw.id, context)).flatMap(original => original.kind === 'artifact' && original.original.status === 'retained' ? [textOf(original.original.base64).replace(/\r\n?/g, '\n').split('\n')] : [])
    for (const entry of plan.entries) {
      const payload = (entry.source.payload ?? {}) as Record<string, unknown>
      if (entry.source.kind === 'venue' && holdsVenue(entry.source) && typeof payload.external_id === 'string' && payload.external_id) ids.add(payload.external_id)
      if (entry.source.kind !== REJECTED_KIND) continue
      const at = Number(payload.line), block: string[] = []
      if (Number.isSafeInteger(at) && at >= 1) {
        for (const lines of files) {
          const start = lines[at - 1] ?? ''
          const end = start.startsWith('#') ? lines.findIndex((line, index) => index >= at && /^#{2,3} /.test(line)) : at
          block.push(...lines.slice(at - 1, end < 0 ? lines.length : end))
        }
      }
      const naming = block.some(line => full.test(line)) || full.test(JSON.stringify(payload))
      if (naming) found.add(rowKey(payload))
      if (naming && payload.row_kind === 'venue' && typeof payload.id === 'string') ids.add(payload.id)
      refused.push({ payload, block })
    }
  }
  for (const { payload, block } of refused) {
    if (underListId(String(payload.id), ids) || carriesListId(block, ids)) found.add(rowKey(payload))
  }
  return found
}

/** Whether a venue record the list wrote is the journalist's: by its import target, or a journalist venue under their name. */
function holdsJournalistVenue(person: Journalist) {
  const targets = new Set(person.venueTargets), folded = foldName(person.name)
  return (record: SourceRecord) => {
    const payload = (record.payload ?? {}) as Record<string, unknown>
    return record.kind === 'venue' && (targets.has(record.sourceId) || (payload.kind === 'journalist' && typeof payload.name === 'string' && foldName(payload.name) === folded))
  }
}

/**
 * Which of the list's records hold the journalist: their venue, an entry aimed at that venue or naming them,
 * and a refused row that holds them (refusedRowsHolding). Matched on the decoded record, never logged.
 */
function holdsJournalist(person: Journalist, refused: Set<string>) {
  const full = fullNameMatcher(person.name), venue = holdsJournalistVenue(person), targets = new Set(person.venueTargets)
  return (record: SourceRecord) => {
    const payload = (record.payload ?? {}) as Record<string, unknown>
    if (record.kind === 'venue') return venue(record)
    if (record.kind === 'draft') return targets.has(String(payload.venue_key)) || full.test(JSON.stringify(payload))
    if (record.kind === REJECTED_KIND) return refused.has(rowKey(payload))
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
  const holds = holdsJournalist(person, await refusedRowsHolding(context, person.name, holdsJournalistVenue(person))), full = fullNameMatcher(person.name)
  // Portability's restore checkpoint: an archive older than this erasure is refused whole.
  const checkpoint: D1Sql[] = (await redactionStatements(ctx.db)).map(toD1Sql)
  return retireD1ImportCustody({
    target: { kind: 'venue', id: target ?? `venue:erased:${erasureId}` },
    related: { source: holds, original: bytes => full.test(new TextDecoder().decode(bytes)) },
  }, native, context, checkpoint)
}
