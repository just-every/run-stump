// The words the hand-off screens read: titles, due times, states, rules and refusals.
import { ActionError, explain } from '../../ui/api.ts'
import type { ChipTone } from '../../ui/kit.tsx'
import type { HandoffRecord } from '../model.ts'
import { limitWords } from '../../venues/ui/labels.ts'
import { dateIn, daysBetween, timeIn, workingZone } from '../../ui/zones.ts'

export type Handoff = HandoffRecord
type Rule = { value: unknown; source_url: string | null; read_at: string | null; sourced: boolean; detail?: string | null; thread_url?: string | null }

/**
 * Where in the venue it goes, in the venue's own words: its thread or channel ("weekly thread", "launch post"); else its
 * self-promotion thread when the venue's rule keeps promotion to one; else a post about the product ("post about Brightwell"),
 * so two hand-offs at one venue never read the same and none reads as a slot the venue keeps.
 */
export function placeOf(handoff: Handoff): { words: string; product: boolean } {
  const how = handoff.venue.how_to_post as Record<string, unknown>
  const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null
  const own = text(how.thread) ?? text(how.channel)
  if (own) return { words: own, product: false }
  if ((handoff.rules as Record<string, Rule | null>).self_promotion?.value === 'thread') return { words: 'self-promotion thread', product: false }
  return handoff.product_name ? { words: `post about ${handoff.product_name}`, product: true } : { words: handoff.thread_url ? 'thread' : 'post', product: false }
}
const cap = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)
export const rowTitle = (handoff: Handoff) => `${handoff.venue.name} · ${cap(placeOf(handoff).words)}`
export function briefTitle(handoff: Handoff): string {
  const place = placeOf(handoff)
  return place.product ? `${cap(place.words)} on ${handoff.venue.name}` : `Post in: ${handoff.venue.name} ${place.words.toLowerCase()}`
}

/**
 * When a hand-off is due or was done, in the days of the zone this person schedules in (zones.ts), never the computer's own:
 * "Due today · 4:00 PM PT", "Due tomorrow", "Due Thu" up to six days out, else "Due Nov 12"; a posted one "Posted today" or
 * "Posted Oct 27"; a skipped or expired one its date.
 */
export function shortWhen(handoff: Handoff, now = Date.now(), zone = workingZone()): string {
  const iso = handoff.state === 'posted' ? handoff.posted_at : handoff.state === 'skipped' || handoff.state === 'expired' ? handoff.updated_at : handoff.due_at
  if (!iso) return ''
  const days = daysBetween(Date.parse(iso), now, zone)
  const dated = dateIn(iso, zone, { month: 'short', day: 'numeric' })
  if (handoff.state === 'posted') return days === 0 ? 'Posted today' : `Posted ${dated}`
  if (!['open', 'join_first', 'held'].includes(handoff.state)) return dated
  if (days === 0) return `Due today · ${timeIn(iso, zone)}`
  if (days === 1) return 'Due tomorrow'
  if (days >= 2 && days <= 6) return `Due ${dateIn(iso, zone, { weekday: 'short' })}`
  return days < 0 ? `Was due ${dated}` : `Due ${dated}`
}
/** "Due Thu, Nov 5 · 4:00 PM PT", in the zone this person schedules in. */
export function dueLine(iso: string | null, zone = workingZone()): string {
  if (!iso) return ''
  return `Due ${dateIn(iso, zone, { weekday: 'short', month: 'short', day: 'numeric' })} · ${timeIn(iso, zone)}`
}
export const dayOf = (iso: string | null) => iso ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(iso)) : ''

/** What happens at a person's review date: the hand-off's lapse action. */
export const LAPSE_AT: Record<string, string> = { expire: 'Expires', reassign: 'Moves to the next member', next_slot: 'Moves to the next opening' }

export const STATE: Record<string, { label: string; tone: ChipTone; tick?: boolean }> = {
  open: { label: 'Open', tone: 'success' }, join_first: { label: 'Join first', tone: 'neutral' }, held: { label: 'Held', tone: 'held' },
  posted: { label: 'Posted', tone: 'success', tick: true }, skipped: { label: 'Skipped', tone: 'neutral' }, expired: { label: 'Expired', tone: 'neutral' },
}

/** Each rule a person reads before posting, in plain words, with its source. */
export function ruleLines(rules: Record<string, Rule | null>): Array<{ key: string; text: string; rule: Rule }> {
  const lines: Array<{ key: string; text: string; rule: Rule }> = []
  const add = (key: string, text: string | null) => { const rule = rules[key]; if (rule && text) lines.push({ key, text, rule }) }
  const posting = rules.posting?.value, ai = rules.ai_text?.value, promo = rules.self_promotion, links = rules.links?.value
  add('posting', posting === 'members_only' ? 'Members post' : posting ? 'The company account may post' : null)
  add('ai_text', ai === 'banned' ? 'No AI-written text' : ai === 'allowed_with_disclosure' ? 'AI text allowed with disclosure' : ai === 'allowed' ? 'AI text allowed' : null)
  add('self_promotion', !promo ? null : promo.value === 'thread' ? `Self-promotion only in ${promo.detail ?? 'its thread'}` : promo.value === 'day' ? `Self-promotion on ${promo.detail ?? 'one day'} only`
    : promo.value === 'ratio' ? `Self-promotion limited${promo.detail ? `: ${promo.detail}` : ''}` : promo.value === 'banned' ? 'No self-promotion' : 'Self-promotion allowed')
  add('links', links === 'banned' ? 'No links' : links === 'allowed' ? 'Links allowed' : null)
  const gates = rules.gates?.value as { karma?: number; account_age_days?: number; approval?: boolean; membership?: boolean } | undefined
  const needs = gates ? [gates.membership ? 'membership' : null, gates.karma !== undefined ? `${gates.karma} karma` : null,
    gates.account_age_days !== undefined ? `an account ${gates.account_age_days} days old` : null, gates.approval ? 'approval to join' : null].filter(Boolean) : []
  add('gates', needs.length ? `Needs ${needs.join(', ')}` : null)
  return lines
}

/** The venue's shared limit as the poster reads it: "One post a week, for the whole company". */
export const limitLine = (limit: { posts: number; per: string } | null) => limit ? `${limitWords(limit)}, for the whole company` : null

/** Plain words for the refusals a person meets on these screens, naming what the refusal names. */
export function say(error: unknown): string {
  if (!(error instanceof ActionError)) return explain(error)
  const f = error.fields as Record<string, unknown>
  const words: Record<string, string> = {
    link_not_on_venue: `That link is not on ${String(f.venue ?? 'this venue')}.`,
    author_mismatch: `That post is by ${String(f.author ?? 'someone else')}, not ${String(f.handle ?? 'you')}.`,
    post_not_found: `${String(f.network ?? 'The network')} has no post at that link.`,
    link_check_failed: String(f.reason ?? 'The link could not be checked. Try again.'),
    link_conflict: `This hand-off already has a link: ${String(f.recorded_url)}.`,
    own_words_required: 'Paste the words you posted.',
    attestation_required: 'Confirm the words are your own.',
    disclosure_required: f.field === 'draft_text' ? `Keep the disclosure: "${String(f.disclosure_line ?? '')}"` : String(f.reason ?? 'Say how you are connected in the post.'),
    handoff_not_open: String(f.reason ?? 'This hand-off is not open.'),
    rule_hold: String(f.reason ?? 'A venue rule holds it.'),
  }
  return words[error.code] ?? (typeof f.reason === 'string' ? f.reason : explain(error))
}
