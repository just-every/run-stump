// Split a long text into a thread at sentence boundaries.
//
// Sentences come from Intl.Segmenter (Unicode UAX #29 sentence boundaries), so
// "example.com/page" and "v2.1" do not split. Parts are packed greedily and each
// is counted with the network's own rule (count.ts), numbering included. A single
// sentence that does not fit on its own is broken at a clause mark, then a word,
// then a grapheme, in that order, and the result says so. A URL is never cut:
// one that cannot fit is reported as a problem on its part.

import { splitGraphemes, splitSentences } from './graphemes'
import { countText } from './count'
import type { CountTarget, TextCount } from './types'

export type NumberingFormat = 'n/N' | 'n/' | '(n/N)'

export interface ThreadOptions {
  target: CountTarget
  /** Number the parts. A text that fits one post is never numbered. */
  numbering?: { format: NumberingFormat; position?: 'start' | 'end' }
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

function breakSentence(sentence: string, fits: (s: string) => boolean): Unit[] {
  if (fits(sentence.trim())) return [{ text: sentence, level: 'sentence' }]
  const clauses = sentence.split(/(?<=[,;:—–])(?=\s)/u)
  if (clauses.length > 1) {
    return clauses.flatMap((c) => (fits(c.trim()) ? [{ text: c, level: 'clause' as Level }] : breakWords(c, fits)))
  }
  return breakWords(sentence, fits)
}

function breakWords(text: string, fits: (s: string) => boolean): Unit[] {
  const words = text.split(/(?<=\s)(?=\S)/u)
  const out: Unit[] = []
  for (const w of words) {
    if (fits(w.trim())) {
      out.push({ text: w, level: 'word' })
      continue
    }
    if (/^https?:\/\//i.test(w.trim()) || /^[^\s/]+\.[^\s/]+\/\S/.test(w.trim())) {
      out.push({ text: w, level: 'word' }) // reported as unsplittable_url by the packer
      continue
    }
    let piece = ''
    for (const g of splitGraphemes(w)) {
      if (piece && !fits((piece + g).trim())) {
        out.push({ text: piece, level: 'grapheme' })
        piece = g
      } else piece += g
    }
    if (piece) out.push({ text: piece, level: 'grapheme' })
  }
  return out
}

function pack(text: string, opts: ThreadOptions, digits: number): ThreadPart[] {
  const maxN = Number('9'.repeat(digits))
  const fitsAt = (s: string) => countText(opts.target, compose(s, opts, maxN, maxN)).fits
  const units = splitSentences(text).flatMap((s) => breakSentence(s, fitsAt))

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
  for (const p of parts) {
    if (p.count.fits) continue
    const urlOnly = /^(https?:\/\/\S+|\S+\.\S+\/\S+)$/.test(p.body)
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
