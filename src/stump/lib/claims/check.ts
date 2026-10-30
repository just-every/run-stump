// The claim check of a draft against the company's claims (STUMP-BRAND-004).
//
// Each sentence of the draft is matched to the company's claims by the content words
// it shares with a claim (a claim is matched when at least three quarters of its
// content words appear, and two or fewer words must all appear). The result for a
// sentence is one of:
//   matched          a current claim covers it
//   banned           a claim the company must not make
//   number_mismatch  it matches a claim but states another number than the proof's
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

function sameKind(a: FoundNumber, b: FoundNumber): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'count') return a.unit !== '' && a.unit === b.unit
  return true
}

/** Numbers the draft states for something the claim states a number for, when none of them is the claim's. */
function numberConflict(claimNumbers: readonly FoundNumber[], proofNumbers: readonly FoundNumber[], sentenceNumbers: readonly FoundNumber[]) {
  const expectedAll = [...claimNumbers, ...proofNumbers]
  const conflicts: { expected: FoundNumber[]; found: FoundNumber[] } = { expected: [], found: [] }
  const kinds = new Set(sentenceNumbers.map((n) => n.kind))
  for (const kind of kinds) {
    const found = sentenceNumbers.filter((n) => n.kind === kind)
    const expected = expectedAll.filter((e) => found.some((f) => sameKind(f, e)))
    if (expected.length === 0) continue
    const ok = found.some((f) => expectedAll.some((e) => sameKind(f, e) && e.value === f.value))
    if (!ok) {
      conflicts.expected.push(...expected)
      conflicts.found.push(...found.filter((f) => expected.some((e) => sameKind(f, e))))
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

export function checkClaims(input: CheckClaimsInput): CheckClaimsResult {
  const prepared = relevant(input.claims, input.product_id).map(prepare)
  const mentionInput = { products: input.products, people: input.people, company_names: input.company_names }
  const mentions = extractMentions(input.text, mentionInput)
  const productNames = (input.products ?? []).flatMap((p) => [p.name, ...(p.other_names ?? [])])
  const competitorNames = (input.products ?? []).flatMap((p) => (p.competitors ?? []).flatMap((c) => (typeof c === 'string' ? [c] : [c.name, ...(c.aliases ?? [])])))
  const ctx = { product_names: [...productNames, ...(input.company_names ?? [])], competitor_names: competitorNames }

  const profileById = new Map((input.products ?? []).map((p) => [p.id, p]))
  const findings: ClaimFinding[] = []
  let previousProduct: ProductProfile | undefined
  for (const span of sentenceSpans(input.text)) {
    // "It supports SSO." after a sentence about Orbit is about Orbit.
    const pronounProduct = previousProduct && startsWithPronoun(span.text) ? previousProduct : undefined
    const inSentence = mentions.products.filter((m) => m.start >= span.start && m.end <= span.end)
    previousProduct = inSentence.length > 0 ? profileById.get((inSentence[inSentence.length - 1] as { id: string }).id) : pronounProduct
    const candidate: ClaimCandidate | undefined = readSentence(span, ctx, pronounProduct?.name)
    const sentenceNumbers = candidate?.numbers ?? extractNumbers(span.text)
    const tokens = new Set(contentTokens(stripNumbers(span.text, sentenceNumbers)))
    if (pronounProduct) for (const t of contentTokens(pronounProduct.name)) tokens.add(t)
    const folded = foldText(span.text)

    type Hit = { p: Prepared; score: number; conflict?: ReturnType<typeof numberConflict> }
    let banned: Hit | undefined
    let best: Hit | undefined
    for (const p of prepared) {
      if (p.claim.kind === 'comparative' && !foldText(p.claim.competitor ?? '').split(/\s+/).every((w) => w === '' || folded.includes(w))) continue
      let score = 0
      let conflict: ReturnType<typeof numberConflict>
      for (const phrase of p.phrases) {
        const c = containment(phrase.tokens, tokens)
        if (c >= MATCH_THRESHOLD && c >= score) {
          score = c
          conflict = numberConflict(phrase.numbers, p.proofNumbers, sentenceNumbers)
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

    const base = { text: span.text, start: span.start, end: span.end }
    if (banned) {
      findings.push({ ...base, status: 'banned', claim_id: banned.p.claim.id, reason: banned.p.claim.reason })
    } else if (best) {
      const claim = best.p.claim
      if (best.conflict) {
        findings.push({
          ...base,
          status: 'number_mismatch',
          claim_id: claim.id,
          expected: [...new Set(best.conflict.expected.map(label))],
          found: [...new Set(best.conflict.found.map(label))],
        })
      } else if (claimStaleness(claim, input.today).stale) {
        findings.push({ ...base, status: 'stale', claim_id: claim.id, review_on: claim.review_on })
      } else {
        findings.push({ ...base, status: 'matched', claim_id: claim.id })
      }
    } else if (candidate) {
      findings.push({ ...base, status: 'unmatched', because: candidate.reasons, competitor: candidate.competitor })
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
