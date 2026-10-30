/**
 * Term logic for watches (STUMP-WATCH-004.1): `all` terms must each appear, at least one `any` term
 * must appear when any are given, and no `none` term may appear. A term with spaces is an exact
 * phrase. Matching is whole-word, case-insensitive and Unicode-aware, so "orbit" does not match
 * "orbital" and "Ünïcode" matches "ünïcode". CJK and Thai terms match inside runs of text because
 * those scripts do not separate words with spaces.
 *
 * Sources that search remotely (HN's Algolia index, Bluesky) are fuzzy, so every candidate is
 * re-checked here before it becomes a finding.
 */

export interface TermLogic {
  all?: string[]
  any?: string[]
  none?: string[]
}

interface CompiledTerm {
  text: string
  re: RegExp
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
  return s.normalize('NFKC').toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"')
}

function cleanTerm(raw: string): string {
  return raw.trim().replace(/^["'“‘]+|["'”’]+$/g, '').replace(/\s+/g, ' ').trim()
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&')
}

function compileOne(text: string): CompiledTerm {
  const norm = normalizeForMatch(text)
  const chars = [...norm]
  const first = chars[0]
  const last = chars[chars.length - 1]
  const startsWord = new RegExp(`[${WORD}]`, 'u').test(first) && !UNSPACED.test(first)
  const endsWord = new RegExp(`[${WORD}]`, 'u').test(last) && !UNSPACED.test(last)
  const body = norm.split(' ').map(escapeRegExp).join('\\s+')
  const re = new RegExp(`${startsWord ? `(?<![${WORD}])` : ''}${body}${endsWord ? `(?![${WORD}])` : ''}`, 'u')
  return { text, re }
}

function compileList(list: string[] | undefined, label: string): CompiledTerm[] {
  const seen = new Set<string>()
  const out: CompiledTerm[] = []
  for (const raw of list ?? []) {
    if (typeof raw !== 'string') throw new TermError(`A ${label} term is not text`)
    const t = cleanTerm(raw)
    if (!t) continue
    if (t.length > MAX_TERM_LENGTH) throw new TermError(`A ${label} term is longer than ${MAX_TERM_LENGTH} characters`)
    const key = normalizeForMatch(t)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(compileOne(t))
  }
  return out
}

export function compileTerms(logic: TermLogic | CompiledTerms): CompiledTerms {
  if ('compiled' in logic && logic.compiled === true) return logic
  const l = logic as TermLogic
  const compiled: CompiledTerms = { compiled: true, all: compileList(l.all, 'all-of'), any: compileList(l.any, 'any-of'), none: compileList(l.none, 'none-of') }
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
  const normalized: Partial<Record<Area, string>> = {}
  for (const a of areas) normalized[a] = normalizeForMatch(hay[a] as string)
  const whole = areas.map((a) => normalized[a]).join(SEP)
  const found = (t: CompiledTerm) => t.re.test(whole)

  const allFound = terms.all.filter(found)
  const missing = terms.all.filter((t) => !allFound.includes(t))
  const anyFound = terms.any.filter(found)
  const noneFound = terms.none.filter(found)
  const unconstrained = !hasPositiveTerms(terms)
  const matched = [...allFound, ...anyFound]
  const matched_in = areas.filter((a) => matched.some((t) => t.re.test(normalized[a] as string)))

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
 * Search strings for a remote index: one query per `any` term joined with every `all` term, or a
 * single query of the `all` terms. Phrases are quoted. Remote results are candidates only.
 */
export function remoteQueries(terms: CompiledTerms): string[] {
  const q = (t: CompiledTerm) => (t.text.includes(' ') ? `"${t.text.replace(/"/g, '')}"` : t.text)
  const base = terms.all.map(q)
  if (terms.any.length === 0) return base.length ? [base.join(' ')] : []
  return terms.any.map((a) => [q(a), ...base].join(' '))
}
