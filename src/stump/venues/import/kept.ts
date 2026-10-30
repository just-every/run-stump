// What an Undo kept (STUMP-VENUE-004.5): every record the undone import wrote
// that is still there as the import wrote it, because a person edited it
// since or something outside the import now uses it.
import { nativeId } from './source.ts'

const SIDES = {
  venue: { side: 'stump_venue_imports', key: 'venue_id', table: 'stump_venues', name: 'n.name', marker: "n.revision||''", written: "i.native_revision||''" },
  product: { side: 'stump_product_imports', key: 'product_id', table: 'stump_products', name: 'n.name', marker: "n.revision||':'||n.updated_at", written: "i.native_revision||':'||i.native_updated_at" },
  item: { side: 'stump_item_imports', key: 'item_id', table: 'stump_items', name: 'substr(n.text,1,80)', marker: "n.revision||':'||n.updated_at", written: "i.native_revision||':'||i.native_updated_at" },
} as const

export interface Kept { kind: keyof typeof SIDES; id: string; target_id: string; name: string | null; reason: 'edited' | 'in_use' }

export async function keptAfterUndo(db: D1Database, jobId: string): Promise<Kept[]> {
  const effects = (await db.prepare("SELECT target_kind,target_id,json_extract(record_json,'$.appliedRevision') AS applied FROM ik_provenance WHERE job_id=? ORDER BY ordinal,effect_ordinal")
    .bind(jobId).all<{ target_kind: string; target_id: string; applied: string | null }>()).results
  const kept: Kept[] = []
  for (const effect of effects) {
    if (!Object.hasOwn(SIDES, effect.target_kind)) continue
    const kind = effect.target_kind as keyof typeof SIDES, s = SIDES[kind]
    const row = await db.prepare(`SELECT ${s.name} AS name,i.kit_revision,(${s.marker})=(${s.written}) AS unchanged FROM ${s.side} i JOIN ${s.table} n ON n.id=i.${s.key} WHERE i.target_id=?`)
      .bind(effect.target_id).first<{ name: string | null; kit_revision: string; unchanged: number }>()
    // Restored to an earlier import's value, or removed: not kept by this Undo.
    if (!row || (effect.applied !== null && row.kit_revision !== effect.applied)) continue
    kept.push({ kind, id: nativeId(effect.target_id), target_id: effect.target_id, name: row.name, reason: row.unchanged ? 'in_use' : 'edited' })
  }
  return kept
}
