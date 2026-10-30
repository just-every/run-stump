import { checkDraft, loadBrand } from '../drafting/check.ts'
import { readPerson } from '../people/store.ts'

/**
 * Runs the draft check again on items whose text changed outside a person's
 * save (an import, an erasure) and stores the result in their flags, so no
 * flag carries text the item no longer holds. The item's revision and time
 * are untouched: a check is not an edit.
 */
export async function recheckItems(db: D1Database, ids: string[], now: number): Promise<void> {
  if (!ids.length) return
  const rows = (await db.prepare(`SELECT id,format,network,account_id,venue_id,person_id,product_id,master_id,text,parts FROM stump_items WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids)
    .all<{ id: string; format: string; network: string | null; account_id: string | null; venue_id: string | null; person_id: string; product_id: string | null; master_id: string | null; text: string | null; parts: string | null }>()).results
  const brand = await loadBrand(db), statements: D1PreparedStatement[] = []
  for (const row of rows) {
    const check = await checkDraft(db, brand, { ...row, parts: row.parts ? JSON.parse(row.parts) as string[] : null }, await readPerson(db, row.person_id), now)
    statements.push(db.prepare('UPDATE stump_items SET flags=?,claims_used=? WHERE id=?').bind(JSON.stringify(check.flags), JSON.stringify(check.claims_used), row.id))
  }
  if (statements.length) await db.batch(statements)
}
