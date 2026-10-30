// Numbers in a claim or a draft, grouped by what they measure, so that "30%" is only
// compared with other percentages and "5 minutes" with other counts of minutes.

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
