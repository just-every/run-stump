// The disclosure a hand-off's text keeps (D-2, STUMP-HANDOFF-001.4): read by the
// drafting module's check for the hand-off's person and product, with the line
// the brief gave them counting as one of that person's disclosure lines. Text
// that names the product without it is not saved, handed off or recorded posted.
import { refuse } from '../actions/refusals.ts'
import { brandTerms, checkDraft, loadBrand } from '../drafting/check.ts'
import { detectDisclosure } from '../lib/claims/index.ts'
import { readPerson } from '../people/store.ts'
import { rulesOf, type VenueRow } from '../venues/model.ts'
import type { HandoffRow } from './model.ts'

type Spoken = Pick<HandoffRow, 'id' | 'item_id' | 'venue_id' | 'person_id' | 'product_id' | 'disclosure_line'>

/** The venue's own disclosure line, where its rules ask for one. */
const venueLine = (venue: VenueRow) => { const value = rulesOf(venue).disclosure_line?.value; return typeof value === 'string' && value.trim() ? value.trim() : null }

/** The drafting module's disclosure flag on this text for the hand-off's person, if the text needs a disclosure it does not make. */
async function undisclosed(db: D1Database, row: Spoken, text: string, network: string | null, now: number) {
  const brand = await loadBrand(db), found = await readPerson(db, row.person_id)
  const person = found ? { ...found, disclosure_lines: [...found.disclosure_lines, ...(row.disclosure_line ? [row.disclosure_line] : [])] } : null
  const check = await checkDraft(db, brand, { ...(row.item_id ? { id: row.item_id } : {}), format: 'post', network, account_id: null, venue_id: row.venue_id, person_id: row.person_id,
    product_id: row.product_id, master_id: null, text, parts: null }, person, now)
  return { brand, person, flag: check.flags.find(flag => flag.code === 'disclosure_missing' || flag.code === 'disclosure_below_cut') ?? null }
}

const refuseDisclosure = (row: Spoken, field: string, flag: string, reason: string): never =>
  refuse('disclosure_required', { handoff_id: row.id, rule: 'D-2', field, flag, disclosure_line: row.disclosure_line, reason })

/**
 * Text being recorded as posted (the person's own words, or the text read back
 * from the network) discloses the connection where it names the company or a
 * product; otherwise the record is refused, naming D-2.
 */
export async function recordedDisclosure(db: D1Database, row: Spoken, text: string, field: string, network: string | null, now: number) {
  const { flag } = await undisclosed(db, row, text, network, now)
  if (flag) refuseDisclosure(row, field, flag.code, flag.code === 'disclosure_below_cut'
    ? 'The disclosure is below the fold there; it goes before the text a reader sees first.'
    : `The post names the product without saying how you are connected. Add "${row.disclosure_line ?? 'your disclosure'}" to the post, then record it.`)
}

/**
 * A draft edit keeps the disclosure (STUMP-HANDOFF-001.4): text that names the
 * product discloses the connection, and an edit cannot drop the hand-off's line
 * (or the venue's own line) unless the new text still makes the connection plain
 * in its own words.
 */
export async function disclosureKept(db: D1Database, row: Spoken, venue: VenueRow, current: string, text: string, now: number) {
  const { brand, person, flag } = await undisclosed(db, row, text, null, now)
  if (flag) refuseDisclosure(row, 'draft_text', flag.code, 'A hand-off that names the product keeps its disclosure.')
  const lines = [row.disclosure_line, venueLine(venue)].filter((line): line is string => !!line)
  const had = !!venueLine(venue) || lines.some(line => current.includes(line))
  if (!had || lines.some(line => text.includes(line))) return
  if (!detectDisclosure(text, { lines: [...lines, ...(person?.disclosure_lines ?? [])], terms: brandTerms(brand) }).disclosed) {
    refuseDisclosure(row, 'draft_text', 'disclosure_removed', 'The edit removes the hand-off\'s disclosure line. Keep it in the draft.')
  }
}
