// Near-duplicate scoring against earlier texts (STUMP-TRUTH-004).
//
// Platforms treat near-identical posts as spam, so a text that nearly repeats an
// earlier one is held. The score is lexical: how much of the two texts' wording is
// shared after removing what changes between copies of one message (links,
// @mentions, numbers). A reply that makes the same point in other words shares
// little wording and passes; the same reply with a name or a link changed scores
// near 1. The score is the mean of the Dice coefficients of the texts' word
// bigrams and of their character 5-grams, both in [0, 1].

export interface EarlierText {
  id: string
  text: string
  /** When it was posted or queued (ISO 8601); used with `window_days`. */
  at?: string
  /**
   * Where it went. A company announcement adapted for the company's own accounts on
   * different networks is not a near-duplicate of itself (see `isOwnCrossNetwork`).
   */
  scope?: DuplicateScope
}

export interface DuplicateScope {
  network?: string
  account_id?: string
  venue_id?: string
  /** The target is one of the company's own accounts. */
  own_account?: boolean
  /** Variants of one master share a group id and never match each other. */
  group_id?: string
}

export interface DuplicateOptions {
  /** Score at or above which an earlier text is a match. Default 0.8. */
  threshold?: number
  /** Texts with fewer content words than this are never held (a bare "Thanks!"). Default 4. */
  min_words?: number
  /** Only earlier texts this recent count (needs `now` and the texts' `at`). */
  window_days?: number
  now?: string | Date
  /** Where the candidate is going; enables the own-account exemption. */
  scope?: DuplicateScope
  /** Matches to return, best first. Default 5. */
  limit?: number
}

export interface DuplicateMatch {
  id: string
  score: number
  /** The earlier text that matched. */
  text: string
  at?: string
  scope?: DuplicateScope
}

export interface DuplicateResult {
  held: boolean
  threshold: number
  best_score: number
  matches: DuplicateMatch[]
  /** Why the candidate was not compared, e.g. too short. */
  skipped?: 'too_short'
}

export const DEFAULT_DUPLICATE_THRESHOLD = 0.8

const URL_LIKE = /(?:https?:\/\/|www\.)\S+|\b[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+\/\S*/giu
const MENTION = /[@＠][\p{L}\p{N}_.]+(?:@[\p{L}\p{N}_.-]+)?/gu

export function normalizeForSimilarity(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(URL_LIKE, ' ')
    .replace(MENTION, ' ')
    .replace(/\d+(?:[.,]\d+)*/g, '0')
    .replace(/[^\p{L}\p{N}0]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

let wordSegmenter: Intl.Segmenter | null = null

/** Words of normalised text; Intl.Segmenter finds word boundaries in scripts written without spaces. */
function words(normalized: string): string[] {
  if (normalized === '') return []
  wordSegmenter ??= new Intl.Segmenter('en', { granularity: 'word' })
  const out: string[] = []
  for (const part of wordSegmenter.segment(normalized)) if (part.isWordLike) out.push(part.segment)
  return out
}

function dice<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  for (const x of small) if (large.has(x)) shared++
  return (2 * shared) / (a.size + b.size)
}

function wordBigrams(words: string[]): Set<string> {
  const set = new Set<string>()
  if (words.length === 1) set.add(words[0] as string)
  for (let i = 0; i + 1 < words.length; i++) set.add(`${words[i]} ${words[i + 1]}`)
  return set
}

function charGrams(s: string, n: number): Set<string> {
  const padded = ` ${s} `
  const set = new Set<string>()
  const chars = Array.from(padded)
  if (chars.length <= n) set.add(padded)
  for (let i = 0; i + n <= chars.length; i++) set.add(chars.slice(i, i + n).join(''))
  return set
}

export function similarityScore(a: string, b: string): number {
  const na = normalizeForSimilarity(a)
  const nb = normalizeForSimilarity(b)
  if (na === '' || nb === '') return 0
  if (na === nb) return 1
  const wordScore = dice(wordBigrams(words(na)), wordBigrams(words(nb)))
  const charScore = dice(charGrams(na, 5), charGrams(nb, 5))
  return (wordScore + charScore) / 2
}

/** The candidate and the earlier text are both company-own accounts on different networks, or variants of one master. */
export function isOwnCrossNetwork(candidate: DuplicateScope | undefined, earlier: DuplicateScope | undefined): boolean {
  if (!candidate || !earlier) return false
  if (candidate.group_id && candidate.group_id === earlier.group_id) return true
  return Boolean(
    candidate.own_account &&
      earlier.own_account &&
      candidate.network &&
      earlier.network &&
      candidate.network !== earlier.network,
  )
}

function wordCount(text: string): number {
  return words(normalizeForSimilarity(text)).length
}

export function nearDuplicates(candidate: string, earlier: readonly EarlierText[], options: DuplicateOptions = {}): DuplicateResult {
  const threshold = options.threshold ?? DEFAULT_DUPLICATE_THRESHOLD
  const minWords = options.min_words ?? 4
  if (wordCount(candidate) < minWords) {
    return { held: false, threshold, best_score: 0, matches: [], skipped: 'too_short' }
  }
  const cutoff =
    options.window_days !== undefined && options.now !== undefined
      ? new Date(options.now).getTime() - options.window_days * 86_400_000
      : undefined

  const scored: DuplicateMatch[] = []
  for (const e of earlier) {
    if (cutoff !== undefined && e.at !== undefined) {
      const t = new Date(e.at).getTime()
      if (Number.isFinite(t) && t < cutoff) continue
    }
    if (isOwnCrossNetwork(options.scope, e.scope)) continue
    if (wordCount(e.text) < minWords) continue
    const score = similarityScore(candidate, e.text)
    scored.push({ id: e.id, score: Math.round(score * 1000) / 1000, text: e.text, at: e.at, scope: e.scope })
  }
  scored.sort((x, y) => y.score - x.score)
  const matches = scored.filter((m) => m.score >= threshold).slice(0, options.limit ?? 5)
  return { held: matches.length > 0, threshold, best_score: scored[0]?.score ?? 0, matches }
}
