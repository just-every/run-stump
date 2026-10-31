// The claim check of a draft against the company's claims (STUMP-BRAND-004).
//
// A sentence can make several claims ("Orbit syncs with Slack, cuts triage time by 80%
// and has zero downtime"), so each sentence is read clause by clause: it is split at
// ';', a colon, commas and the conjunctions 'and' and 'but', a condition ("when a client
// is late, ...") stays with the clause it conditions, and a clause that names no product
// takes the sentence's subject. A clause is matched to the company's claims by the
// content words it shares with a claim, both ways: a claim is matched when at least three
// quarters of its content words appear (two or fewer must all appear), or when at least
// three quarters of the clause's own content words, two or more and not counting a link,
// are the claim's and every guarantee, superlative, compliance or comparison phrase the
// clause has is the claim's too; clauses that match nothing on their own are joined when
// together they match a claim whose wording spans them. The result for each clause is one of:
//   matched          a current claim covers it
//   banned           a claim the company must not make
//   number_mismatch  it matches a claim but states another number than the claim's or
//                    its proof's (a percent, multiplier or price in any form: "2x" or
//                    "in half" against a proven 30% is a mismatch), or a percent,
//                    multiplier or price where the claim and its proof state none
//                    ("50% cheaper" against "cheaper than HubSpot"; expected is empty).
//                    A proof's numbers come from its number, its text, or a plain-string
//                    proof that is not a link; a unitless proof number backs a percent or
//                    multiplier of that value.
//   stale            it matches a claim past its review date
//   unmatched        it reads as a factual claim (extract.ts) but no claim covers it
// A sentence that names no product is about the product named before it in the draft, or
// the draft's own product: "It also syncs with Stripe now" and "Now you can edit each
// reminder" state what the product does, whether or not they name it. A link after a
// sentence's end is a piece of its own, never part of the claim before it.
// Priority when several apply: banned, number_mismatch, stale, matched. A person and an
// agent submitting the same draft get the same result: the check reads only the text,
// the claims, the profiles and today's date.

import { readSentence, strongPhrases } from './extract'
import type { ClaimCandidate } from './extract'
import { extractMentions, hostOfUrl } from './mentions'
import type { MentionSet } from './mentions'
import { extractNumbers, stripNumbers } from './numbers'
import type { FoundNumber } from './numbers'
import { contentTokens, foldText, sentenceSpans } from './sentences'
import { extractUrls } from '../text/urls'
import type { Span } from './sentences'
import type { Claim, ClaimFinding, PersonProfile, ProductProfile } from './types'
import { assertToday, claimStaleness, hasProof, isIsoDate } from './validate'

export interface CheckClaimsInput {
  text: string
  claims: readonly Claim[]
  products?: readonly ProductProfile[]
  people?: readonly PersonProfile[]
  company_names?: readonly string[]
  /** The item's product; company-wide and this product's claims apply (banned claims always do). */
  product_id?: string
  /** YYYY-MM-DD, the date in the company's time zone; anything else throws a RangeError. */
  today: string
}

export type ClaimFlagCode = 'claim_banned' | 'claim_unmatched' | 'claim_stale' | 'claim_number_mismatch' | 'avoid_word'

export interface ClaimFlag {
  code: ClaimFlagCode
  claim_id?: string
  text: string
  start: number
  end: number
  /** The proof's numbers, for claim_number_mismatch. */
  expected?: string[]
  reason?: string
}

export interface CheckClaimsResult {
  /** Every claim in the draft is matched and no avoided word is used. */
  passed: boolean
  claims: ClaimFinding[]
  mentions: MentionSet
  flags: ClaimFlag[]
}

/** A claim record with what backs it: banned claims always; others only with their proof or a named competitor and dated source. */
export function isBackedRecord(claim: Claim): boolean {
  if (!claim.text || claim.text.trim() === '') return false
  if (claim.kind === 'banned') return true
  if (claim.kind === 'allowed') return hasProof(claim.proof)
  return Boolean(claim.competitor && claim.source_url && isIsoDate(claim.source_date))
}

/**
 * A claim record the check can match against: banned claims always; others only when backed
 * (isBackedRecord) and carrying a valid YYYY-MM-DD review date. A claim whose review date is
 * missing or malformed ("01/01/2026", "2026-1-1", a timestamp) can never be shown current,
 * so it backs no draft: the check reads its sentence as unmatched.
 */
export function isCurrentRecord(claim: Claim): boolean {
  return isBackedRecord(claim) && (claim.kind === 'banned' || isIsoDate(claim.review_on))
}

/** A proof number with no unit ({ number: 30 }) stands for the claim's measure: it backs 30% or 30x. */
type Expected = FoundNumber & { unitless?: boolean }

interface Prepared {
  claim: Claim
  phrases: Array<{ tokens: Set<string>; numbers: FoundNumber[]; words: string }>
  proofNumbers: Expected[]
}

const BARE_NUMBER = /^\s*[+-]?(?:\d[\d,]*(?:\.\d+)?|\.\d+)\s*$/
// A link: a scheme or www., or a host whose last label starts with a letter ("orbit.run/bench", never "1.5x").
const LINK = /^\s*(?:[a-z][a-z\d+.-]*:\/\/|www\.)\S*\s*$|^\s*(?:[\p{L}\p{N}-]+\.)+\p{L}[\p{L}\p{N}-]*(?:[/?#]\S*)?\s*$/iu

/** The numbers a proof states: a plain number, a number written in a sentence, never the digits of a link. */
function proofNumbersOf(value: string | number | undefined): Expected[] {
  if (value === undefined || value === null) return []
  const text = String(value)
  if (text.trim() === '' || LINK.test(text)) return []
  if (BARE_NUMBER.test(text)) {
    const value = Number(text.trim().replace(/,/g, ''))
    return Number.isFinite(value) ? [{ kind: 'count', value, unit: '', raw: text.trim(), start: 0, end: text.length, unitless: true }] : []
  }
  // In prose a unitless count is a date part or an ordinal, not the claim's number.
  return extractNumbers(text).filter((n) => n.kind !== 'count' || n.unit !== '')
}

function prepare(claim: Claim): Prepared {
  const phrases = [claim.text, ...(claim.aliases ?? [])].map((p) => {
    const numbers = extractNumbers(p)
    return { tokens: new Set(contentTokens(stripNumbers(p, numbers))), numbers, words: wordsOf(p) }
  })
  const proof = claim.proof
  const proofNumbers =
    typeof proof === 'string'
      ? proofNumbersOf(proof)
      : proof
        ? [...proofNumbersOf(proof.number), ...proofNumbersOf(proof.text)]
        : []
  return { claim, phrases, proofNumbers }
}

/** How much of the claim's wording the text says: the share of the claim's content words it covers. */
function containment(claimTokens: Set<string>, sentenceTokens: Set<string>): number {
  if (claimTokens.size === 0) return 0
  let shared = 0
  for (const t of claimTokens) if (sentenceTokens.has(t)) shared++
  if (claimTokens.size <= 2) return shared === claimTokens.size ? 1 : 0
  return shared >= 2 ? shared / claimTokens.size : 0
}

/**
 * How much of the text the claim says: the share of the text's own content words that are
 * the claim's, counted only when at least two are shared. A sentence that says the core of
 * a longer claim ("Orbit cuts triage time" against "Orbit cuts triage time by 30% for
 * support teams") is the claim, though it covers too little of the claim's wording.
 */
function containedIn(claimTokens: Set<string>, sentenceTokens: Set<string>): number {
  if (sentenceTokens.size < 2) return 0
  let shared = 0
  for (const t of sentenceTokens) if (claimTokens.has(t)) shared++
  return shared >= 2 ? shared / sentenceTokens.size : 0
}

/** A text's words, folded and space-joined with a space at each end, for finding a phrase as whole words. */
function wordsOf(text: string): string {
  return ` ${(foldText(text).match(/[\p{L}\p{N}]+/gu) ?? []).join(' ')} `
}

const MATCH_THRESHOLD = 0.75

function sameUnit(a: FoundNumber, b: FoundNumber): boolean {
  return a.kind === 'count' && b.kind === 'count' && a.unit !== '' && a.unit === b.unit
}

const isRatio = (n: FoundNumber) => n.kind === 'percent' || n.kind === 'multiplier'
const equal = (a: FoundNumber, b: FoundNumber) => a.kind === b.kind && a.value === b.value && (a.kind !== 'count' || a.unit === b.unit)
/** A draft's percent or multiplier against an expected one: across kinds never equal, a unitless proof number by value. */
const backs = (e: Expected, f: FoundNumber) => equal(f, e) || (e.unitless === true && isRatio(f) && e.value === f.value)

type Conflict = { expected: FoundNumber[]; found: FoundNumber[] }

/**
 * Numbers the draft states for a claim when none of them is the claim's or its proof's.
 * Ratios (percent and multiplier) are compared across kinds, "2x" against a proven 30% is
 * a mismatch, and a unitless proof number backs a percent or multiplier of the same value.
 * Money is compared with money, and counts within one unit. A ratio or a price the claim
 * and its proof state none of is unbacked: a mismatch with nothing expected.
 */
function numberConflict(claimNumbers: readonly FoundNumber[], proofNumbers: readonly Expected[], clauseNumbers: readonly FoundNumber[]): Conflict | undefined {
  const expectedAll: Expected[] = [...claimNumbers, ...proofNumbers]
  const conflicts: Conflict = { expected: [], found: [] }

  const measures: Array<[(n: FoundNumber) => boolean, (e: Expected) => boolean]> = [
    [isRatio, (e) => isRatio(e) || e.unitless === true],
    [(n) => n.kind === 'money', (e) => e.kind === 'money'],
  ]
  for (const [stated, expects] of measures) {
    const found = clauseNumbers.filter(stated)
    if (found.length === 0) continue
    const expected = expectedAll.filter(expects)
    if (found.some((f) => expected.some((e) => backs(e, f)))) continue
    conflicts.expected.push(...expected)
    conflicts.found.push(...found)
  }

  const units = new Set(clauseNumbers.filter((n) => n.kind === 'count' && n.unit !== '').map((n) => n.unit))
  for (const unit of units) {
    const found = clauseNumbers.filter((n) => n.kind === 'count' && n.unit === unit)
    const expected = expectedAll.filter((e) => found.some((f) => sameUnit(f, e)))
    if (expected.length === 0) continue
    if (!found.some((f) => expected.some((e) => equal(f, e)))) {
      conflicts.expected.push(...expected)
      conflicts.found.push(...found)
    }
  }
  return conflicts.found.length > 0 ? conflicts : undefined
}

const label = (n: FoundNumber) => n.raw.trim()

/** The text with every link blanked to spaces (offsets kept): a link's host and path are not words the sentence says. */
function blankUrls(text: string, ownHosts: readonly string[]): string {
  let out = ''
  let cursor = 0
  for (const u of extractUrls(text, { extraBareHosts: ownHosts })) {
    out += text.slice(cursor, u.start) + ' '.repeat(u.end - u.start)
    cursor = u.end
  }
  return out + text.slice(cursor)
}

function relevant(claims: readonly Claim[], productId: string | undefined): Claim[] {
  return claims.filter((c) => {
    if (!isCurrentRecord(c)) return false
    if (!productId || !c.product_id || c.product_id === productId) return true
    return c.kind === 'banned'
  })
}

type Hit = { p: Prepared; score: number; conflict?: Conflict }
type Unit = Span & { candidate?: ClaimCandidate; banned?: Hit; best?: Hit }

const MIN_CLAUSE_WORDS = 3
// A lead-in ends at a colon ("New in Orbit 2.4: ..."), as a clause ends at ';', a comma, 'and' or 'but'.
const CLAUSE_BREAK = /[;:]\s+|,\s+(?:(?:and|but)\s+)?|\s+(?:and|but)\s+/giu
/** A piece that opens with a subordinating word ("when a client is late") is a condition of the clause beside it, not a statement of its own. */
const SUBORDINATE = /^(?:when|whenever|if|once|after|before|until|unless|while|as soon as|because|since|so that)\b/iu

/**
 * A sentence's clauses, with offsets into the draft. A piece of fewer than three words
 * ("Slack, Teams and Discord") stays with the clause before it, and a break inside a
 * number ("one hundred and twenty percent") is not a break.
 */
function clauseSpans(span: Span, numbers: readonly FoundNumber[]): Span[] {
  const pieces: Array<{ start: number; end: number }> = []
  let n = 0
  const insideNumber = (at: number) => {
    while (n < numbers.length && (numbers[n] as FoundNumber).end <= at) n++
    const next = numbers[n]
    return next !== undefined && next.start < at
  }
  const words = (from: number, to: number) => span.text.slice(from, to).match(/[\p{L}\p{N}]+/gu)?.length ?? 0
  let cursor = 0
  const push = (from: number, to: number) => {
    const raw = span.text.slice(from, to)
    const text = raw.trim()
    if (text === '') return
    const start = from + (raw.length - raw.trimStart().length)
    const end = start + text.length
    const last = pieces[pieces.length - 1]
    if (last && words(start, end) < MIN_CLAUSE_WORDS) last.end = end
    else pieces.push({ start, end })
  }
  for (const m of span.text.matchAll(CLAUSE_BREAK)) {
    const at = m.index ?? 0
    if (insideNumber(at)) continue
    push(cursor, at)
    cursor = at + m[0].length
  }
  push(cursor, span.text.length)
  const first = pieces[0]
  if (first && pieces.length > 1 && words(first.start, first.end) < MIN_CLAUSE_WORDS) {
    first.end = (pieces[1] as { end: number }).end
    pieces.splice(1, 1)
  }
  // A condition joins the clause it conditions: the one after it, or the one before when it comes last.
  for (let k = 0; k < pieces.length; k++) {
    const piece = pieces[k] as { start: number; end: number }
    if (pieces.length < 2 || !SUBORDINATE.test(span.text.slice(piece.start, piece.end))) continue
    if (k + 1 < pieces.length) {
      piece.end = (pieces[k + 1] as { end: number }).end
      pieces.splice(k + 1, 1)
    } else {
      (pieces[k - 1] as { end: number }).end = piece.end
      pieces.splice(k, 1)
    }
  }
  return pieces.map((p) => ({ text: span.text.slice(p.start, p.end), start: span.start + p.start, end: span.start + p.end }))
}

/** Ends a sentence before a link: ". ", "! " or "? ", with a closing quote or bracket. */
const SENTENCE_END = /[.!?\u2026]["'\u201d\u2019)\]]*\s+$/u

/**
 * The draft's sentences as the claim check reads them. A link that follows a sentence's end
 * ("... with Stripe now. https://...") starts a piece of its own: it is not part of the claim
 * before it, though the sentence splitter keeps text that starts in lower case with the
 * sentence before.
 */
function claimSentences(text: string, ownHosts: readonly string[]): Span[] {
  const out: Span[] = []
  for (const span of sentenceSpans(text, ownHosts)) {
    let from = 0
    for (const link of extractUrls(span.text, { extraBareHosts: ownHosts })) {
      const before = span.text.slice(from, link.start)
      if (link.start <= from || !SENTENCE_END.test(before)) continue
      const head = before.trimEnd()
      out.push({ text: head, start: span.start + from, end: span.start + from + head.length })
      from = link.start
    }
    out.push({ text: span.text.slice(from), start: span.start + from, end: span.end })
  }
  return out
}

/** At most this many clauses after a clause are joined with it to match one claim. */
const JOIN_WINDOW = 6

export function checkClaims(input: CheckClaimsInput): CheckClaimsResult {
  assertToday(input.today)
  const prepared = relevant(input.claims, input.product_id).map(prepare)
  const mentionInput = { products: input.products, people: input.people, company_names: input.company_names }
  const mentions = extractMentions(input.text, mentionInput)
  const productNames = (input.products ?? []).flatMap((p) => [p.name, ...(p.other_names ?? [])])
  const competitorNames = (input.products ?? []).flatMap((p) => (p.competitors ?? []).flatMap((c) => (typeof c === 'string' ? [c] : [c.name, ...(c.aliases ?? [])])))
  const ownHosts = [...new Set((input.products ?? []).flatMap((p) => (p.urls ?? []).map(hostOfUrl)).filter(Boolean))]
  const ctx = { product_names: [...productNames, ...(input.company_names ?? [])], competitor_names: competitorNames, own_hosts: ownHosts }
  const profileById = new Map((input.products ?? []).map((p) => [p.id, p]))
  const named = mentions.products // sorted by start
  /** The product named last inside a span. */
  const productIn = (span: Span) => {
    let lo = 0
    let hi = named.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if ((named[mid] as { start: number }).start < span.start) lo = mid + 1
      else hi = mid
    }
    let last: string | undefined
    for (let k = lo; k < named.length && (named[k] as { start: number }).start < span.end; k++) {
      const m = named[k] as { id: string; end: number }
      if (m.end <= span.end) last = m.id
    }
    return last === undefined ? undefined : profileById.get(last)
  }

  // The numbers of the sentence being read, offsets within the draft: a clause takes the ones inside it.
  let sentenceNumbers: FoundNumber[] = []
  const numbersIn = (span: Span) => {
    let lo = 0
    let hi = sentenceNumbers.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if ((sentenceNumbers[mid] as FoundNumber).start < span.start) lo = mid + 1
      else hi = mid
    }
    const out: FoundNumber[] = []
    for (let k = lo; k < sentenceNumbers.length && (sentenceNumbers[k] as FoundNumber).start < span.end; k++) {
      const n = sentenceNumbers[k] as FoundNumber
      if (n.end <= span.end) out.push({ ...n, start: n.start - span.start, end: n.end - span.start })
    }
    return out
  }

  /** Match one piece of text, read with `subject` as its product when it names none. */
  const assess = (span: Span, subject: ProductProfile | undefined): Unit => {
    const own = productIn(span)
    const carried = own ? undefined : subject
    const spanNumbers = numbersIn(span)
    // A clause that names the product only by its link is about the product too.
    const candidate = readSentence(span, ctx, (own ?? carried)?.name, spanNumbers)
    const numbers = candidate?.numbers ?? spanNumbers
    // How much of the claim the clause says counts every word it writes, a link's included.
    const tokens = new Set(contentTokens(stripNumbers(span.text, numbers)))
    // How much of the clause the claim says counts the words it says, never a link's host or path.
    const said = new Set(contentTokens(stripNumbers(blankUrls(span.text, ownHosts), numbers)))
    // A clause about the product the sentence before named counts that product's name.
    if (carried) for (const t of contentTokens(carried.name)) {
      tokens.add(t)
      said.add(t)
    }
    // A guarantee, superlative, compliance or comparison phrase the claim does not say is the
    // clause's own statement: the clause is not inside the claim, however few words it adds.
    const strong = candidate ? strongPhrases(candidate).map(wordsOf) : []
    const folded = foldText(span.text)
    let banned: Hit | undefined
    let best: Hit | undefined
    for (const p of prepared) {
      if (p.claim.kind === 'comparative' && !foldText(p.claim.competitor ?? '').split(/\s+/).every((w) => w === '' || folded.includes(w))) continue
      let score = 0
      let conflict: Conflict | undefined
      for (const phrase of p.phrases) {
        const inside = strong.every((w) => phrase.words.includes(w)) ? containedIn(phrase.tokens, said) : 0
        const c = Math.max(containment(phrase.tokens, tokens), inside)
        if (c >= MATCH_THRESHOLD && c >= score) {
          score = c
          conflict = numberConflict(phrase.numbers, p.proofNumbers, numbers)
        }
      }
      if (score === 0) continue
      if (p.claim.kind === 'banned') {
        // A different number than the banned claim's is a different statement; a number added
        // to a banned claim that states none leaves it banned.
        if (conflict && conflict.expected.length > 0) continue
        if (!banned || score > banned.score) banned = { p, score }
        continue
      }
      const better = !best || score > best.score || (score === best.score && best.conflict && !conflict)
      if (better) best = { p, score, conflict }
    }
    return { ...span, candidate, banned, best }
  }
  const scoreOf = (u: Unit) => Math.max(u.banned?.score ?? 0, u.best?.score ?? 0)

  const findings: ClaimFinding[] = []
  // What the draft is about before it names anything: its product, or the company's only product.
  let previousProduct: ProductProfile | undefined = input.product_id ? profileById.get(input.product_id) : input.products?.length === 1 ? input.products[0] : undefined
  for (const sentence of claimSentences(input.text, ownHosts)) {
    // "It supports SSO." after a sentence about Orbit is about Orbit, as is "Now you can export by client."
    const carried = previousProduct
    previousProduct = productIn(sentence) ?? carried

    const ownNumbers = extractNumbers(sentence.text)
    sentenceNumbers = ownNumbers.map((n) => ({ ...n, start: n.start + sentence.start, end: n.end + sentence.start }))
    const clauses = clauseSpans(sentence, ownNumbers)
    const subjects: Array<ProductProfile | undefined> = []
    let subject = carried
    for (const c of clauses) {
      subjects.push(subject)
      subject = productIn(c) ?? subject
    }
    const single = clauses.map((c, k) => assess(c, subjects[k]))

    // Join clauses that match nothing alone when together they match a claim whose
    // wording spans them; a clause that matches a claim of its own is never swallowed.
    const units: Unit[] = []
    for (let i = 0; i < clauses.length; ) {
      let chosen = single[i] as Unit
      let next = i + 1
      for (let j = i + 1; j < clauses.length && j <= i + JOIN_WINDOW && scoreOf(single[j] as Unit) === 0; j++) {
        const joined = { text: input.text.slice((clauses[i] as Span).start, (clauses[j] as Span).end), start: (clauses[i] as Span).start, end: (clauses[j] as Span).end }
        const u = assess(joined, subjects[i])
        if (scoreOf(u) > scoreOf(chosen)) {
          chosen = u
          next = j + 1
        }
      }
      units.push(chosen)
      i = next
    }

    for (const u of units) {
      const base = { text: u.text, start: u.start, end: u.end }
      if (u.banned) {
        findings.push({ ...base, status: 'banned', claim_id: u.banned.p.claim.id, reason: u.banned.p.claim.reason })
      } else if (u.best) {
        const claim = u.best.p.claim
        if (u.best.conflict) {
          findings.push({
            ...base,
            status: 'number_mismatch',
            claim_id: claim.id,
            expected: [...new Set(u.best.conflict.expected.map(label))],
            found: [...new Set(u.best.conflict.found.map(label))],
          })
        } else if (claimStaleness(claim, input.today).stale) {
          findings.push({ ...base, status: 'stale', claim_id: claim.id, review_on: claim.review_on })
        } else {
          findings.push({ ...base, status: 'matched', claim_id: claim.id })
        }
      } else if (u.candidate) {
        findings.push({ ...base, status: 'unmatched', because: u.candidate.reasons, competitor: u.candidate.competitor })
      }
    }
  }

  const flags: ClaimFlag[] = []
  for (const f of findings) {
    if (f.status === 'matched') continue
    const code: ClaimFlagCode =
      f.status === 'banned' ? 'claim_banned' : f.status === 'stale' ? 'claim_stale' : f.status === 'number_mismatch' ? 'claim_number_mismatch' : 'claim_unmatched'
    flags.push({ code, claim_id: f.claim_id, text: f.text, start: f.start, end: f.end, expected: f.expected, reason: f.reason })
  }
  for (const a of mentions.avoid) flags.push({ code: 'avoid_word', text: a.text, start: a.start, end: a.end, reason: a.word })
  flags.sort((a, b) => a.start - b.start)

  return {
    passed: findings.every((f) => f.status === 'matched') && mentions.avoid.length === 0,
    claims: findings,
    mentions,
    flags,
  }
}

/** The claims a draft used (for "every draft that used a claim is listed on it"): every claim a sentence matched, whatever its status. */
export function claimsUsed(findings: readonly ClaimFinding[]): string[] {
  return [...new Set(findings.flatMap((f) => (f.claim_id ? [f.claim_id] : [])))]
}
