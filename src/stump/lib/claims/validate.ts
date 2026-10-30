// What a claim record must hold before it can be saved (STUMP-BRAND-003).
//
// A claim the company may make carries proof, an owner and a review date; a claim it
// must not make carries its reason; a comparative claim names the competitor and
// carries a dated source. A claim past its review date reads as stale.

import type { Claim, ClaimProof } from './types'

export type ClaimError =
  | { field: 'text'; code: 'required' }
  | { field: 'kind'; code: 'invalid' }
  | { field: 'proof'; code: 'required' }
  | { field: 'owner_id'; code: 'required' }
  | { field: 'review_on'; code: 'required' | 'invalid' }
  | { field: 'reason'; code: 'required' }
  | { field: 'competitor'; code: 'required' }
  | { field: 'source_url'; code: 'required' | 'invalid' }
  | { field: 'source_date'; code: 'required' | 'invalid' | 'future' }

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isIsoDate(value: string | undefined): value is string {
  if (!value) return false
  const m = ISO_DATE.exec(value)
  if (!m) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value)
}

export function hasProof(proof: Claim['proof']): boolean {
  if (proof === undefined || proof === null) return false
  if (typeof proof === 'string') return proof.trim() !== ''
  const p: ClaimProof = proof
  return [p.url, p.document, p.text, p.date].some((v) => typeof v === 'string' && v.trim() !== '') || (p.number !== undefined && String(p.number).trim() !== '')
}

function isHttpUrl(value: string | undefined): boolean {
  if (!value) return false
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/** Why a claim cannot be saved; an empty list means it can. `today` (YYYY-MM-DD) bounds a comparative source's date. */
export function validateClaim(claim: Partial<Claim>, today?: string): ClaimError[] {
  const errors: ClaimError[] = []
  if (!claim.text || claim.text.trim() === '') errors.push({ field: 'text', code: 'required' })
  if (claim.kind !== 'allowed' && claim.kind !== 'banned' && claim.kind !== 'comparative') {
    errors.push({ field: 'kind', code: 'invalid' })
    return errors
  }
  if (claim.kind === 'banned') {
    if (!claim.reason || claim.reason.trim() === '') errors.push({ field: 'reason', code: 'required' })
    return errors
  }
  if (!claim.owner_id) errors.push({ field: 'owner_id', code: 'required' })
  if (!claim.review_on) errors.push({ field: 'review_on', code: 'required' })
  else if (!isIsoDate(claim.review_on)) errors.push({ field: 'review_on', code: 'invalid' })
  if (claim.kind === 'allowed') {
    if (!hasProof(claim.proof)) errors.push({ field: 'proof', code: 'required' })
    return errors
  }
  if (!claim.competitor || claim.competitor.trim() === '') errors.push({ field: 'competitor', code: 'required' })
  if (!claim.source_url) errors.push({ field: 'source_url', code: 'required' })
  else if (!isHttpUrl(claim.source_url)) errors.push({ field: 'source_url', code: 'invalid' })
  if (!claim.source_date) errors.push({ field: 'source_date', code: 'required' })
  else if (!isIsoDate(claim.source_date)) errors.push({ field: 'source_date', code: 'invalid' })
  else if (today && claim.source_date > today) errors.push({ field: 'source_date', code: 'future' })
  return errors
}

/** A claim past its review date. `today` is YYYY-MM-DD in the company's time zone. */
export function claimStaleness(claim: Pick<Claim, 'review_on'>, today: string): { stale: boolean; days_overdue: number } {
  if (!isIsoDate(claim.review_on) || !isIsoDate(today)) return { stale: false, days_overdue: 0 }
  if (claim.review_on >= today) return { stale: false, days_overdue: 0 }
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${claim.review_on}T00:00:00Z`)) / 86_400_000)
  return { stale: true, days_overdue: days }
}
