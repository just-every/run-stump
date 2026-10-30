// The claims a drafting request sends to the company's AI provider (STUMP-DRAFT-006.1).
//
// A request sends only what the draft needs: the source, the voice guide, the claims
// and the venue's rules. Of the claims, the model may use the current claims it can
// prove, must avoid the banned ones, and may make a comparison only from a comparative
// claim with a dated source. A stale claim, one without proof and one for another
// product are left out and reported, so the item's record shows exactly what went out.

import { assertToday, claimStaleness } from './validate'
import { isBackedRecord, isCurrentRecord } from './check'
import type { Claim } from './types'

/** The fields of a claim that go into a request. Nothing else of the record is sent. */
export const CLAIM_FIELDS_SENT = ['id', 'kind', 'text', 'competitor', 'source_date'] as const

export interface RequestClaim {
  id: string
  kind: Claim['kind']
  text: string
  competitor?: string
  source_date?: string
}

export interface ClaimsForRequest {
  /** Claims the model may state. */
  allowed: RequestClaim[]
  /** Claims the model must not make. */
  banned: RequestClaim[]
  /** Comparisons the model may make, each backed by a dated source. */
  comparative: RequestClaim[]
  /** Claims left out, with the reason. */
  omitted: Array<{ id: string; reason: 'stale' | 'no_proof' | 'other_product' }>
  /** Ids of every claim sent. */
  sent_ids: string[]
}

/** `today` is YYYY-MM-DD in the company's time zone; anything else throws a RangeError. */
export function claimsForRequest(claims: readonly Claim[], options: { product_id?: string; today: string }): ClaimsForRequest {
  assertToday(options.today)
  const out: ClaimsForRequest = { allowed: [], banned: [], comparative: [], omitted: [], sent_ids: [] }
  for (const c of claims) {
    const send: RequestClaim = { id: c.id, kind: c.kind, text: c.text }
    if (c.kind === 'banned') {
      out.banned.push(send)
      out.sent_ids.push(c.id)
      continue
    }
    if (options.product_id && c.product_id && c.product_id !== options.product_id) {
      out.omitted.push({ id: c.id, reason: 'other_product' })
      continue
    }
    if (!isBackedRecord(c)) {
      out.omitted.push({ id: c.id, reason: 'no_proof' })
      continue
    }
    // A backed claim with no valid review date can never be shown current: it goes out as stale.
    if (!isCurrentRecord(c) || claimStaleness(c, options.today).stale) {
      out.omitted.push({ id: c.id, reason: 'stale' })
      continue
    }
    if (c.kind === 'comparative') {
      out.comparative.push({ ...send, competitor: c.competitor, source_date: c.source_date })
      out.sent_ids.push(c.id)
    } else {
      out.allowed.push(send)
      out.sent_ids.push(c.id)
    }
  }
  return out
}
