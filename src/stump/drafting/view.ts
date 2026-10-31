import { pageName } from '../ui/kit.tsx'
// The drafting records as the screens read them from the person door.
export interface Flag { code: string; blocking: boolean; network?: string; count?: number; limit?: number; text?: string; claim_id?: string; expected?: string[]; reason?: string; rule?: string; matches?: Array<{ id: string; kind: string }>; [fact: string]: unknown }
export interface Count { network: string; count: number; limit: number; unit: string; over: boolean; fits: boolean }
export interface Account { id: string; network: string; handle: string; display_name: string | null; owner_kind: 'person' | 'company'; owner_person_id: string | null; state: string }
export interface Master { id: string; person_id: string; text: string; account_ids: string[]; sources: Array<{ url: string; title: string | null }>; revision: number }
export interface Variant { item_id: string; network: string | null; account_id: string | null; handle: string | null; account_name: string | null; text: string; count: Count | null; flags: Flag[]; state: string; revision: number; differs_from_master: boolean }
export interface MasterPreview { master: Master; items: Variant[]; total: number }
export interface ClaimFinding { status: 'matched' | 'unmatched' | 'banned' | 'stale' | 'number_mismatch'; claim_id?: string; text: string; expected?: string[]; found?: string[]; reason?: string; review_on?: string }
export interface Check { passed: boolean; claims: ClaimFinding[]; flags: Flag[]; disclosure: { required: boolean; status: string }; duplicates: Array<{ id: string; kind: string }> }
export interface Product { id: string; name: string; other_names: string[]; description: string | null; audience: string | null; urls: string[]; tone: string; competitors: string[]; words_avoid: string[]; words_use: string[] }
export interface ClaimView { id: string; product_id: string | null; kind: 'allowed' | 'banned' | 'comparative'; text: string; proof: unknown; owner_id: string; review_on: string | null; reason: string | null; competitor: string | null; source_url: string | null; source_date: string | null; stale: boolean }
export interface VoiceView { id: string; person_id: string; name: string; do: string[]; dont: string[]; state: string; sample_count: number }

/** A claim's proof in a few words: its own label, else the page it lives on ("changelog"). */
export function proofLabel(proof: unknown): string {
  if (typeof proof === 'string') return /^https?:\/\//.test(proof) ? pageName(proof) : proof
  if (!proof || typeof proof !== 'object') return ''
  const { text, document, url } = proof as Record<string, unknown>
  return String(text ?? document ?? (typeof url === 'string' ? pageName(url) : ''))
}

/** Network names are text, written the way each network writes its own. */
export const NETWORK_NAMES: Record<string, string> = { x: 'X', bluesky: 'Bluesky', mastodon: 'Mastodon', linkedin: 'LinkedIn', threads: 'Threads' }
export const networkName = (network: string | null | undefined) => network ? NETWORK_NAMES[network] ?? network : 'No network'
export const accountLabel = (account: Pick<Account, 'network' | 'handle' | 'display_name'>) =>
  `${account.network === 'linkedin' ? account.display_name ?? account.handle : account.handle.startsWith('@') ? account.handle : `@${account.handle}`} · ${networkName(account.network)}`

/** A short quote, cut at a word, never inside one. */
const quote = (text: string) => {
  if (text.length <= 40) return `'${text}'`
  const head = text.slice(0, 39), space = head.lastIndexOf(' ')
  return `'${(space > 16 ? head.slice(0, space) : head).replace(/[\s,.;:]+$/, '')}…'`
}
/** The claim itself inside its sentence: the number the draft used and the word it measures ("50% faster"). */
export function claimSpan(sentence: string, found: string[] | undefined): string | null {
  for (const number of found ?? []) {
    const at = sentence.indexOf(number)
    if (at < 0) continue
    // The word it measures ("50% faster"), never a little word after it ("$12 a month" is the $12).
    const after = /^[\s-]*([\p{L}]+)/u.exec(sentence.slice(at + number.length))
    return after && !LITTLE_WORDS.has(after[1]!.toLowerCase()) ? `${number} ${after[1]}` : number
  }
  return null
}
const LITTLE_WORDS = new Set(['a', 'an', 'the', 'per', 'each', 'every', 'for', 'of', 'in', 'on', 'at', 'to', 'by', 'and', 'or', 'with', 'from'])
const NUMBER = /[$€£]?\d+(?:[.,]\d+)*\s?(?:%|x\b|×)?/gi
const plainNumber = (value: string) => value.replace(/\s+/g, '').toLowerCase()
/** A number's kind, so "50%" is weighed against "30%" and never against a version like "3.2". */
const unitOf = (value: string) => /%$/.test(value.trim()) ? '%' : /(x|×)$/i.test(value.trim()) ? 'x' : /^[$€£]/.test(value.trim()) ? '$' : ''
/**
 * The claim a mismatch flag is about, as the person wrote it ("50% faster"), not
 * the whole sentence. The check's own findings name the numbers the draft used;
 * without them (a stored flag), it is the first number the proof does not back.
 */
export function spanOf(flag: Flag, claims: ClaimFinding[] = []): string | null {
  if (flag.code !== 'claim_number_mismatch') return null
  const sentence = String(flag.text ?? '')
  const found = claims.find(claim => claim.status === 'number_mismatch' && claim.text === sentence)?.found
  if (found?.length) return claimSpan(sentence, found)
  const expected = new Set((flag.expected ?? []).map(plainNumber)), units = new Set((flag.expected ?? []).map(unitOf))
  const numbers = (sentence.match(NUMBER) ?? []).map(number => number.trim())
  const kin = numbers.filter(number => units.has(unitOf(number)))
  const used = (kin.length ? kin : numbers).filter(number => !expected.has(plainNumber(number)))
  return claimSpan(sentence, used.length ? used : kin.length ? kin : numbers)
}

/** Where a flag's claim sits in a variant's text, to mark it: [start, end), or null when the text no longer holds it. */
export function spanAt(text: string, flag: Flag, claims: ClaimFinding[] = []): [number, number] | null {
  const span = spanOf(flag, claims)
  if (!span) return null
  const from = typeof flag.start === 'number' ? Math.max(0, flag.start - 1) : 0
  const at = text.indexOf(span, from) >= 0 ? text.indexOf(span, from) : text.indexOf(span)
  return at < 0 ? null : [at, at + span.length]
}

/**
 * Where a claim flag's words sit in a variant's text, to select them for fixing: a mismatch's number and the word it measures
 * ("50% faster", or "$12" alone in "$12 a month"), any other claim flag its whole sentence (the banned claim, the unproven statement). Null when the text no longer holds it.
 */
export function claimRange(text: string, flag: Flag, claims: ClaimFinding[] = []): [number, number] | null {
  if (flag.code === 'claim_number_mismatch') return spanAt(text, flag, claims)
  const words = typeof flag.text === 'string' ? flag.text : ''
  if (!flag.code.startsWith('claim_') || !words) return null
  const near = typeof flag.start === 'number' ? text.indexOf(words, Math.max(0, flag.start - 1)) : -1
  const at = near >= 0 ? near : text.indexOf(words)
  return at < 0 ? null : [at, at + words.length]
}

/** One line for a flag, in the person's words; `span` names the claim itself where the check found it. */
export function flagLine(flag: Flag, span?: string | null): string {
  switch (flag.code) {
    case 'claim_number_mismatch': return `${quote(span ?? String(flag.text ?? ''))} differs from proof${flag.expected?.length ? ` (${flag.expected.join(', ')})` : ''}`
    case 'claim_banned': return `${quote(String(flag.text ?? ''))} is a banned claim${flag.reason ? `: ${flag.reason}` : ''}`
    case 'claim_unmatched': return `${quote(String(flag.text ?? ''))} has no proof on record`
    case 'claim_stale': return `${quote(String(flag.text ?? ''))} uses a claim past its review date`
    case 'avoid_word': return `${quote(String(flag.text ?? ''))} is on the avoid list`
    case 'over_limit': return `${networkName(flag.network)} variant · ${flag.count}\u00a0/\u00a0${flag.limit}`
    case 'disclosure_missing': return 'Disclosure needed before it goes out'
    case 'disclosure_below_cut': return 'Move the disclosure above "see more"'
    case 'near_duplicate': return `Nearly repeats ${flag.matches?.length ?? 1} earlier ${flag.matches?.length === 1 ? 'post' : 'posts'}`
    case 'vote_request': return `${quote(String(flag.text ?? ''))} asks for votes`
    case 'alt_text_missing': return `${String(flag.name ?? 'An image')} needs alt text`
    case 'venue_rule': return String(flag.reason ?? `Held by the venue's ${String(flag.rule ?? '')} rule`)
    default: return flag.code.replace(/_/g, ' ')
  }
}
