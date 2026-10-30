// What an Undo kept (STUMP-VENUE-004.5): every record the undone import wrote
// that the kit retained, because a person edited it since, or an edited record
// or something outside the import needs it. Once the Undo is done, a kept
// record is released from the import: it is Stump's own record from then on,
// so a later import of the same list meets it as already in the register
// (kept as it is, the list's entries attach) and never writes over it.
import { nativeId } from './source.ts'

const SIDES = {
  venue: { side: 'stump_venue_imports', table: 'stump_venues', name: 'name' },
  product: { side: 'stump_product_imports', table: 'stump_products', name: 'name' },
  item: { side: 'stump_item_imports', table: 'stump_items', name: 'substr(text,1,80)' },
} as const
type Kind = keyof typeof SIDES

export interface Kept { kind: Kind; id: string; target_id: string; name: string | null; reason: 'edited' | 'in_use' }

/** The kit's own record of what this job's Undo retained, in its order. */
async function retained(db: D1Database, jobId: string) {
  const rows = (await db.prepare('SELECT record_json FROM ik_d1_reversal_reports WHERE job_id=? ORDER BY position').bind(jobId).all<{ record_json: string }>()).results
  return rows.map(row => JSON.parse(row.record_json) as { disposition: string; reason: string; targetKind?: string; targetId?: string })
    .filter(d => d.disposition === 'retained' && typeof d.targetKind === 'string' && typeof d.targetId === 'string' && Object.hasOwn(SIDES, d.targetKind))
}

export async function keptAfterUndo(db: D1Database, jobId: string): Promise<Kept[]> {
  const kept: Kept[] = []
  for (const d of await retained(db, jobId)) {
    const kind = d.targetKind as Kind, s = SIDES[kind], id = nativeId(d.targetId!)
    const row = await db.prepare(`SELECT ${s.name} AS name FROM ${s.table} WHERE id=?`).bind(id).first<{ name: string | null }>()
    // Removed since by someone: nothing is kept.
    if (!row) continue
    kept.push({ kind, id, target_id: d.targetId!, name: row.name, reason: d.reason === 'edited' ? 'edited' : 'in_use' })
  }
  return kept
}

/** Releases every record a finished Undo kept from the import that wrote it. */
export async function releaseKept(db: D1Database, kept: Kept[]): Promise<void> {
  if (!kept.length) return
  await db.batch(kept.map(item => db.prepare(`DELETE FROM ${SIDES[item.kind].side} WHERE target_id=?`).bind(item.target_id)))
}
