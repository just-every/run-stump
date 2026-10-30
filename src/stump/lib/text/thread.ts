// Split a long text into a thread at sentence boundaries.
//
// Sentences come from Intl.Segmenter (Unicode UAX #29 sentence boundaries), so
// "example.com/page" and "v2.1" do not split. Parts are packed greedily and each
// is counted with the network's own rule (count.ts), numbering included. A single
// sentence that does not fit on its own is broken at a clause mark, then a word,
// then a grapheme, in that order, and the result says so. A URL is never cut: no
// sentence ends inside one (a "?" in its query is not a question mark), a word is cut
// around the URLs it holds, never inside one, and a URL that cannot fit is reported as
// a problem on its part.

import { splitGraphemes, splitSentences } from './graphemes'
import { countText } from './count'
import { extractUrls } from './urls'
import { normalizeDomain } from './utm'
import type { CountTarget, TextCount } from './types'

export type NumberingFormat = 'n/N' | 'n/' | '(n/N)'

export interface ThreadOptions {
  target: CountTarget
  /** Number the parts. A text that fits one post is never numbered. */
  numbering?: { format: NumberingFormat; position?: 'start' | 'end' }
  /**
   * The company's own domains (LinkRules.own_domains): a bare link to one, such as a tagged
   * "example.dev?utm_source=x", is a URL whatever its top-level domain, so it is never cut.
   */
  own_domains?: readonly string[]
}

export interface ThreadPart {
  index: number
  /** The text to post, numbering included. */
  text: string
  /** The text without numbering. */
  body: string
  count: TextCount
  /** How the part's text was cut: at sentence ends, or inside a sentence. */
  cut: 'sentence' | 'clause' | 'word' | 'grapheme'
}

export interface ThreadProblem {
  part: number
  code: 'part_over_limit' | 'unsplittable_url'
  detail: string
}

export interface ThreadResult {
  parts: ThreadPart[]
  total: number
  /** Every part fits the network's limits. */
  fits: boolean
  problems: ThreadProblem[]
}

function marker(format: NumberingFormat, i: number, n: number): string {
  if (format === 'n/N') return `${i}/${n}`
  if (format === 'n/') return `${i}/`
  return `(${i}/${n})`
}

function compose(body: string, opts: ThreadOptions, i: number, n: number): string {
  if (!opts.numbering) return body
  const m = marker(opts.numbering.format, i, n)
  return opts.numbering.position === 'start' ? `${m} ${body}` : `${body} ${m}`
}

type Level = ThreadPart['cut']

interface Unit {
  text: string
  level: Level
}

/** A word written as a link ("https://...", "example.com/x"). */
const LINK_WORD = /^https?:\/\/|^[^\s/]+\.[^\s/]+\/\S/i

/** A word that is, or holds, a URL ("example.dev?ref=x" on an own domain included). */
function holdsUrl(word: string, ownHosts: readonly string[]): boolean {
  return LINK_WORD.test(word) || extractUrls(word, { extraBareHosts: ownHosts }).length > 0
}

function breakSentence(sentence: string, fits: (s: string) => boolean, ownHosts: readonly string[]): Unit[] {
  if (fits(sentence.trim())) return [{ text: sentence, level: 'sentence' }]
  const clauses = sentence.split(/(?<=[,;:—–])(?=\s)/u)
  if (clauses.length > 1) {
    return clauses.flatMap((c) => (fits(c.trim()) ? [{ text: c, level: 'clause' as Level }] : breakWords(c, fits, ownHosts)))
  }
  return breakWords(sentence, fits, ownHosts)
}

function breakWords(text: string, fits: (s: string) => boolean, ownHosts: readonly string[]): Unit[] {
  const words = text.split(/(?<=\s)(?=\S)/u)
  const out: Unit[] = []
  const cutGraphemes = (piece: string) => {
    let acc = ''
    for (const g of splitGraphemes(piece)) {
      if (acc && !fits((acc + g).trim())) {
        out.push({ text: acc, level: 'grapheme' })
        acc = g
      } else acc += g
    }
    if (acc) out.push({ text: acc, level: 'grapheme' })
  }
  for (const w of words) {
    if (fits(w.trim())) {
      out.push({ text: w, level: 'word' })
      continue
    }
    const lead = w.length - w.trimStart().length
    const end = lead + w.trim().length
    const urls = extractUrls(w, { extraBareHosts: ownHosts })
    if (LINK_WORD.test(w.trim()) || (urls.length === 1 && urls[0]?.start === lead && urls[0]?.end === end)) {
      out.push({ text: w, level: 'word' }) // reported as unsplittable_url by the packer
      continue
    }
    // Cut inside the word at graphemes, never inside a URL it holds: each URL stays one piece.
    let cursor = 0
    for (const u of urls) {
      if (u.start > cursor) cutGraphemes(w.slice(cursor, u.start))
      out.push({ text: w.slice(u.start, u.end), level: 'grapheme' })
      cursor = u.end
    }
    if (cursor < w.length) cutGraphemes(w.slice(cursor))
  }
  return out
}

function ownHostsOf(opts: ThreadOptions): string[] {
  return (opts.own_domains ?? []).map(normalizeDomain).filter(Boolean)
}

function pack(text: string, opts: ThreadOptions, digits: number): ThreadPart[] {
  const maxN = Number('9'.repeat(digits))
  const fitsAt = (s: string) => countText(opts.target, compose(s, opts, maxN, maxN)).fits
  const ownHosts = ownHostsOf(opts)
  const units = splitSentences(text, { own_domains: ownHosts }).flatMap((s) => breakSentence(s, fitsAt, ownHosts))

  const bodies: Array<{ body: string; cut: Level }> = []
  let current = ''
  let currentCut: Level = 'sentence'
  const flush = () => {
    const body = current.trim()
    if (body) bodies.push({ body, cut: currentCut })
    current = ''
    currentCut = 'sentence'
  }
  for (const unit of units) {
    const candidate = current + unit.text
    if (current && !fitsAt(candidate.trim())) {
      flush()
      current = unit.text.replace(/^\s+/, '')
    } else {
      current = candidate
    }
    if (unit.level !== 'sentence') currentCut = unit.level
  }
  flush()

  const total = bodies.length
  return bodies.map(({ body, cut }, k) => {
    const composed = compose(body, opts, k + 1, total)
    return { index: k + 1, body, text: composed, count: countText(opts.target, composed), cut }
  })
}

export function splitThread(text: string, opts: ThreadOptions): ThreadResult {
  const whole = text.trim()
  const single = countText(opts.target, whole)
  if (whole === '' || single.fits) {
    const parts: ThreadPart[] =
      whole === '' ? [] : [{ index: 1, text: whole, body: whole, count: single, cut: 'sentence' }]
    return { parts, total: parts.length, fits: true, problems: [] }
  }

  let digits = 1
  let parts = pack(whole, opts, digits)
  while (String(parts.length).length > digits) {
    digits = String(parts.length).length
    parts = pack(whole, opts, digits)
  }

  const problems: ThreadProblem[] = []
  const ownHosts = ownHostsOf(opts)
  for (const p of parts) {
    if (p.count.fits) continue
    const urlOnly = /^(https?:\/\/\S+|\S+\.\S+\/\S+)$/.test(p.body) || (!/\s/.test(p.body) && holdsUrl(p.body, ownHosts))
    problems.push({
      part: p.index,
      code: urlOnly ? 'unsplittable_url' : 'part_over_limit',
      detail: urlOnly
        ? `a URL of ${p.count.count} ${p.count.unit} cannot fit ${p.count.limit}`
        : `part counts ${p.count.count} of ${p.count.limit}`,
    })
  }
  return { parts, total: parts.length, fits: problems.length === 0, problems }
}
