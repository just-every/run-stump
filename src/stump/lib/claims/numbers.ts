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

function unitStem(w: string): string {
  let u = w.toLowerCase()
  if (u.length > 3 && u.endsWith('ies')) u = `${u.slice(0, -3)}y`
  else if (u.length > 3 && u.endsWith('s') && !u.endsWith('ss')) u = u.slice(0, -1)
  return u
}

const PERCENT = /(\d+(?:[.,]\d+)*)\s?(?:%|percent\b)/giu
const MULTIPLIER = /(?<![\p{L}\p{N}.])(\d+(?:\.\d+)?)\s?[x×](?![\p{L}\p{N}])/giu
const MONEY = /(?:US)?\$\s?(\d[\d,]*(?:\.\d+)?)(?:\s?(k|m|mm|b|thousand|million|billion)\b)?/giu
const COUNT = /(?<![\p{L}\p{N}.$])(\d[\d,]*(?:\.\d+)?)(?:\s?(k|m|thousand|million|billion)\b)?(?:\s+([\p{L}][\p{L}'-]*))?/giud

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
}
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }
const MAGNITUDE: Record<string, number> = { hundred: 100, thousand: 1e3, million: 1e6, billion: 1e9 }
const NUMBER_WORD = `(?:${[...Object.keys(ONES), ...Object.keys(TENS), ...Object.keys(MAGNITUDE)].join('|')})`
/** "thirty-five", "one hundred and twenty", "a hundred"; a leading "a" only before a magnitude. */
const WORDS = `(?:a\\s+(?=hundred|thousand|million|billion))?${NUMBER_WORD}(?:(?:[\\s-]+|\\s+and\\s+)${NUMBER_WORD})*`
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

/** Find the numbers in a text. Years, clock times and dates are not claims and are skipped. */
export function extractNumbers(text: string): FoundNumber[] {
  const folded = text.normalize('NFKC')
  const out: FoundNumber[] = []
  const taken: Array<[number, number]> = []
  const free = (a: number, b: number) => !taken.some(([s, e]) => a < e && b > s)
  const add = (n: FoundNumber) => {
    out.push(n)
    taken.push([n.start, n.end])
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
    const scaleWord = m[2]
    const word = m[3]
    const before = folded.slice(0, numStart).match(/([\p{L}]+)\.?\s*$/u)?.[1]?.toLowerCase()
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
  return out.sort((a, b) => a.start - b.start)
}

/** Remove number spans from a text (used before tokenising for word matching). */
export function stripNumbers(text: string, numbers: readonly FoundNumber[]): string {
  const folded = text.normalize('NFKC')
  let out = ''
  let cursor = 0
  for (const n of numbers) {
    out += `${folded.slice(cursor, n.start)} `
    cursor = n.end
  }
  return out + folded.slice(cursor)
}
