// Disclosure recognition (D-2, STUMP-TRUTH-002), by whole sentences.
//
// A connected person's item that mentions the company, a product or a competing
// product, anywhere but the company's own accounts, must disclose the connection.
// It counts as disclosed only when one of these stands in it as a whole sentence:
//   1. a disclosure line exactly: the venue's line or one of the writer's own lines
//      (kind "line");
//   2. a fixed first-person statement naming the company or one of its products, by
//      a recorded name or other name (kind "statement"):
//        "I work at|for|on <name>"
//        "I'm|I am a|an|the <role> at|of|on <name>", "I'm|I am one of the <role>(s) at|of|on <name>",
//          <role> one of ROLES below
//        "I'm|I am paid by <name>", "<name> pays me", "<name> paid me"
//        "Sponsored by <name>", "This post is sponsored by <name>", "Paid partnership with <name>"
//   3. only for a writer whose recorded connection is founder or employee: a sentence
//      that opens "We shipped|launched|released|built <product>" or "We just
//      shipped|launched|released <product>", with anything after the product's name
//      (kind "shipped").
// A sentence is compared after trimming and collapsing its whitespace, ignoring case,
// with an optional trailing ". ! …" and an optional leading "Disclosure:" or
// "Disclosure -". Nothing else counts. A sentence ends at . ! ? or … followed by space
// or the end of the text, at a blank line, or at the end of the text; a single line
// break does not end one. Where a network hides the end of a post behind "see more",
// the disclosure must end above the cut.
//
// US basis: the FTC's Endorsement Guides (16 CFR Part 255) and, for reviews and
// testimonials, 16 CFR Part 465 treat a material connection as something to disclose
// clearly and conspicuously:
//   https://www.ecfr.gov/current/title-16/chapter-I/subchapter-B/part-255
//   https://www.ecfr.gov/current/title-16/chapter-I/subchapter-D/part-465

import { namePattern, type MentionSet } from './mentions'
import type { Connection } from './types'

export type DisclosureKind = 'line' | 'statement' | 'shipped'

export interface DisclosureMatch {
  kind: DisclosureKind
  text: string
  start: number
  end: number
  /** The line that matched, for kind "line". */
  line?: string
}

export interface DisclosureResult {
  disclosed: boolean
  kind: DisclosureKind | null
  matches: DisclosureMatch[]
  /** Offset of the first disclosure, or null. */
  first_at: number | null
  /** With a cut: some disclosure ends at or before the cut. Null when no cut was given or nothing is disclosed. */
  above_cut: boolean | null
}

export interface DetectDisclosureOptions {
  /** The venue's disclosure line and the writer's own disclosure lines, each matched exactly as whole sentences. */
  lines?: readonly string[]
  /** The company's and its products' names and other names: what a fixed statement names. */
  names?: readonly string[]
  /** The products' names and other names: what "We shipped <product>" names. */
  products?: readonly string[]
  /** The writer's recorded connection: "We shipped <product>" counts only for a founder or an employee. */
  connection?: Connection | null
  /** Characters visible before "see more" on the network, when it hides the end. */
  cut?: number
}

const ROLES = ['founder', 'co-founder', 'cofounder', 'employee', 'engineer', 'designer', 'developer', 'contractor', 'consultant',
  'advisor', 'adviser', 'investor', 'owner', 'CEO', 'CTO'] as const

const SHIPPING: readonly Connection[] = ['founder', 'employee']

interface Sentence { text: string; start: number; end: number }

/** A sentence's end: . ! ? or … (with closing quotes or brackets) before space or the end, or a blank line. */
const END = /[.!?…]+["'”’)\]]*(?=\s|$)|\n[^\S\n]*\n/gu

/** The whole sentences of a text with their offsets, trimmed. A single line break is space inside a sentence. */
function wholeSentences(text: string): Sentence[] {
  const out: Sentence[] = []
  const push = (from: number, to: number) => {
    const raw = text.slice(from, to), lead = raw.length - raw.trimStart().length, trimmed = raw.trim()
    if (trimmed) out.push({ text: trimmed, start: from + lead, end: from + lead + trimmed.length })
  }
  let start = 0
  for (const m of text.matchAll(END)) {
    const at = m.index ?? 0
    push(start, m[0].startsWith('\n') ? at : at + m[0].length)
    start = at + m[0].length
  }
  push(start, text.length)
  return out
}

const LEAD = /^disclosure(?:\s*:|\s+[-–—])\s*/iu
const TRAIL = /(?:\.\.\.|[.!…])$/u

/** How a sentence is compared: NFKC, straight apostrophes, whitespace collapsed, lower case, without a leading "Disclosure:" or "Disclosure -". */
function plain(sentence: string): string {
  return sentence.normalize('NFKC').replace(/[‘’]/gu, "'").replace(/\s+/gu, ' ').trim().replace(LEAD, '').toLowerCase()
}

/** A sentence as compared, with and without one trailing ". ! …" (a name may end in one: "Acme Inc."). */
function readings(sentence: string): string[] {
  const read = plain(sentence), bare = read.replace(TRAIL, '').trim()
  return bare && bare !== read ? [bare, read] : read ? [read] : []
}

function alternation(names: readonly string[]): string | null {
  const parts = [...new Set(names.map(name => name.normalize('NFKC').replace(/[‘’]/gu, "'").trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length).map(namePattern)
  return parts.length ? `(?:${parts.join('|')})` : null
}

/** The fixed statements of form 2, naming one of `names`, as one anchored pattern. */
function statementPattern(names: readonly string[]): RegExp | null {
  const name = alternation(names)
  if (!name) return null
  const role = `(?:${ROLES.join('|')})`
  const am = "i(?:'m| am)"
  return new RegExp(`^(?:${[
    `i work (?:at|for|on) ${name}`,
    `${am} (?:(?:a|an|the) ${role}|one of the ${role}s?) (?:at|of|on) ${name}`,
    `${am} paid by ${name}`,
    `${name} (?:pays|paid) me`,
    `(?:this post is )?sponsored by ${name}`,
    `paid partnership with ${name}`,
  ].join('|')})$`, 'iu')
}

/** Form 3: "We shipped Orbit 2.0 …", opening the sentence with one of the products. */
function shippedPattern(products: readonly string[]): RegExp | null {
  const product = alternation(products)
  return product ? new RegExp(`^we (?:(?:shipped|launched|released|built)|just (?:shipped|launched|released)) ${product}(?![\\p{L}\\p{N}_])`, 'iu') : null
}

/** Each line as the sentences it is made of, compared the way text sentences are. */
function lineSentences(lines: readonly string[]) {
  return [...new Set(lines.map(line => line.trim()).filter(Boolean))]
    .map(line => ({ line, parts: wholeSentences(line).map(sentence => readings(sentence.text)) }))
    .filter(entry => entry.parts.length > 0 && entry.parts.every(part => part.length > 0))
}

export function detectDisclosure(text: string, options: DetectDisclosureOptions = {}): DisclosureResult {
  const sentences = wholeSentences(text)
  const read = sentences.map(sentence => readings(sentence.text))
  const matches: DisclosureMatch[] = []

  // 1. A line, exactly, as one or more whole sentences in a row.
  for (const { line, parts } of lineSentences(options.lines ?? [])) {
    for (let i = 0; i + parts.length <= sentences.length; i++) {
      if (!parts.every((part, k) => part.some(form => read[i + k]!.includes(form)))) continue
      const first = sentences[i]!, last = sentences[i + parts.length - 1]!
      matches.push({ kind: 'line', text: text.slice(first.start, last.end), start: first.start, end: last.end, line })
    }
  }

  // 2. A fixed statement naming the company or a product; 3. "We shipped <product>" from a founder or an employee.
  const statement = statementPattern(options.names ?? [])
  const shipped = options.connection && SHIPPING.includes(options.connection) ? shippedPattern(options.products ?? []) : null
  sentences.forEach((sentence, i) => {
    const kind: DisclosureKind | null = statement && read[i]!.some(form => statement.test(form)) ? 'statement'
      : shipped && read[i]!.some(form => shipped.test(form)) ? 'shipped' : null
    if (kind) matches.push({ kind, text: sentence.text, start: sentence.start, end: sentence.end })
  })

  matches.sort((a, b) => a.start - b.start || b.end - a.end)
  const kind = matches.some(m => m.kind === 'line') ? 'line' : matches[0]?.kind ?? null
  const above = options.cut === undefined || matches.length === 0 ? null : matches.some(m => m.end <= (options.cut as number))
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
  names?: readonly string[]
  /** Names of the products; when absent, the product names `mentions` found in the text. */
  products?: readonly string[]
  cut?: number
}

export interface DisclosureCheck {
  required: boolean
  status: DisclosureStatus
  detection: DisclosureResult
  /** What in the text makes disclosure required. */
  because: string[]
}

/** The names a text used, as `mentions` found them by name (a link's host is not a name). */
const named = (found: MentionSet['products'] | MentionSet['company']) => [...new Set(found.filter(m => m.via !== 'url').map(m => m.name))]

/** D-2 applied to one item: is disclosure required, and does the text provide it above the cut. */
export function checkDisclosure(input: DisclosureCheckInput): DisclosureCheck {
  const because: string[] = []
  if (input.mentions.company.length > 0) because.push('company')
  if (input.mentions.products.length > 0) because.push('product')
  if (input.mentions.competitors.length > 0) because.push('competitor')
  const required = !input.company_account && input.connection !== null && because.length > 0
  const detection = detectDisclosure(input.text, {
    lines: input.lines, connection: input.connection, cut: input.cut,
    names: input.names ?? named([...input.mentions.products, ...input.mentions.company]),
    products: input.products ?? named(input.mentions.products),
  })
  if (!required) return { required, status: 'not_required', detection, because }
  if (!detection.disclosed) return { required, status: 'missing', detection, because }
  if (detection.above_cut === false) return { required, status: 'below_cut', detection, because }
  return { required, status: 'disclosed', detection, because }
}

/**
 * The text says how the writer is connected and nothing else: every one of its sentences is a fixed statement (form 2) naming
 * one of `names`, or one of `lines`.
 */
export function statesConnection(text: string, names: readonly string[] = [], lines: readonly string[] = []): boolean {
  const sentences = wholeSentences(text)
  if (!sentences.length) return false
  const found = detectDisclosure(text, { names, lines }).matches
  return sentences.every(sentence => found.some(match => match.start <= sentence.start && sentence.end <= match.end))
}
