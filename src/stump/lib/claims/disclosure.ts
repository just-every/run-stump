// Disclosure detection (D-2, STUMP-TRUTH-002).
//
// A connected person's item that mentions the company, a product or a competing
// product, anywhere but the company's own accounts, must disclose the connection:
//   - with the venue's disclosure line or one of the person's own disclosure lines
//     (kind "line"), or
//   - in the text's own words (kind "own_words"): "I built", "I work at", "I'm the
//     founder of", "full disclosure", "we shipped", "our product". Plain "we" and
//     "our" count when the same sentence names the company or a product.
// A bio or profile line never counts: this function reads the item's text only, and
// the caller never passes a bio. Where a network hides the end of a post behind "see
// more", the disclosure must end above the cut.
//
// US basis: the FTC's Endorsement Guides (16 CFR Part 255) and, for reviews and
// testimonials, 16 CFR Part 465 treat a material connection as something to disclose
// clearly and conspicuously:
//   https://www.ecfr.gov/current/title-16/chapter-I/subchapter-B/part-255
//   https://www.ecfr.gov/current/title-16/chapter-I/subchapter-D/part-465

import { escapeRegExp, sentenceSpans } from './sentences'
import type { MentionSet } from './mentions'
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

const STRONG: RegExp[] = [
  new RegExp(`\\bi(?:${APOS}m| am)? (?:the |a |one of the )?(?:co-?)?(?:founder|maker|creator|author|maintainer|developer|engineer|ceo|cto|cofounder)s?\\b`, 'giu'),
  new RegExp(`\\bi (?:built|made|created|wrote|founded|co-?founded|started|designed|launched|shipped|help(?:ed)? build|work (?:at|for|on)|am building|${APOS}m building)\\b`, 'giu'),
  new RegExp(`\\bwe(?: (?:just|recently|finally))? (?:shipped|built|made|launched|released|created|wrote|developed|designed|announced|open-?sourced|founded|started|run|maintain|are building|${APOS}re building|${APOS}ve (?:shipped|built|launched|released))\\b`, 'giu'),
  /\bfull disclosure\b/giu,
  /\bdisclosure\s*[:\-\u2014]/giu,
  /\b(?:disclaimer|disclosure):\s*i\b/giu,
  /\baffiliated with\b/giu,
  /\bmy (?:company|startup|employer|team'?s? product|own product)\b/giu,
  /\bour (?:product|company|startup|team|customers|users|app|platform)\b/giu,
]
const WEAK = new RegExp(`\\b(?:we|we${APOS}re|we${APOS}ve|we${APOS}ll|we${APOS}d|our|ours)\\b`, 'giu')

function termRegex(terms: readonly string[]): RegExp | undefined {
  const parts = terms
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.split(/\s+/).map(escapeRegExp).join('\\s+'))
  if (parts.length === 0) return undefined
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${parts.join('|')})(?![\\p{L}\\p{N}_])`, 'iu')
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

  for (const re of STRONG) {
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0
      matches.push({ kind: 'own_words', text: m[0], start, end: start + m[0].length })
    }
  }

  const term = termRegex(options.terms ?? [])
  if (term) {
    for (const span of sentenceSpans(text)) {
      if (!term.test(span.text)) continue
      for (const m of span.text.matchAll(WEAK)) {
        const start = span.start + (m.index ?? 0)
        matches.push({ kind: 'own_words', text: m[0], start, end: start + m[0].length })
      }
    }
  }

  matches.sort((a, b) => a.start - b.start || b.end - a.end)
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

/** D-2 applied to one item: is disclosure required, and does the text provide it above the cut. */
export function checkDisclosure(input: DisclosureCheckInput): DisclosureCheck {
  const because: string[] = []
  if (input.mentions.company.length > 0) because.push('company')
  if (input.mentions.products.length > 0) because.push('product')
  if (input.mentions.competitors.length > 0) because.push('competitor')
  const required = !input.company_account && input.connection !== null && because.length > 0
  const detection = detectDisclosure(input.text, { lines: input.lines, terms: input.terms, cut: input.cut })
  if (!required) return { required, status: 'not_required', detection, because }
  if (!detection.disclosed) return { required, status: 'missing', detection, because }
  if (detection.above_cut === false) return { required, status: 'below_cut', detection, because }
  return { required, status: 'disclosed', detection, because }
}
