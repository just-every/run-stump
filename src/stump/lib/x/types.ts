/**
 * Shared types for the X (Twitter) API v2 library. Pure TypeScript for the
 * Workers runtime: every network call goes through an injected fetch.
 *
 * Provider docs this folder follows (read 30 Oct 2026):
 *  - https://docs.x.com/x-api/getting-started/pricing
 *  - https://docs.x.com/x-api/fundamentals/response-codes-and-errors
 */

/** The spine's edge fetch. Same shape as the platform fetch. */
export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

/** X's rate-limit headers (x-rate-limit-limit / -remaining / -reset). */
export interface RateLimit {
  limit: number | null
  remaining: number | null
  /** ISO time the window resets, from x-rate-limit-reset (epoch seconds). */
  resetAt: string | null
}

export type XErrorKind =
  /** 429 with a rate-limit window. Wait for `resetAt`; never retry blindly. */
  | 'rate_limited'
  /** Pay-per-use credits are used up, or a spending/usage cap is reached. */
  | 'credits_exhausted'
  /** X refused the text as a duplicate of a recent post. Read back before anything else. */
  | 'duplicate_content'
  /** The token is revoked, expired beyond refresh, or the app lost access. Reconnect. */
  | 'auth_revoked'
  /** A write may or may not have happened (timeout, dropped connection, 5xx). Read back first. */
  | 'unknown_outcome'
  /** X's rule that an API reply needs the author to have mentioned or quoted the account. */
  | 'reply_not_allowed'
  | 'forbidden'
  | 'not_found'
  | 'invalid_request'
  /** 5xx on a call that changes nothing visible; safe to retry. */
  | 'server_error'
  /** A call that changes nothing visible did not complete; safe to retry. */
  | 'network_error'

export type XRetryAdvice =
  /** Do not retry until a person acts (reconnect, add credits, edit the text). */
  | 'never'
  /** Retry only after `resetAt`. */
  | 'after_reset'
  /** Look the post up (by id or text) before any retry. */
  | 'read_back_first'
  /** The call changed nothing; a retry is safe. */
  | 'safe'

export interface XError {
  kind: XErrorKind
  /** HTTP status, or null when no response arrived. */
  status: number | null
  /** The network's own words (detail, error_description or message), never rewritten. */
  message: string
  /** X problem `type` URL or OAuth `error` code, when present. */
  type: string | null
  /** A local validation code ('too_long', 'bad_poll', ...) when the library refused before sending. */
  code: string | null
  /** ISO time to try again after, for rate_limited. */
  resetAt: string | null
  retry: XRetryAdvice
  /** True when X may already have performed the write. */
  mayHaveApplied: boolean
}

export type XResult<T> =
  | { ok: true; value: T; status: number; rateLimit: RateLimit | null }
  | { ok: false; error: XError }

export interface XContext {
  fetch: FetchFn
  /** OAuth 2.0 user access token. */
  accessToken: string
  /** Defaults to https://api.x.com */
  baseUrl?: string
  /** Per-call timeout; defaults to 30 000 ms. A timeout on a visible write is an unknown outcome. */
  timeoutMs?: number
  /**
   * Query-parameter naming for field lists. X's endpoint reference now names them
   * `post.fields`; older docs say `tweet.fields`. Responses are read under both names.
   * Defaults to 'post'.
   */
  fieldsStyle?: 'post' | 'tweet'
  /** The account's handle, used only to build post URLs. */
  username?: string
}

/** The company's price table (USD). docs/networks.md holds the defaults. */
export interface XPriceTable {
  post: number
  post_with_url: number
  read: number
  owned_read: number
}

export type XChargeAct = 'post' | 'post_with_url' | 'read' | 'owned_read'

/** One charge, ready for the ledger. */
export interface XChargeQuote {
  counterparty: 'X'
  act: XChargeAct
  /** Requests for writes, resources for reads. */
  units: number
  unit_price_usd: number
  usd: number
  /** The same amount in millionths of a dollar, exact. */
  usd_micro: number
}
