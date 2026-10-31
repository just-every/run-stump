/**
 * Term logic for watches (STUMP-WATCH-004.1): `all` terms must each appear, at least one `any` term
 * must appear when any are given, and no `none` term may appear. A term with spaces is an exact
 * phrase. Matching is whole-word, case-insensitive and Unicode-aware, so "orbit" does not match
 * "orbital" and "Ünïcode" matches "ünïcode". CJK and Thai terms match inside runs of text because
 * those scripts do not separate words with spaces.
 *
 * A single-word `none` term also keeps out the word's other forms, since it names a topic to leave
 * out: "hiring" keeps out "hire", "hires", "hired" and "hirer" too. `all` and `any` terms match as
 * written. A term given as `{ text, match_case: true }` (a product name that is also an everyday
 * word, such as "Rota") matches only with the capitals it is written with.
 *
 * Sources that search remotely (HN's Algolia index, Bluesky) are fuzzy, so every candidate is
 * re-checked here before it becomes a finding.
 */

/** A term that matches only with its own capitals: "Rota" and never "a month rota". */
export interface CasedTerm {
  text: string
  match_case: true
}
export type TermInput = string | CasedTerm

export interface TermLogic {
  all?: TermInput[]
  any?: TermInput[]
  none?: TermInput[]
}

interface CompiledTerm {
  text: string
  re: RegExp
  /** Matched against the text with its capitals kept. */
  cased: boolean
}

export interface CompiledTerms {
  compiled: true
  all: CompiledTerm[]
  any: CompiledTerm[]
  none: CompiledTerm[]
}

export type Area = 'title' | 'text' | 'links' | 'transcript'
export type Haystack = Partial<Record<Area, string>>

export interface TermMatch {
  matches: boolean
  /** True when the watch has no `all` or `any` terms (a feed watch of every item). */
  unconstrained: boolean
  /** The `all` and `any` terms that were found, as the person wrote them. */
  matched_terms: string[]
  /** `all` terms not found. */
  missing_all: string[]
  /** `none` terms that were found. */
  excluded_by: string[]
  /** Areas holding at least one matched term. */
  matched_in: Area[]
}

export class TermError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TermError'
  }
}

const MAX_TERMS = 60
const MAX_TERM_LENGTH = 200
const WORD = '\\p{L}\\p{N}\\p{M}_'
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}]/u

export function normalizeForMatch(s: string): string {
  return normalizeCased(s).toLowerCase()
}

/** The text as normalizeForMatch reads it, with its capitals kept. */
function normalizeCased(s: string): string {
  return s.normalize('NFKC').replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"')
}

function cleanTerm(raw: string): string {
  return raw.trim().replace(/^["'“‘]+|["'”’]+$/g, '').replace(/\s+/g, ' ').trim()
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&')
}

/** A lower-case word of Latin letters, the only kind whose other forms are spelled by rule here. */
const PLAIN_WORD = /^[a-z]{3,}$/

/**
 * A word and its regular other forms: "hire" -> hire, hires, hired, hiring, hirer, hirers; "hiring" and
 * "hired" -> the same. A stem cut from "-ing" or "-ed" is never a form on its own, so "evening" keeps out
 * "evenings" and never "even". A plural of five letters or more stands for its singular ("bills" -> "bill").
 */
export function wordForms(word: string): string[] {
  const forms = new Set<string>([word])
  const consonant = (c: string | undefined) => c !== undefined && !'aeiou'.includes(c)
  /** Forms built on a stem: a suffix always follows it, and an "e" the stem dropped comes back. */
  const onStem = (stem: string) => {
    for (const end of ['e', 'es', 'ed', 'ing', 'er', 'ers']) forms.add(stem + end)
    const last = stem[stem.length - 1]
    // "stopp" (from "stopping") is "stop" with its last letter doubled.
    if (stem.length >= 4 && last === stem[stem.length - 2] && consonant(last)) onBase(stem.slice(0, -1))
  }
  /** Forms of a word as it stands. */
  const onBase = (base: string) => {
    forms.add(base)
    if (base.endsWith('e')) for (const end of ['s', 'd', 'r', 'rs']) forms.add(base + end)
    else for (const end of ['s', 'es', 'ed', 'er', 'ers']) forms.add(base + end)
    const stem = base.endsWith('e') ? base.slice(0, -1) : base
    forms.add(`${stem}ing`)
    if (base.endsWith('y') && consonant(base[base.length - 2])) for (const end of ['ies', 'ied', 'ier', 'iers']) forms.add(base.slice(0, -1) + end)
  }
  if (word.length > 5 && word.endsWith('ing')) onStem(word.slice(0, -3))
  else if (word.length > 4 && word.endsWith('ied')) onBase(`${word.slice(0, -3)}y`)
  else if (word.length > 4 && word.endsWith('ed')) onStem(word.slice(0, -2))
  else if (word.length > 4 && word.endsWith('ies')) onBase(`${word.slice(0, -3)}y`)
  else if (word.length >= 5 && word.endsWith('s') && !word.endsWith('ss')) onBase(word.slice(0, -1))
  else onBase(word)
  // The word's own plural: "evenings" for "evening".
  if (!word.endsWith('s')) forms.add(`${word}s`)
  return [...forms]
}

function compileOne(text: string, options: { cased?: boolean; forms?: boolean } = {}): CompiledTerm {
  const cased = options.cased === true
  const norm = cased ? normalizeCased(text) : normalizeForMatch(text)
  const chars = [...norm]
  const first = chars[0]
  const last = chars[chars.length - 1]
  const startsWord = new RegExp(`[${WORD}]`, 'u').test(first) && !UNSPACED.test(first)
  const endsWord = new RegExp(`[${WORD}]`, 'u').test(last) && !UNSPACED.test(last)
  const body = options.forms && !cased && PLAIN_WORD.test(norm)
    ? `(?:${wordForms(norm).sort((a, b) => b.length - a.length).join('|')})`
    : norm.split(' ').map(escapeRegExp).join('\\s+')
  const re = new RegExp(`${startsWord ? `(?<![${WORD}])` : ''}${body}${endsWord ? `(?![${WORD}])` : ''}`, 'u')
  return { text, re, cased }
}

function compileList(list: TermInput[] | undefined, label: string, forms = false): CompiledTerm[] {
  const seen = new Set<string>()
  const out: CompiledTerm[] = []
  for (const raw of list ?? []) {
    const cased = typeof raw === 'object' && raw !== null && raw.match_case === true
    const value = typeof raw === 'string' ? raw : cased ? raw.text : undefined
    if (typeof value !== 'string') throw new TermError(`A ${label} term is not text`)
    const t = cleanTerm(value)
    if (!t) continue
    if (t.length > MAX_TERM_LENGTH) throw new TermError(`A ${label} term is longer than ${MAX_TERM_LENGTH} characters`)
    const key = `${cased ? 'cased:' : ''}${cased ? normalizeCased(t) : normalizeForMatch(t)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(compileOne(t, { cased, forms }))
  }
  return out
}

export function compileTerms(logic: TermLogic | CompiledTerms): CompiledTerms {
  if ('compiled' in logic && logic.compiled === true) return logic
  const l = logic as TermLogic
  const compiled: CompiledTerms = { compiled: true, all: compileList(l.all, 'all-of'), any: compileList(l.any, 'any-of'), none: compileList(l.none, 'none-of', true) }
  if (compiled.all.length + compiled.any.length + compiled.none.length > MAX_TERMS) {
    throw new TermError(`A watch holds at most ${MAX_TERMS} terms`)
  }
  return compiled
}

export function hasPositiveTerms(t: CompiledTerms): boolean {
  return t.all.length + t.any.length > 0
}

const SEP = '\n⁣\n'

/** Test one finding's text areas against the term logic. */
export function matchTerms(terms: CompiledTerms, hay: Haystack): TermMatch {
  const areas = (['title', 'text', 'links', 'transcript'] as Area[]).filter((a) => hay[a])
  const cased: Partial<Record<Area, string>> = {}
  const normalized: Partial<Record<Area, string>> = {}
  for (const a of areas) {
    cased[a] = normalizeCased(hay[a] as string)
    normalized[a] = (cased[a] as string).toLowerCase()
  }
  const whole = areas.map((a) => normalized[a]).join(SEP)
  const wholeCased = areas.map((a) => cased[a]).join(SEP)
  const found = (t: CompiledTerm) => t.re.test(t.cased ? wholeCased : whole)

  const allFound = terms.all.filter(found)
  const missing = terms.all.filter((t) => !allFound.includes(t))
  const anyFound = terms.any.filter(found)
  const noneFound = terms.none.filter(found)
  const unconstrained = !hasPositiveTerms(terms)
  const matched = [...allFound, ...anyFound]
  const matched_in = areas.filter((a) => matched.some((t) => t.re.test((t.cased ? cased[a] : normalized[a]) as string)))

  const matches = missing.length === 0 && (terms.any.length === 0 || anyFound.length > 0) && noneFound.length === 0
  return {
    matches,
    unconstrained,
    matched_terms: matched.map((t) => t.text),
    missing_all: missing.map((t) => t.text),
    excluded_by: noneFound.map((t) => t.text),
    matched_in,
  }
}

/**
 * Short passages of `text` around the first place each matched term appears, in the order the terms
 * matched, overlapping passages merged. Used to keep what a podcast transcript matched on, since the
 * transcript itself is not stored.
 */
export function matchExcerpts(terms: CompiledTerms, text: string, max = 4, radius = 90): string[] {
  const kept = normalizeCased(text)
  const norm = kept.toLowerCase()
  // NFKC can change lengths; slice the original only when offsets still line up.
  const shown = norm.length === text.length ? text : norm
  const spans: Array<[number, number]> = []
  for (const t of [...terms.all, ...terms.any]) {
    const hit = t.re.exec(t.cased ? kept : norm)
    if (!hit) continue
    let start = Math.max(0, hit.index - radius)
    let end = Math.min(shown.length, hit.index + hit[0].length + radius)
    const space = shown.lastIndexOf(' ', start)
    if (start > 0 && space >= 0 && hit.index - space < radius + 20) start = space + 1
    const after = shown.indexOf(' ', end)
    if (end < shown.length && after >= 0 && after - hit.index < radius * 2) end = after
    const overlapping = spans.find(([a, b]) => start <= b && end >= a)
    if (overlapping) { overlapping[0] = Math.min(overlapping[0], start); overlapping[1] = Math.max(overlapping[1], end) }
    else spans.push([start, end])
    if (spans.length >= max) break
  }
  return spans.map(([a, b]) => `${a > 0 ? '…' : ''}${shown.slice(a, b).replace(/\s+/g, ' ').trim()}${b < shown.length ? '…' : ''}`)
}

/**
 * Search strings for a remote index: one query per `any` term joined with every `all` term, or a
 * single query of the `all` terms. Phrases are quoted. Remote results are candidates only.
 */
export function remoteQueries(terms: CompiledTerms): string[] {
  const q = (t: CompiledTerm) => (t.text.includes(' ') ? `"${t.text.replace(/"/g, '')}"` : t.text)
  const base = terms.all.map(q)
  if (terms.any.length === 0) return base.length ? [base.join(' ')] : []
  return terms.any.map((a) => [q(a), ...base].join(' '))
}
