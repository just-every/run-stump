// The claims a recorded hand-off post makes (STUMP-LEDGER-001, STUMP-BRAND-004): the
// claim check runs on the text the ledger keeps (read back from the network, else the
// person's own words or the draft as posted), so the entry lists only the claims that
// text matches, and every sentence no current claim backs is named on the record.
import { claimInput, claimsPastLines, loadBrand } from '../drafting/check.ts'

export interface Unbacked { status: string; text: string; claim_id?: string; expected?: string[]; found?: string[] }

/** `lines` are the disclosure lines the post may carry (the hand-off's, the venue's and the person's): never read as claims. */
export async function recordedClaims(db: D1Database, productId: string | null, text: string, lines: ReadonlyArray<string | null>, now: number): Promise<{ used: string[]; unbacked: Unbacked[] }> {
  const check = claimsPastLines(text, lines, claimInput(await loadBrand(db), now, productId))
  const used = [...new Set(check.claims.flatMap(finding => finding.status === 'matched' && finding.claim_id ? [finding.claim_id] : []))]
  const unbacked = check.claims.filter(finding => finding.status !== 'matched').map(finding => ({ status: finding.status, text: finding.text,
    ...(finding.claim_id ? { claim_id: finding.claim_id } : {}), ...(finding.expected ? { expected: finding.expected } : {}), ...(finding.found ? { found: finding.found } : {}) }))
  return { used, unbacked }
}
