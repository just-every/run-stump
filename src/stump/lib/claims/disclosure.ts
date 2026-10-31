// Disclosure detection (D-2, STUMP-TRUTH-002).
//
// A connected person's item that mentions the company, a product or a competing
// product, anywhere but the company's own accounts, must disclose the connection:
//   - with the venue's disclosure line or one of the person's own disclosure lines
//     (kind "line"), or
//   - in the text's own words (kind "own_words"), when the words themselves make the
//     connection clear:
//       "I built", "I founded", "full disclosure", "disclosure:", "affiliated with",
//       "our product", "my own product" count wherever they appear;
//       a first-person act counts only with the company or a product (or "it", "this",
//       "the product") as its object: "I work at Acme", "I now work at Acme", "I made
//       Orbit", "we launched it", "I'm building Orbit" (not "I work at Stripe and use
//       Orbit", "I made it to level 5", "I wrote about Orbit", "I started using Orbit");
//       a paid tie counts with the company or a product as the one paying: "Acme pays
//       me", "Orbit sponsors my newsletter", "sponsored by Acme" (not "Orbit paid us back");
//       a role counts with its object ("founder of Orbit", "an engineer at Acme") or as
//       "I'm the founder" in a sentence naming the company or a product (not "I'm a
//       developer and Orbit is great");
//       plain "we" and "our" count when the same sentence names the company or a product.
// A bio or profile line never counts: this function reads the item's text only, and
// the caller never passes a bio. Where a network hides the end of a post behind "see
// more", the disclosure must end above the cut.
//
// US basis: the FTC's Endorsement Guides (16 CFR Part 255) and, for reviews and
// testimonials, 16 CFR Part 465 treat a material connection as something to disclose
// clearly and conspicuously:
//   https://www.ecfr.gov/current/title-16/chapter-I/subchapter-B/part-255
//   https://www.ecfr.gov/current/title-16/chapter-I/subchapter-D/part-465

import { extractUrls } from '../text/urls'
import { escapeRegExp, sentenceSpans } from './sentences'
import { namePattern, type MentionSet } from './mentions'
import type { Connection } from './types'

export interface DisclosureMatch {
  kind: 'line' | 'own_words'
  text: string
  start: number
  end: number
  /** The line that matched, for kind "line". */
  line?: string
}

export interface DisclosureResult {
  disclosed: boolean
  kind: 'line' | 'own_words' | null
  matches: DisclosureMatch[]
  /** Offset of the first disclosure, or null. */
  first_at: number | null
  /** With a cut: some disclosure ends at or before the cut. Null when no cut was given or nothing is disclosed. */
  above_cut: boolean | null
}

export interface DetectDisclosureOptions {
  /** The venue's disclosure line and the person's own disclosure lines. */
  lines?: readonly string[]
  /** Names of the company and its products: "we" or "our" beside one of them counts. */
  terms?: readonly string[]
  /** Characters visible before "see more" on the network, when it hides the end. */
  cut?: number
}

const APOS = "['\u2019]"

/** Unambiguous wherever they appear. */
const ALWAYS: RegExp[] = [
  /\bi (?:built|founded|co-?founded)\b/giu,
  /\bwe (?:(?:just|recently|finally) )?(?:built|founded|co-?founded)\b/giu,
  /\bfull disclosure\b/giu,
  /\bdisclosure\s*[:\-\u2014]/giu,
  /\b(?:disclaimer|disclosure):\s*i\b/giu,
  /\baffiliated with\b/giu,
  /\bmy (?:own (?:product|company|startup|app)|(?:company|team|startup)'?s (?:product|app|tool))\b/giu,
  /\bour (?:product|company|startup|team|customers|users|app|platform)\b/giu,
]

const I_ACTS = `i (?:(?:now|also|currently|still) )?(?:made|created|wrote|designed|launched|started|shipped|maintain|develop|developed|co-?created|help(?:ed)? (?:build|make|run)|am building|${APOS}m building|work(?:ed)? (?:at|for|on)|am (?:with|at)|${APOS}m (?:with|at))`
const WE_ACTS = `we(?: (?:just|recently|finally))? (?:shipped|made|launched|released|created|wrote|developed|designed|announced|open-?sourced|started|maintain|develop|are building|${APOS}re building|${APOS}ve (?:shipped|built|launched|released|made))`
const ROLE = '(?:co-?)?founders?|ceo|cto|coo|cpo|maintainers?|creators?|authors?|makers?|developers?|engineers?|designers?|employees?|(?:product )?managers?|(?:a )?member of the team'
const DEFINITE_ROLE = '(?:co-?)?founders?|ceo|cto|coo|cpo|maintainers?|creators?'
// "made it" is an idiom ("we made it!"), so after "made" only "this" or "the product" is an object.
const PRONOUN_OBJECT = '(?:(?<!\\bmade\\s+)it|this|the (?:product|app|tool|company|startup|project))'
/**
 * What a company does for someone it pays: "pays me", "sponsors my newsletter", "employs us". "Pays me back" and "paid us
 * back" say the product was worth it, not that anyone is paid, so they never count.
 */
const PAYS = '(?:(?:now|also|currently) )?(?:pays|paid|sponsors|sponsored|employs|employed|compensates|compensated|hires|hired|funds|funded|commissions|commissioned)\\s+(?:me|us|my|our)\\b(?!\\s+back\\b)'
const PAID_BY = '(?:paid|sponsored|employed|compensated|hired|funded|commissioned|contracted)\\s+by'

function termAlternation(terms: readonly string[]): string | undefined {
  const parts = terms
    .map((t) => t.trim())
    .filter(Boolean)
    .map(namePattern)
  return parts.length > 0 ? `(?:${parts.join('|')})` : undefined
}

/** Patterns that need their object to be the company, a product, or "it" / "this" / "the product". */
function objectPatterns(term: string | undefined): RegExp[] {
  const end = '(?![\\p{L}\\p{N}_])'
  // "it" or "this" as a whole object ("I made this.", "we launched it today"), never "I made it to level 5".
  const pronoun = `${PRONOUN_OBJECT}(?=\\s*(?:[.!,;:)\\u2014-]|$|\\s+(?:today|yesterday|last|this|in|over|with|from|for|because|so|and)\\b))`
  const object = term ? `(?:(?:the\\s+)?${term}${end}|${pronoun})` : pronoun
  const out = [
    new RegExp(`\\b${I_ACTS}\\s+${object}`, 'giu'),
    new RegExp(`\\b${WE_ACTS}\\s+${object}`, 'giu'),
    new RegExp(`\\b(?:${ROLE})\\s+(?:of|at|behind|on)\\s+${object}`, 'giu'),
  ]
  // A paid tie names who pays: the company or a product, never "it" ("it pays me back").
  if (term) out.push(new RegExp(`(?<![\\p{L}\\p{N}_])${term}\\s+${PAYS}`, 'giu'), new RegExp(`\\b${PAID_BY}\\s+(?:the\\s+)?${term}${end}`, 'giu'))
  return out
}

const I_AM_THE_ROLE = new RegExp(`\\bi(?:${APOS}m| am) (?:the |one of the )?(?:${DEFINITE_ROLE})\\b`, 'giu')
/** Text quoted from a bio or profile ("bio: founder of Acme") is a bio line, which never counts. */
const BIO_SEGMENT = /\b(?:bio|profile|about me)\s*[:\u2014-]\s*[^\n)]*/giu
const WEAK = new RegExp(`\\b(?:we|we${APOS}re|we${APOS}ve|we${APOS}ll|we${APOS}d|our|ours)\\b`, 'giu')

/** Links, addresses, #tags and @handles: none of them is the author's own words ("orbit.run/our-pricing", "#our"). */
const NOT_WORDS = [
  /(?<!\S)\S*?(?::\/\/|www\.)\S*/giu,
  /(?<![\p{L}\p{N}_.-])[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+[/?#]\S*/giu,
  /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+/giu,
  /(?<![\p{L}\p{N}_])[@\uFF20#\uFF03][\p{L}\p{N}_.]+/giu,
]

/** The text with links, addresses, #tags and @handles blanked to spaces, keeping every offset. */
function wordsOnly(text: string): string {
  const units = text.split('')
  const blank = (a: number, b: number) => units.fill(' ', a, b)
  for (const u of extractUrls(text)) blank(u.start, u.end)
  for (const re of NOT_WORDS) for (const m of text.matchAll(re)) blank(m.index ?? 0, (m.index ?? 0) + m[0].length)
  return units.join('')
}

export function detectDisclosure(text: string, options: DetectDisclosureOptions = {}): DisclosureResult {
  const matches: DisclosureMatch[] = []

  for (const line of options.lines ?? []) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    const pattern = trimmed.split(/\s+/).map(escapeRegExp).join('\\s+').replace(/['\u2019]/g, APOS)
    for (const m of text.matchAll(new RegExp(pattern, 'giu'))) {
      const start = m.index ?? 0
      matches.push({ kind: 'line', text: m[0], start, end: start + m[0].length, line })
    }
  }

  const termAlt = termAlternation(options.terms ?? [])
  const pushAll = (re: RegExp, within: string, offset: number) => {
    for (const m of within.matchAll(re)) {
      const start = offset + (m.index ?? 0)
      matches.push({ kind: 'own_words', text: m[0], start, end: start + m[0].length })
    }
  }
  for (const re of [...ALWAYS, ...objectPatterns(termAlt)]) pushAll(re, text, 0)

  if (termAlt) {
    // The sentence may name the product anywhere, a link included; "we", "our" and "I'm the
    // founder" are read only in the author's own words.
    const term = new RegExp(`(?<![\\p{L}\\p{N}_])${termAlt}(?![\\p{L}\\p{N}_])`, 'iu')
    const words = wordsOnly(text)
    for (const span of sentenceSpans(text)) {
      if (!term.test(span.text)) continue
      const own = words.slice(span.start, span.end)
      pushAll(WEAK, own, span.start)
      pushAll(I_AM_THE_ROLE, own, span.start)
    }
  }

  // Bio segments do not overlap and come in order; a match inside one is dropped.
  const bios = [...text.matchAll(BIO_SEGMENT)].map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length] as const)
  matches.sort((a, b) => a.start - b.start || b.end - a.end)
  let b = 0
  const kept = matches.filter((m) => {
    while (b < bios.length && (bios[b] as readonly [number, number])[1] <= m.start) b++
    const bio = bios[b]
    return !(bio && m.start >= bio[0] && m.end <= bio[1])
  })
  matches.length = 0
  matches.push(...kept)
  const kind = matches.some((m) => m.kind === 'line') ? 'line' : matches.length > 0 ? 'own_words' : null
  const above =
    options.cut === undefined || matches.length === 0 ? null : matches.some((m) => m.end <= (options.cut as number))
  return { disclosed: matches.length > 0, kind, matches, first_at: matches[0]?.start ?? null, above_cut: above }
}

export type DisclosureStatus = 'not_required' | 'disclosed' | 'missing' | 'below_cut'

export interface DisclosureCheckInput {
  text: string
  mentions: MentionSet
  /** The poster's recorded connection; null for a person with none. */
  connection: Connection | null
  /** The item goes to one of the company's own accounts. */
  company_account: boolean
  lines?: readonly string[]
  /** Names of the company and its products; when absent, the names `mentions` found in the text. */
  terms?: readonly string[]
  cut?: number
}

export interface DisclosureCheck {
  required: boolean
  status: DisclosureStatus
  detection: DisclosureResult
  /** What in the text makes disclosure required. */
  because: string[]
}

/**
 * The company and product names a text used, as `mentions` found them: products by name or
 * other name and the company by its names. A link's host is not a name, and a competitor's
 * name never makes "we" a disclosure.
 */
function mentionedTerms(mentions: MentionSet): string[] {
  return [...new Set([...mentions.products, ...mentions.company].filter((m) => m.via !== 'url').map((m) => m.name))]
}

/** D-2 applied to one item: is disclosure required, and does the text provide it above the cut. */
export function checkDisclosure(input: DisclosureCheckInput): DisclosureCheck {
  const because: string[] = []
  if (input.mentions.company.length > 0) because.push('company')
  if (input.mentions.products.length > 0) because.push('product')
  if (input.mentions.competitors.length > 0) because.push('competitor')
  const required = !input.company_account && input.connection !== null && because.length > 0
  const terms = input.terms ?? mentionedTerms(input.mentions)
  const detection = detectDisclosure(input.text, { lines: input.lines, terms, cut: input.cut })
  if (!required) return { required, status: 'not_required', detection, because }
  if (!detection.disclosed) return { required, status: 'missing', detection, because }
  if (detection.above_cut === false) return { required, status: 'below_cut', detection, because }
  return { required, status: 'disclosed', detection, because }
}

const WEAK_ONLY = new RegExp(`^(?:we|we${APOS}(?:re|ve|ll|d)|our|ours)$`, 'iu')

/**
 * A sentence that says the writer's connection and little else: "Disclosure: …", or a connection in its own words
 * ("founder at Brightwell", "Brightwell pays me to help with marketing") with at most five other words. Plain "we" or
 * "our" beside a name is not a statement of connection on its own. `terms` are the company's and its products' names.
 */
export function statesConnection(sentence: string, terms: readonly string[] = []): boolean {
  if (/^(?:full )?disclosure\b/iu.test(sentence.trim())) return true
  const found = detectDisclosure(sentence, { terms }).matches.filter((match) => !WEAK_ONLY.test(match.text.trim()))
  if (!found.length) return false
  const rest = found.reduce((left, match) => left.slice(0, match.start) + ' '.repeat(match.end - match.start) + left.slice(match.end), sentence)
  return rest.split(/\s+/).filter((word) => /\p{L}/u.test(word)).length <= 5
}
