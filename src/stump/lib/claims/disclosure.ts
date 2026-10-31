// Disclosure detection (D-2, STUMP-TRUTH-002).
//
// A connected person's item that mentions the company, a product or a competing
// product, anywhere but the company's own accounts, must disclose the connection:
//   - with the venue's disclosure line or one of the person's own disclosure lines
//     (kind "line"), or
//   - in the text's own words (kind "own_words"), only where the words state the
//     connection outright. Each form below is read as a whole statement, with the
//     company or a product as its object (or "it", "this", "the product" where noted):
//       "I work at/on/for Acme", "I'm with Acme", "I made/wrote/launched/built/founded Orbit"
//         (also "it" or "this": "we launched it today", never "I made it to level 5");
//       "we shipped/launched/built/founded/released Orbit", "we're building Orbit";
//       a role stated as one's own: "I'm a founder of Orbit", "as an engineer at Acme",
//         "Sam, founder of Orbit", or "I'm the founder" in a sentence naming the company
//         or a product (never "I met the developers at Orbit");
//       a paid tie stated as such: "I'm paid by Acme", "I'm employed by Acme",
//         "Acme pays me to <do something>", "Acme pays me a retainer", "Acme employs me",
//         "Acme hired me", "Acme sponsors this / sponsored this post / sponsors my newsletter",
//         "this post is sponsored by Acme", "paid partnership with Acme";
//       "Disclosure:", "Disclosure -" or "Full disclosure" followed by a connection
//         ("Disclosure: the founder is my friend");
//       "I'm affiliated with", "our product", "my own company";
//       plain "we" and "our" when the same sentence names the company or a product.
//   Anything else does not count, so the item holds and the person adds their line:
//   "Orbit pays me back in hours", "Orbit pays for itself", "Orbit pays us, in time not
//   money" and praise with no statement of a connection all read as missing. A
//   statement under a negation ("I'm not paid by Acme") never counts.
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
  new RegExp(`\\b(?:i|we)(?:${APOS}m|${APOS}re| am| are| was| were)(?: (?:also|now|still))? affiliated with\\b`, 'giu'),
  /\bmy (?:own (?:product|company|startup|app)|(?:company|team|startup)'?s (?:product|app|tool))\b/giu,
  /\bour (?:product|company|startup|team|customers|users|app|platform)\b/giu,
]

const I_ACTS = `i (?:(?:now|also|currently|still|just) )?(?:made|created|wrote|designed|launched|started|shipped|built|founded|co-?founded|maintain|develop|developed|co-?created|help(?:ed)? (?:build|make|run)|am building|${APOS}m building|work(?:ed)? (?:at|for|on)|am (?:with|at)|${APOS}m (?:with|at))`
const WE_ACTS = `we(?: (?:just|recently|finally))? (?:shipped|made|launched|released|created|wrote|developed|designed|announced|open-?sourced|started|built|founded|co-?founded|maintain|develop|are building|${APOS}re building|${APOS}ve (?:shipped|built|launched|released|made))`
const ROLE = '(?:co-?)?founders?|ceo|cto|coo|cpo|maintainers?|creators?|authors?|makers?|developers?|engineers?|designers?|employees?|(?:product )?managers?|member of the team'
const DEFINITE_ROLE = '(?:co-?)?founders?|ceo|cto|coo|cpo|maintainers?|creators?'
/** A role is the writer's own: "I'm a founder of", "as an engineer at", or a sign-off "Sam, founder of". */
const ROLE_LEAD = `(?:(?:\\bi${APOS}m|\\bi am|\\bi was|\\bi${APOS}ve been|\\bi have been|\\bwe${APOS}re|\\bwe are|\\bwe were|\\bas)\\s+(?:(?:also|now|still|currently|proudly)\\s+)?(?:(?:a|an|the|one of the|one of)\\s+)?|[,\\u2013\\u2014]\\s*)(?:(?:lead|senior|staff|principal|head|chief|founding)\\s+)?`
// "made it" is an idiom ("we made it!"), so after "made" only "this" or "the product" is an object.
const PRONOUN_OBJECT = '(?:(?<!\\bmade\\s+)it|this|the (?:product|app|tool|company|startup|project))'
/** "I'm paid by", "we're sponsored by": the writer says who pays them. */
const BE_PAID_BY = `\\b(?:i|we)(?:${APOS}m|${APOS}re| am| are| was| were|${APOS}ve been| have been| had been)(?:\\s+(?:also|now|currently|still))?\\s+(?:paid|sponsored|employed|hired|commissioned|contracted|compensated|funded|retained)\\s+by`
/** "this post is sponsored by", "Sponsored by" opening a sentence. */
const THIS_PAID_BY = `(?:\\b(?:this|it)(?:\\s+(?:post|video|thread|episode|newsletter|issue|article|review|stream|piece|talk|event|meetup|podcast))?(?:${APOS}s|\\s+is|\\s+was)\\s+(?:paid for|sponsored|funded|commissioned)\\s+by|(?:^|(?<=[.!?\\n(\\[]\\s*))(?:paid for|sponsored)\\s+by)`
const NOW = '(?:(?:now|also|currently|still)\\s+)?'
/** "Acme pays me to help with marketing": the tie and what it pays for; "to the penny" is not an act. */
const PAYS_TO = `${NOW}(?:pays|paid|is paying|has paid|has been paying)\\s+(?:me|us)\\s+to\\s+(?!(?:the|a|an|my|our|your|this|that|its|their|his|her)\\b)\\p{L}`
const PAYS_FEE = `${NOW}(?:pays|paid)\\s+(?:me|us)\\s+(?:an?\\s+)?(?:(?:monthly|weekly|yearly|annual|fixed|flat|small)\\s+)?(?:retainer|salary|stipend|commission|fee)\\b`
const EMPLOYS = `${NOW}(?:employs|employed|hired|has hired|commissioned|has commissioned|contracts|contracted|has contracted)\\s+(?:me|us)\\b`
const SPONSORS = `${NOW}(?:sponsors|sponsored|is sponsoring|has sponsored)\\s+(?:this|my|our)\\b`

/** After "Disclosure:" or "Full disclosure", the words that name a connection. */
const CONNECTION = new RegExp(`\\b(?:${[
  'work(?:s|ed|ing)?', 'employ(?:s|ed|ee|ees|er|ers|ment)', 'staff', 'colleagues?', 'co-?workers?', 'team ?mates?', 'team members?',
  '(?:on|of|join(?:ed)?) the(?: \\p{L}+)? team', '(?:co-?)?found(?:er|ers|ed|ing)', 'built', 'build(?:s|ing)?', 'makers?', 'creat(?:ed|or|ors)',
  'maintain(?:s|ed|er|ers)?', 'own(?:s|ed|er|ers)?', 'ours', 'invest(?:s|ed|or|ors|ment|ments)?', 'shareholders?', 'equity', 'stake',
  'advis(?:e|es|ed|or|ors|er|ers|ing|ory)', 'board members?', 'on the board', 'contract(?:s|ed|or|ors)?', 'consult(?:s|ed|ant|ants|ing)?',
  'freelanc(?:e|er|ers|ing)', 'clients?', 'paid', 'pay(?:s|ing)? (?:me|us)', 'sponsor(?:s|ed|ing|ship)?', 'partner(?:s|ed|ship)?',
  'affiliat(?:e|es|ed|ion)', 'commission(?:s|ed)?', 'compensat(?:e|es|ed|ion)', 'gift(?:s|ed)?', 'free (?:copy|access|account|licen[cs]e|subscription|plan|seat)',
  'friends?', 'family', 'relatives?', 'brother', 'sister', 'spouse', 'wife', 'husband', 'son', 'daughter', 'father', 'mother', 'parents?', 'cousin',
  'ceo', 'cto', 'coo', 'cpo', 'engineers?', 'developers?', 'designers?',
].join('|')})\\b`, 'giu')
const MARKER = /\b(?:full\s+disclosure\b\s*[:,\-\u2013\u2014]?|(?:disclosure|disclaimer)\s*[:\-\u2013\u2014])/giu

/** A statement under a negation ("I'm not paid by", "isn't sponsored by", "not our product"): one of the three words before it negates it. */
function negated(text: string, start: number): boolean {
  const clause = text.slice(Math.max(0, start - 80), start).split(/[.!?;:\n\u2013\u2014]/u).pop() ?? ''
  return clause.trim().split(/\s+/u).slice(-3).some(word => /^(?:not|never|no|nor|neither|non|nothing|nobody)$/iu.test(word.replace(/[^\p{L}]/gu, '')) || /n['\u2019]t$/iu.test(word))
}

function termAlternation(terms: readonly string[]): string | undefined {
  const parts = terms
    .map((t) => t.trim())
    .filter(Boolean)
    .map(namePattern)
  return parts.length > 0 ? `(?:${parts.join('|')})` : undefined
}

/** Statements that need their object to be the company, a product, or (where noted) "it" / "this" / "the product". */
function objectPatterns(term: string | undefined): RegExp[] {
  const end = '(?![\\p{L}\\p{N}_])'
  // "it" or "this" as a whole object ("I made this.", "we launched it today"), never "I made it to level 5".
  const pronoun = `${PRONOUN_OBJECT}(?=\\s*(?:[.!,;:)\\u2014-]|$|\\s+(?:today|yesterday|last|this|in|over|with|from|for|because|so|and)\\b))`
  const object = term ? `(?:(?:the\\s+)?${term}${end}|${pronoun})` : pronoun
  const out = [
    new RegExp(`\\b${I_ACTS}\\s+${object}`, 'giu'),
    new RegExp(`\\b${WE_ACTS}\\s+${object}`, 'giu'),
    new RegExp(`${ROLE_LEAD}(?:${ROLE})\\s+(?:of|at|behind|on|for)\\s+${object}`, 'giu'),
  ]
  // A paid tie names who pays: the company or a product, never "it" ("it pays me back").
  if (term) {
    const payer = `(?<![\\p{L}\\p{N}_])(?:the\\s+)?${term}\\s+`
    out.push(...[PAYS_TO, PAYS_FEE, EMPLOYS, SPONSORS].map(act => new RegExp(`${payer}${act}`, 'giu')),
      new RegExp(`(?:${BE_PAID_BY}|${THIS_PAID_BY})\\s+(?:the\\s+)?${term}${end}`, 'gimu'),
      new RegExp(`\\bpaid partnership with\\s+(?:the\\s+)?${term}${end}`, 'giu'))
  }
  return out
}

/** "Disclosure:", "Disclosure -" or "Full disclosure", then a connection in the same sentence, up to its last connection word. */
function markerMatches(text: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = []
  const spans = sentenceSpans(text)
  for (const m of text.matchAll(MARKER)) {
    const start = m.index ?? 0, from = start + m[0].length
    const until = spans.find(span => span.start <= start && start < span.end)?.end ?? text.length
    const rest = text.slice(from, until)
    const found = [...rest.matchAll(CONNECTION)].filter(c => !negated(rest, c.index ?? 0))
    const last = found[found.length - 1]
    if (last) out.push({ start, end: from + (last.index ?? 0) + last[0].length })
  }
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
      // A leading comma or dash of a sign-off ("Sam, founder of Orbit") is not part of the statement.
      const lead = /^[\s,\u2013\u2014]*/u.exec(m[0])?.[0].length ?? 0
      const start = offset + (m.index ?? 0) + lead
      if (negated(text, start)) continue
      matches.push({ kind: 'own_words', text: m[0].slice(lead), start, end: offset + (m.index ?? 0) + m[0].length })
    }
  }
  for (const re of [...ALWAYS, ...objectPatterns(termAlt)]) pushAll(re, text, 0)
  for (const { start, end } of markerMatches(text)) if (!negated(text, start)) matches.push({ kind: 'own_words', text: text.slice(start, end), start, end })

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
 * A sentence that says the writer's connection and little else: a connection in the forms detectDisclosure recognises
 * ("Disclosure: I'm a friend of the team", "founder at Brightwell", "Brightwell pays me to help with marketing") with at
 * most five other words. Plain "we" or
 * "our" beside a name is not a statement of connection on its own. `terms` are the company's and its products' names.
 */
export function statesConnection(sentence: string, terms: readonly string[] = []): boolean {
  const found = detectDisclosure(sentence, { terms }).matches.filter((match) => !WEAK_ONLY.test(match.text.trim()))
  if (!found.length) return false
  const rest = found.reduce((left, match) => left.slice(0, match.start) + ' '.repeat(match.end - match.start) + left.slice(match.end), sentence)
  return rest.split(/\s+/).filter((word) => /\p{L}/u.test(word)).length <= 5
}
