// The claim check of a draft against the company's claims (STUMP-BRAND-004).
//
// A sentence can make several claims ("Orbit syncs with Slack, cuts triage time by 80%
// and has zero downtime"), so each sentence is read clause by clause: it is split at
// ';', commas and the conjunctions 'and' and 'but', and a clause that names no product
// takes the sentence's subject. A clause is matched to the company's claims by the
// content words it shares with a claim (a claim is matched when at least three quarters
// of its content words appear, and two or fewer words must all appear); clauses that
// match nothing on their own are joined when together they match a claim whose wording
// spans them. The result for each clause is one of:
//   matched          a current claim covers it
//   banned           a claim the company must not make
//   number_mismatch  it matches a claim but states another number than the claim's or
//                    its proof's (a percent, multiplier or price in any form: "2x" or
//                    "in half" against a proven 30% is a mismatch)
//   stale            it matches a claim past its review date
//   unmatched        it reads as a factual claim (extract.ts) but no claim covers it
// Priority when several apply: banned, number_mismatch, stale, matched. A person and an
// agent submitting the same draft get the same result: the check reads only the text,
// the claims, the profiles and today's date.

import { readSentence, startsWithPronoun } from './extract'
import type { ClaimCandidate } from './extract'
import { extractMentions } from './mentions'
import type { MentionSet } from './mentions'
import { extractNumbers, stripNumbers } from './numbers'
import type { FoundNumber } from './numbers'
import { contentTokens, foldText, sentenceSpans } from './sentences'
import type { Span } from './sentences'
import type { Claim, ClaimFinding, PersonProfile, ProductProfile } from './types'
import { claimStaleness, hasProof, isIsoDate } from './validate'

export interface CheckClaimsInput {
  text: string
  claims: readonly Claim[]
  products?: readonly ProductProfile[]
  people?: readonly PersonProfile[]
  company_names?: readonly string[]
  /** The item's product; company-wide and this product's claims apply (banned claims always do). */
  product_id?: string
  /** YYYY-MM-DD, the date in the company's time zone. */
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

/** A claim record the check can match against: banned claims always; others only with their proof or dated source. */
export function isCurrentRecord(claim: Claim): boolean {
  if (!claim.text || claim.text.trim() === '') return false
  if (claim.kind === 'banned') return true
  if (claim.kind === 'allowed') return hasProof(claim.proof)
  return Boolean(claim.competitor && claim.source_url && isIsoDate(claim.source_date))
}

interface Prepared {
  claim: Claim
  phrases: Array<{ tokens: Set<string>; numbers: FoundNumber[] }>
  proofNumbers: FoundNumber[]
}

function prepare(claim: Claim): Prepared {
  const phrases = [claim.text, ...(claim.aliases ?? [])].map((p) => {
    const numbers = extractNumbers(p)
    return { tokens: new Set(contentTokens(stripNumbers(p, numbers))), numbers }
  })
  const proof = claim.proof
  const proofText = typeof proof === 'object' && proof !== null && proof.number !== undefined ? String(proof.number) : ''
  const proofNumbers = proofText ? extractNumbers(proofText) : []
  return { claim, phrases, proofNumbers }
}

function containment(claimTokens: Set<string>, sentenceTokens: Set<string>): number {
  if (claimTokens.size === 0) return 0
  let shared = 0
  for (const t of claimTokens) if (sentenceTokens.has(t)) shared++
  if (claimTokens.size <= 2) return shared === claimTokens.size ? 1 : 0
  return shared >= 2 ? shared / claimTokens.size : 0
}

const MATCH_THRESHOLD = 0.75

function sameUnit(a: FoundNumber, b: FoundNumber): boolean {
  return a.kind === 'count' && b.kind === 'count' && a.unit !== '' && a.unit === b.unit
}

const isMeasure = (n: FoundNumber) => n.kind === 'percent' || n.kind === 'multiplier' || n.kind === 'money'
const equal = (a: FoundNumber, b: FoundNumber) => a.kind === b.kind && a.value === b.value && (a.kind !== 'count' || a.unit === b.unit)

type Conflict = { expected: FoundNumber[]; found: FoundNumber[] }

/**
 * Numbers the draft states for a claim when none of them is the claim's or its proof's.
 * Counts are compared within one unit. A claim's measure (percent, multiplier, money) is
 * compared with every percent and multiplier the draft states, whatever its kind, and with
 * money when the claim states money: "2x" against a proven 30% is a mismatch.
 */
function numberConflict(claimNumbers: readonly FoundNumber[], proofNumbers: readonly FoundNumber[], clauseNumbers: readonly FoundNumber[]): Conflict | undefined {
  const expectedAll = [...claimNumbers, ...proofNumbers]
  const conflicts: Conflict = { expected: [], found: [] }

  const expectedMeasures = expectedAll.filter(isMeasure)
  if (expectedMeasures.length > 0) {
    const moneyExpected = expectedMeasures.some((n) => n.kind === 'money')
    const found = clauseNumbers.filter((n) => n.kind === 'percent' || n.kind === 'multiplier' || (moneyExpected && n.kind === 'money'))
    if (found.length > 0 && !found.some((f) => expectedMeasures.some((e) => equal(f, e)))) {
      conflicts.expected.push(...expectedMeasures)
      conflicts.found.push(...found)
    }
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
const CLAUSE_BREAK = /;\s+|,\s+(?:(?:and|but)\s+)?|\s+(?:and|but)\s+/giu

/**
 * A sentence's clauses, with offsets into the draft. A piece of fewer than three words
 * ("Slack, Teams and Discord") stays with the clause before it.
 */
function clauseSpans(span: Span): Span[] {
  const pieces: Span[] = []
  let cursor = 0
  const push = (from: number, to: number) => {
    const raw = span.text.slice(from, to)
    const lead = raw.length - raw.trimStart().length
    const text = raw.trim()
    if (text === '') return
    const piece = { text, start: span.start + from + lead, end: span.start + from + lead + text.length }
    const words = text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0
    const last = pieces[pieces.length - 1]
    if (last && words < MIN_CLAUSE_WORDS) {
      last.end = piece.end
      last.text = span.text.slice(last.start - span.start, last.end - span.start)
    } else pieces.push(piece)
  }
  for (const m of span.text.matchAll(CLAUSE_BREAK)) {
    const at = m.index ?? 0
    push(cursor, at)
    cursor = at + m[0].length
  }
  push(cursor, span.text.length)
  const first = pieces[0]
  if (first && pieces.length > 1 && (first.text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0) < MIN_CLAUSE_WORDS) {
    const second = pieces[1] as Span
    pieces.splice(0, 2, { text: span.text.slice(first.start - span.start, second.end - span.start), start: first.start, end: second.end })
  }
  return pieces
}

export function checkClaims(input: CheckClaimsInput): CheckClaimsResult {
  const prepared = relevant(input.claims, input.product_id).map(prepare)
  const mentionInput = { products: input.products, people: input.people, company_names: input.company_names }
  const mentions = extractMentions(input.text, mentionInput)
  const productNames = (input.products ?? []).flatMap((p) => [p.name, ...(p.other_names ?? [])])
  const competitorNames = (input.products ?? []).flatMap((p) => (p.competitors ?? []).flatMap((c) => (typeof c === 'string' ? [c] : [c.name, ...(c.aliases ?? [])])))
  const ctx = { product_names: [...productNames, ...(input.company_names ?? [])], competitor_names: competitorNames }
  const profileById = new Map((input.products ?? []).map((p) => [p.id, p]))
  const productIn = (span: Span) => {
    const inSpan = mentions.products.filter((m) => m.start >= span.start && m.end <= span.end)
    return inSpan.length > 0 ? profileById.get((inSpan[inSpan.length - 1] as { id: string }).id) : undefined
  }

  /** Match one piece of text, read with `subject` as its product when it names none. */
  const assess = (span: Span, subject: ProductProfile | undefined): Unit => {
    const own = productIn(span)
    const carried = own ? undefined : subject
    const candidate = readSentence(span, ctx, carried?.name)
    const numbers = candidate?.numbers ?? extractNumbers(span.text)
    const tokens = new Set(contentTokens(stripNumbers(span.text, numbers)))
    if (carried) for (const t of contentTokens(carried.name)) tokens.add(t)
    const folded = foldText(span.text)
    let banned: Hit | undefined
    let best: Hit | undefined
    for (const p of prepared) {
      if (p.claim.kind === 'comparative' && !foldText(p.claim.competitor ?? '').split(/\s+/).every((w) => w === '' || folded.includes(w))) continue
      let score = 0
      let conflict: Conflict | undefined
      for (const phrase of p.phrases) {
        const c = containment(phrase.tokens, tokens)
        if (c >= MATCH_THRESHOLD && c >= score) {
          score = c
          conflict = numberConflict(phrase.numbers, p.proofNumbers, numbers)
        }
      }
      if (score === 0) continue
      if (p.claim.kind === 'banned') {
        if (conflict) continue // a different number is a different statement than the banned one
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
  let previousProduct: ProductProfile | undefined
  for (const sentence of sentenceSpans(input.text)) {
    // "It supports SSO." after a sentence about Orbit is about Orbit.
    const pronounProduct = previousProduct && startsWithPronoun(sentence.text) ? previousProduct : undefined
    previousProduct = productIn(sentence) ?? pronounProduct

    const clauses = clauseSpans(sentence)
    const subjects: Array<ProductProfile | undefined> = []
    let subject = pronounProduct
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
      for (let j = i + 1; j < clauses.length && scoreOf(single[j] as Unit) === 0; j++) {
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
