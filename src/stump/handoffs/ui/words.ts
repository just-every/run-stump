// The words the hand-off screens read: titles, due times, states, rules and refusals.
import { ActionError, explain } from '../../ui/api.ts'
import type { ChipTone } from '../../ui/kit.tsx'
import type { HandoffRecord } from '../model.ts'

export type Handoff = HandoffRecord
type Rule = { value: unknown; source_url: string | null; read_at: string | null; sourced: boolean; detail?: string | null; thread_url?: string | null }

/** Where in the venue it goes: its thread, its channel, else a post. */
export function placeOf(handoff: Handoff): string {
  const how = handoff.venue.how_to_post as Record<string, unknown>
  const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null
  return text(how.thread) ?? (handoff.thread_url ? 'Thread' : text(how.channel) ?? 'Post')
}
const cap = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)
export const rowTitle = (handoff: Handoff) => `${handoff.venue.name} · ${cap(placeOf(handoff))}`
export const briefTitle = (handoff: Handoff) => `Post in: ${handoff.venue.name} ${placeOf(handoff).toLowerCase()}`

const DAY = 86_400_000
/** "Due Thu" within the week, "Due Nov 12" after; a done hand-off shows its date. */
export function shortWhen(handoff: Handoff, now = Date.now()): string {
  const at = handoff.state === 'posted' ? handoff.posted_at : handoff.state === 'skipped' || handoff.state === 'expired' ? handoff.updated_at : handoff.due_at
  if (!at) return ''
  const date = new Date(at), soon = date.getTime() - now < 6 * DAY && date.getTime() > now - DAY
  const day = new Intl.DateTimeFormat(undefined, soon ? { weekday: 'short' } : { month: 'short', day: 'numeric' }).format(date)
  return ['open', 'join_first', 'held'].includes(handoff.state) ? `Due ${day}` : day
}
/** "Due Thu, Nov 5 · 4:00 PM MT". */
export function dueLine(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  return `Due ${new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(date)} · ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'shortGeneric' }).format(date)}`
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
  const gates = rules.gates?.value as { karma?: number; account_age_days?: number; approval?: boolean } | undefined
  add('gates', gates ? [gates.karma !== undefined ? `${gates.karma} karma` : null, gates.account_age_days !== undefined ? `an account ${gates.account_age_days} days old` : null, gates.approval ? 'approval to join' : null].filter(Boolean).join(', ').replace(/^/, 'Needs ') : null)
  return lines
}

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
