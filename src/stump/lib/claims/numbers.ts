// Numbers in a claim or a draft, grouped by what they measure. Counts are compared only
// with counts of the same unit ("5 minutes" with "10 minutes"); percentages, multipliers
// and money are the claim's measure and check.ts compares them across kinds. Numbers
// written in words count too: "thirty percent", "ten times faster", "in half" (50%),
// "doubles" and "twice as" (2x), "five minutes".

export type NumberKind = 'percent' | 'multiplier' | 'money' | 'count'

export interface FoundNumber {
  kind: NumberKind
  value: number
  /** Counts only: the stemmed word after the number ("minutes" -> "minute"). */
  unit: string
  /** As written in the text. */
  raw: string
  start: number
  end: number
}

const MONTHS =
  'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december'
const NOT_UNITS = new Set([
  ...MONTHS.split('|'),
  'am', 'pm', 'st', 'nd', 'rd', 'th', 'utc', 'pt', 'et', 'est', 'pst', 'edt', 'pdt',
])
const MONTH_SET = new Set(MONTHS.split('|'))
const FUNCTION_WORDS = new Set('of and or the a an to in on at for with is are was by from as it its our your their his her we you they i me us but if so than then that this these those be been'.split(' '))
const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6, b: 1e9, billion: 1e9 }

function parse(raw: string): number {
  return Number(raw.replace(/,/g, ''))
}

/** Abbreviations of one unit read as that unit: "10 min." and "10 mins" are "10 minutes". */
const UNIT_ALIASES: Record<string, string> = {
  m: 'minute', min: 'minute', mn: 'minute',
  h: 'hour', hr: 'hour', hrs: 'hour',
  sec: 'second', secs: 'second',
  ms: 'millisecond', msec: 'millisecond',
  wk: 'week', wks: 'week',
  mo: 'month', mos: 'month', mth: 'month', mths: 'month',
  yr: 'year', yrs: 'year',
}

function unitStem(w: string): string {
  let u = w.toLowerCase().replace(/\.$/, '')
  if (u.length > 3 && u.endsWith('ies')) u = `${u.slice(0, -3)}y`
  else if (u.length > 3 && u.endsWith('s') && !u.endsWith('ss')) u = u.slice(0, -1)
  return UNIT_ALIASES[u] ?? u
}

const PERCENT = /(?<![\p{L}\d]|\d[.,])(\d+(?:[.,]\d+)*)\s?(?:%|percent\b)/giu
const MULTIPLIER = /(?<![\p{L}\p{N}.])(\d+(?:\.\d+)?)\s?[x×](?![\p{L}\p{N}])/giu
const MONEY = /(?:US)?\$\s?(\d[\d,]*(?:\.\d+)?)(?:\s?(k|m|mm|b|thousand|million|billion)\b)?/giu
// The unit may follow a space, a hyphen ("a 10-minute setup") or nothing ("10min").
const COUNT = /(?<![\p{L}\p{N}.$])(\d[\d,]*(?:\.\d+)?)(?:\s?(k|m|thousand|million|billion)\b)?(?:(?:\s+|-)?([\p{L}][\p{L}'-]*))?/giud

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
}
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }
const MAGNITUDE: Record<string, number> = { hundred: 100, thousand: 1e3, million: 1e6, billion: 1e9 }
const NUMBER_WORD = `(?:${[...Object.keys(ONES), ...Object.keys(TENS), ...Object.keys(MAGNITUDE)].join('|')})`
/**
 * "thirty-five", "one hundred and twenty", "a hundred"; a leading "a" only before a magnitude.
 * A run is at most nine words, so a scan from each word start stays short on any input.
 */
const WORDS = `(?:a\\s+(?=hundred|thousand|million|billion))?${NUMBER_WORD}(?:(?:[\\s-]+|\\s+and\\s+)${NUMBER_WORD}){0,8}`
const COMPARATIVE_AFTER = '(?=\\s+(?:as|more|less|fewer|over|the|[\\p{L}]+er)\\b)'

/** The value of a run of number words, e.g. "two hundred and fifty" -> 250. */
function wordValue(raw: string): number | undefined {
  let total = 0
  let current = 0
  let any = false
  for (const w of raw.toLowerCase().split(/[\s-]+/)) {
    if (w === 'and') continue
    if (w === 'a') {
      current = 1
      continue
    }
    if (w in ONES) current += ONES[w] as number
    else if (w in TENS) current += TENS[w] as number
    else if (w === 'hundred') current = (current || 1) * 100
    else if (w in MAGNITUDE) {
      total += (current || 1) * (MAGNITUDE[w] as number)
      current = 0
    } else return undefined
    any = true
  }
  return any ? total + current : undefined
}

const WORD_PERCENT = new RegExp(`\\b(${WORDS})\\s?(?:percent|per\\s+cent)\\b`, 'giu')
const TIMES = new RegExp(`(?<![\\p{L}\\p{N}.])(\\d+(?:\\.\\d+)?|${WORDS})\\s+times\\b${COMPARATIVE_AFTER}`, 'giu')
const HALF = /\b(?:(?:in|by)\s+half|half\s+the|halves|halved|halving)\b/giu
const FOLD = new RegExp(`\\b(?:(doubles|doubled|doubling|triples|tripled|tripling|quadruples|quadrupled|quadrupling)|(double|triple|quadruple)(?=\\s+(?:the|your|its|our|their|that|this)\\b)|(twice|thrice)${COMPARATIVE_AFTER})\\b`, 'giu')
const WORD_COUNT = new RegExp(`\\b(${WORDS})\\s+([\\p{L}][\\p{L}'-]*)`, 'giu')
const FOLD_VALUE: Record<string, number> = { doub: 2, twic: 2, trip: 3, thri: 3, quad: 4 }

/**
 * NFKC form of a text ("３０％" -> "30%") with, when folding changes lengths, the offset in
 * the text of each offset in the folded form, so numbers keep the text's own offsets.
 */
function foldWithOffsets(text: string): { folded: string; at: (i: number) => number } {
  const whole = text.normalize('NFKC')
  if (whole === text) return { folded: text, at: (i) => i }
  let folded = ''
  const map: number[] = []
  let raw = 0
  for (const ch of text) {
    const f = ch.normalize('NFKC')
    for (let k = 0; k < f.length; k++) map.push(raw)
    folded += f
    raw += ch.length
  }
  map.push(raw)
  return { folded, at: (i) => map[i] ?? raw }
}

/**
 * Find the numbers in a text, with offsets into `text`. Years, clock times and dates are not
 * claims and are skipped.
 */
export function extractNumbers(text: string): FoundNumber[] {
  const { folded, at } = foldWithOffsets(text)
  const out: FoundNumber[] = []
  // One flag per UTF-16 unit: a number found by an earlier pattern keeps its span.
  const taken = new Uint8Array(folded.length + 1)
  const free = (a: number, b: number) => taken.subarray(a, b).indexOf(1) === -1
  const add = (n: FoundNumber) => {
    out.push(n)
    taken.fill(1, n.start, n.end)
  }

  for (const m of folded.matchAll(PERCENT)) {
    const start = m.index ?? 0
    add({ kind: 'percent', value: parse(m[1] as string), unit: '', raw: m[0], start, end: start + m[0].length })
  }
  for (const m of folded.matchAll(MONEY)) {
    const start = m.index ?? 0
    if (!free(start, start + m[0].length)) continue
    const scale = m[2] ? (SCALE[m[2].toLowerCase()] ?? 1) : 1
    add({ kind: 'money', value: parse(m[1] as string) * scale, unit: '', raw: m[0], start, end: start + m[0].length })
  }
  for (const m of folded.matchAll(MULTIPLIER)) {
    const start = m.index ?? 0
    if (!free(start, start + m[0].length)) continue
    add({ kind: 'multiplier', value: parse(m[1] as string), unit: '', raw: m[0], start, end: start + m[0].length })
  }
  for (const m of folded.matchAll(WORD_PERCENT)) {
    const start = m.index ?? 0
    const value = wordValue(m[1] as string)
    if (value === undefined || !free(start, start + m[0].length)) continue
    add({ kind: 'percent', value, unit: '', raw: m[0], start, end: start + m[0].length })
  }
  for (const m of folded.matchAll(HALF)) {
    const start = m.index ?? 0
    if (!free(start, start + m[0].length)) continue
    add({ kind: 'percent', value: 50, unit: '', raw: m[0], start, end: start + m[0].length })
  }
  for (const m of folded.matchAll(TIMES)) {
    const start = m.index ?? 0
    const raw = m[1] as string
    const value = /\d/.test(raw) ? parse(raw) : wordValue(raw)
    if (value === undefined || !free(start, start + m[0].length)) continue
    add({ kind: 'multiplier', value, unit: '', raw: m[0], start, end: start + m[0].length })
  }
  for (const m of folded.matchAll(FOLD)) {
    const start = m.index ?? 0
    if (!free(start, start + m[0].length)) continue
    const word = (m[1] ?? m[2] ?? m[3] ?? '').toLowerCase()
    add({ kind: 'multiplier', value: FOLD_VALUE[word.slice(0, 4)] as number, unit: '', raw: m[0], start, end: start + m[0].length })
  }
  for (const m of folded.matchAll(COUNT)) {
    const indices = (m as RegExpMatchArray & { indices: Array<[number, number] | undefined> }).indices
    const [numStart, numEnd] = indices[1] as [number, number]
    if (!free(numStart, numEnd)) continue
    // Digits inside a word are no number: "2905d0e3fe6c" is an id, while "10min" and "4k" stay counts.
    if (/^\p{L}+\p{N}/u.test(/^[\p{L}\p{N}]*/u.exec(folded.slice(numEnd))?.[0] ?? '')) continue
    const scaleWord = m[2]
    const word = m[3]
    // A month name just before ("Sep. 2026") makes it a date; the longest is "September. ".
    const before = folded.slice(Math.max(0, numStart - 16), numStart).match(/([\p{L}]+)\.?\s*$/u)?.[1]?.toLowerCase()
    if (before && MONTH_SET.has(before)) continue
    const value = parse(m[1] as string) * (scaleWord ? (SCALE[scaleWord.toLowerCase()] ?? 1) : 1)
    const stem = word ? unitStem(word) : ''
    const wordIsUnit = stem !== '' && !NOT_UNITS.has(stem) && !FUNCTION_WORDS.has(stem)
    if (word && NOT_UNITS.has(stem)) continue
    const isYear = Number.isInteger(value) && value >= 1900 && value <= 2100 && !scaleWord
    if (isYear && !wordIsUnit) continue
    const end = wordIsUnit ? (indices[3] as [number, number])[1] : indices[2] ? (indices[2] as [number, number])[1] : numEnd
    add({ kind: 'count', value, unit: wordIsUnit ? stem : '', raw: folded.slice(numStart, end), start: numStart, end })
  }
  for (const m of folded.matchAll(WORD_COUNT)) {
    const start = m.index ?? 0
    const value = wordValue(m[1] as string)
    const stem = unitStem(m[2] as string)
    if (value === undefined || NOT_UNITS.has(stem) || FUNCTION_WORDS.has(stem) || !free(start, start + m[0].length)) continue
    add({ kind: 'count', value, unit: stem, raw: m[0], start, end: start + m[0].length })
  }
  return out.sort((a, b) => a.start - b.start).map((n) => ({ ...n, start: at(n.start), end: at(n.end) }))
}

/**
 * Remove number spans from a text (used before tokenising for word matching). A count keeps the
 * word it counts: "a month rota for 20 staff in 10 minutes" reads as "a month rota for staff in
 * minutes", so a sentence that counts the same things in other numbers is still the claim's, and
 * its numbers are then compared with the claim's and its proof's.
 */
export function stripNumbers(text: string, numbers: readonly FoundNumber[]): string {
  let out = ''
  let cursor = 0
  for (const n of numbers) {
    out += `${text.slice(cursor, n.start)} ${n.kind === 'count' && n.unit ? `${n.unit} ` : ''}`
    cursor = n.end
  }
  return out + text.slice(cursor)
}
