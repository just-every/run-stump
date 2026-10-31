// An erased journalist stays out of the venue list's door (STUMP-DATA-002). Base's
// door refuses an upload holding an erased record when it matches the record the
// erasure severed; a row the reader refused has no such record, so an upload of
// the same list would wait at the door with the person's name in it. When the door
// refuses a plan, Stump reads the upload once more: a name in it that an erasure
// keeps out (a keyed digest of the folded name, as erasure tombstones are kept)
// makes it answer source_erased, and the upload's bytes go.
import { foldName, parseCsv } from '../lib/imports/index.ts'
import { erasedAuthors } from './tombstones.ts'

/** The tombstone source a journalist's name is kept under. */
export const JOURNALIST_SOURCE = 'journalist'
const SEPARATORS = [' — ', ' – ', ' -- ', ' - ']
const MAX_NAMES = 5_000

/** The names a venue list can hold a person under: each heading's title after its id, or each CSV cell. */
function namesIn(namespace: string, text: string): string[] {
  const names = new Set<string>()
  if (namespace === 'venues-csv') {
    for (const row of parseCsv(text, 100_000).rows) for (const cell of row.cells) if (cell.trim()) names.add(cell)
  } else {
    for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
      const heading = /^#{2,5} +(.*)$/.exec(line)?.[1]?.trim()
      if (!heading) continue
      names.add(heading)
      for (const separator of SEPARATORS) { const at = heading.indexOf(separator); if (at >= 0) names.add(heading.slice(at + separator.length)) }
    }
  }
  return [...names].map(foldName).filter(Boolean).slice(0, MAX_NAMES)
}

/** The upload's text, from its chunks at the door, or null when it is not this namespace's or is gone. */
async function uploadText(db: D1Database, installation: string, namespace: string, uploadId: string): Promise<string | null> {
  const upload = await db.prepare('SELECT id FROM ik_door_uploads WHERE id=? AND installation_id=? AND namespace=?').bind(uploadId, installation, namespace).first<{ id: string }>()
  if (!upload) return null
  const chunks = (await db.prepare('SELECT base64 FROM ik_door_chunks WHERE upload_id=? ORDER BY ordinal').bind(uploadId).all<{ base64: string }>()).results
  if (!chunks.length) return null
  const parts = chunks.map(chunk => Uint8Array.from(atob(chunk.base64), char => char.charCodeAt(0)))
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  parts.reduce((at, part) => { bytes.set(part, at); return at + part.length }, 0)
  return new TextDecoder().decode(bytes)
}

/**
 * Whether a refused upload names a journalist an erasure keeps out; if so its
 * bytes and header go, as the door drops an upload holding an erased record.
 */
export async function dropUploadNamingErased(db: D1Database, installation: string, namespace: string, uploadId: string): Promise<boolean> {
  const text = await uploadText(db, installation, namespace, uploadId)
  if (text === null) return false
  let names: string[]
  // A list the reader cannot read at all keeps the door's own refusal.
  try { names = namesIn(namespace, text) } catch { return false }
  if (!(await erasedAuthors(db, JOURNALIST_SOURCE, names)).size) return false
  await db.batch([db.prepare('DELETE FROM ik_door_chunks WHERE upload_id=?').bind(uploadId), db.prepare('DELETE FROM ik_door_uploads WHERE id=?').bind(uploadId)])
  return true
}
