// What a hand-off brief carries besides the draft: the facts with their proof,
// the disclosure line for the person's connection, talking points where no text
// is generated, and when the venue next takes a post (STUMP-HANDOFF-001, D-2, D-8).
import { claimsForRequest } from '../lib/claims/index.ts'
import { libClaim, today } from '../drafting/records.ts'
import type { Brand } from '../drafting/check.ts'
import type { StumpPerson } from '../people/store.ts'
import { usage } from '../venues/limits.ts'
import { rulesOf, type VenueRow } from '../venues/model.ts'
import type { Fact } from './model.ts'

/** The product's facts a person may state: its current claims with proof, as the drafting request sends them, with that proof. */
export function factsFor(brand: Brand, productId: string, now: number, usedFirst: readonly string[] = []): Fact[] {
  const sent = claimsForRequest(brand.claims.map(libClaim), { product_id: productId, today: today(now) })
  const ids = [...sent.allowed, ...sent.comparative].map(claim => claim.id)
  const order = [...usedFirst.filter(id => ids.includes(id)), ...ids.filter(id => !usedFirst.includes(id))]
  return order.map(id => brand.claims.find(claim => claim.id === id)!).map(claim => ({ claim_id: claim.id, text: claim.text, proof: claim.proof }))
}

/**
 * A founder or employee may post generated text about the company; anyone else
 * posts their own words (D-8). The owner who set Stump up speaks for the company
 * until their connection is recorded. The same reading as the drafting module's.
 */
export const outsideVoice = (person: Pick<StumpPerson, 'connection' | 'role'>) => person.connection ? !['founder', 'employee'].includes(person.connection) : person.role !== 'owner'

const LINES: Record<string, (company: string) => string> = {
  founder: company => `I'm a founder of ${company}.`,
  employee: company => `I work at ${company}.`,
  contractor: company => `I work on ${company} as a contractor.`,
  investor: company => `Disclosure: I'm an investor in ${company}.`,
  advisor: company => `Disclosure: I advise ${company}.`,
  friend: company => `Disclosure: I'm a friend of the ${company} team.`,
  family: company => `Disclosure: someone in my family works at ${company}.`,
}

/**
 * The disclosure the person makes there (D-2): the venue's own line where it
 * asks for one, else one of the person's disclosure lines, else the plain line
 * for their connection, naming the company.
 */
export function disclosureFor(venue: VenueRow, person: Pick<StumpPerson, 'connection' | 'disclosure_lines'>, brand: Brand, productName: string): string {
  const venueLine = rulesOf(venue).disclosure_line?.value
  if (typeof venueLine === 'string' && venueLine.trim()) return venueLine.trim()
  if (person.disclosure_lines[0]?.trim()) return person.disclosure_lines[0].trim()
  const company = brand.company_names[0] ?? productName
  return (LINES[person.connection ?? ''] ?? (name => `I work on ${name}.`))(company)
}

/** Talking points for a person writing their own words: what the product does, the facts, what readers get, and how to say the connection. */
export function talkingPoints(venue: VenueRow, product: { name: string; description: string | null }, facts: Fact[], disclosure: string): string[] {
  return [
    product.description ? `What ${product.name} does: ${product.description}` : null,
    ...facts.map(fact => fact.text),
    venue.reader_value ? `What readers get: ${venue.reader_value}` : null,
    `Say how you are connected: "${disclosure}"`,
  ].filter((point): point is string => !!point)
}

const DAY = 86_400_000
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/** The weekday a venue keeps its promotion thread on, from how to post there or its self-promotion rule. */
export function threadDay(venue: VenueRow): number | null {
  const howTo = JSON.parse(venue.how_to_post) as Record<string, unknown>, rule = rulesOf(venue).self_promotion
  if (!rule || !['thread', 'day'].includes(String(rule.value))) return null
  const said = [howTo.day, howTo.thread, rule.detail].filter(value => typeof value === 'string').join(' ').toLowerCase()
  const found = WEEKDAYS.findIndex(day => new RegExp(`\\b${day}s?\\b|\\b${day.slice(0, 3)}\\b`).test(said))
  return found === -1 ? null : found
}

/** The start of the first UTC day on that weekday at or after `at`, or `at` itself on that day. */
function onWeekday(at: number, weekday: number): number {
  const date = new Date(at), ahead = (weekday - date.getUTCDay() + 7) % 7
  return ahead === 0 ? at : Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) + ahead * DAY
}

/**
 * When the venue next takes a post at or after `after`: its thread day, in a
 * period of its shared limit with room (this hand-off's own place aside). Null
 * when the venue has neither, so any time is open.
 */
export async function nextOpening(db: D1Database, venue: VenueRow, after: number, self: string | null = null): Promise<number | null> {
  const day = threadDay(venue)
  let at = after
  for (let step = 0; step < 120; step++) {
    if (day !== null) at = onWeekday(at, day)
    const use = await usage(db, venue, at)
    if (!use.limit) return day === null ? null : at
    const own = use.counted.some(entry => entry.kind === 'handoff' && entry.id === self) ? 1 : 0
    if (use.used - own < use.limit.posts) return at
    at = Date.parse(use.window!.end)
  }
  return null
}
