// The drafting records as the screens read them from the person door.
export interface Flag { code: string; blocking: boolean; network?: string; count?: number; limit?: number; text?: string; claim_id?: string; expected?: string[]; reason?: string; rule?: string; matches?: Array<{ id: string; kind: string }>; [fact: string]: unknown }
export interface Count { network: string; count: number; limit: number; unit: string; over: boolean; fits: boolean }
export interface Account { id: string; network: string; handle: string; display_name: string | null; owner_kind: 'person' | 'company'; owner_person_id: string | null; state: string }
export interface Master { id: string; person_id: string; text: string; account_ids: string[]; sources: Array<{ url: string; title: string | null }>; revision: number }
export interface Variant { item_id: string; network: string | null; account_id: string | null; handle: string | null; account_name: string | null; text: string; count: Count | null; flags: Flag[]; state: string; revision: number; differs_from_master: boolean }
export interface MasterPreview { master: Master; items: Variant[]; total: number }
export interface ClaimFinding { status: 'matched' | 'unmatched' | 'banned' | 'stale' | 'number_mismatch'; claim_id?: string; text: string; expected?: string[]; found?: string[]; reason?: string; review_on?: string }
export interface Check { passed: boolean; claims: ClaimFinding[]; flags: Flag[]; disclosure: { required: boolean; status: string }; duplicates: Array<{ id: string; kind: string }> }
export interface Product { id: string; name: string; other_names: string[]; description: string | null; tone: string; competitors: string[]; words_avoid: string[]; words_use: string[] }
export interface ClaimView { id: string; product_id: string | null; kind: 'allowed' | 'banned' | 'comparative'; text: string; proof: unknown; owner_id: string; review_on: string | null; reason: string | null; competitor: string | null; source_url: string | null; source_date: string | null; stale: boolean }
export interface VoiceView { id: string; person_id: string; name: string; do: string[]; dont: string[]; state: string; sample_count: number }

/** A claim's proof in a few words: its own label, else where it lives. */
export function proofLabel(proof: unknown): string {
  if (typeof proof === 'string') return proof.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
  if (!proof || typeof proof !== 'object') return ''
  const { text, document, url } = proof as Record<string, unknown>
  return String(text ?? document ?? (typeof url === 'string' ? url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : ''))
}

/** Network names are text, written the way each network writes its own. */
export const NETWORK_NAMES: Record<string, string> = { x: 'X', bluesky: 'Bluesky', mastodon: 'Mastodon', linkedin: 'LinkedIn', threads: 'Threads' }
export const networkName = (network: string | null | undefined) => network ? NETWORK_NAMES[network] ?? network : 'No network'
export const accountLabel = (account: Pick<Account, 'network' | 'handle' | 'display_name'>) =>
  `${account.network === 'linkedin' ? account.display_name ?? account.handle : account.handle.startsWith('@') ? account.handle : `@${account.handle}`} · ${networkName(account.network)}`

const quote = (text: string) => `'${text.length > 40 ? `${text.slice(0, 38)}…` : text}'`
/** One line for a flag, in the person's words. */
export function flagLine(flag: Flag): string {
  switch (flag.code) {
    case 'claim_number_mismatch': return `${quote(String(flag.text ?? ''))} differs from proof${flag.expected?.length ? ` (${flag.expected.join(', ')})` : ''}`
    case 'claim_banned': return `${quote(String(flag.text ?? ''))} is a banned claim${flag.reason ? `: ${flag.reason}` : ''}`
    case 'claim_unmatched': return `${quote(String(flag.text ?? ''))} has no proof on record`
    case 'claim_stale': return `${quote(String(flag.text ?? ''))} uses a claim past its review date`
    case 'avoid_word': return `${quote(String(flag.text ?? ''))} is on the avoid list`
    case 'over_limit': return `${networkName(flag.network)} variant · ${flag.count} / ${flag.limit}`
    case 'disclosure_missing': return 'Disclosure needed before it goes out'
    case 'disclosure_below_cut': return 'Move the disclosure above "see more"'
    case 'near_duplicate': return `Nearly repeats ${flag.matches?.length ?? 1} earlier ${flag.matches?.length === 1 ? 'post' : 'posts'}`
    case 'vote_request': return `${quote(String(flag.text ?? ''))} asks for votes`
    case 'alt_text_missing': return `${String(flag.name ?? 'An image')} needs alt text`
    case 'venue_rule': return String(flag.reason ?? `Held by the venue's ${String(flag.rule ?? '')} rule`)
    default: return flag.code.replace(/_/g, ' ')
  }
}
