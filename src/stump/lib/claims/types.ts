export type ClaimKind = 'allowed' | 'banned' | 'comparative'

export interface ClaimProof {
  url?: string
  document?: string
  number?: string | number
  date?: string
  text?: string
}

/** One entry of the company's claim memory (STUMP-BRAND-003). */
export interface Claim {
  id: string
  /** Absent for a company-wide claim. */
  product_id?: string
  kind: ClaimKind
  text: string
  /** Another way the same claim is worded; matched like `text`. */
  aliases?: string[]
  /** A URL, document, number or date, or a plain string for any of them. */
  proof?: string | ClaimProof
  owner_id?: string
  /** YYYY-MM-DD. The claim reads as stale after this date. */
  review_on?: string
  /** Why a banned claim is banned. */
  reason?: string
  /** The named competitor of a comparative claim. */
  competitor?: string
  source_url?: string
  /** YYYY-MM-DD, the date of a comparative claim's source. */
  source_date?: string
}

export type ClaimStatus = 'matched' | 'unmatched' | 'banned' | 'stale' | 'number_mismatch'

export interface ClaimFinding {
  status: ClaimStatus
  /** The claim the sentence matched; absent for `unmatched`. */
  claim_id?: string
  /** The sentence in the draft. */
  text: string
  start: number
  end: number
  /** number_mismatch: the proof's numbers, and the ones the draft used. */
  expected?: string[]
  found?: string[]
  /** stale: the claim's review date. */
  review_on?: string
  /** banned: the claim's reason. */
  reason?: string
  /** unmatched: why the sentence reads as a claim. */
  because?: string[]
  competitor?: string
}

export interface ProductProfile {
  id: string
  name: string
  other_names?: string[]
  /** The product's URLs; a link to one of their hosts is a mention. */
  urls?: string[]
  /** Competitors the product is compared with. */
  competitors?: Array<string | { name: string; aliases?: string[] }>
  /** Words the product's tone avoids. */
  avoid?: string[]
  /** Match this product's names with their exact capitalisation only. */
  case_sensitive?: boolean
}

export interface PersonProfile {
  id: string
  name: string
  aliases?: string[]
  /** Handles without the leading @, e.g. "jane" or "jane.bsky.social". */
  handles?: string[]
}

export type Connection = 'founder' | 'employee' | 'contractor' | 'investor' | 'advisor' | 'friend' | 'family'
