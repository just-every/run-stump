/**
 * Shared types for the LinkedIn member-posting library. Pure TypeScript for the
 * Workers runtime: every network call goes through an injected fetch.
 *
 * Provider docs this folder follows (read 30 Oct 2026):
 *  - https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
 *  - https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin
 */

/** The spine's edge fetch. Same shape as the platform fetch. */
export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

export type LinkedInErrorKind =
  /** 429. Day limits reset at 00:00 UTC; `resetAt` says when. */
  | 'rate_limited'
  /** The member's token expired. The person reconnects; their items are held. */
  | 'auth_expired'
  /** The token was revoked or is invalid. The person reconnects. */
  | 'auth_revoked'
  /** 403: the token lacks the permission this call needs (reading posts back needs r_member_social). */
  | 'permission_denied'
  | 'duplicate_content'
  | 'invalid_request'
  | 'not_found'
  /** A write may or may not have happened (timeout, dropped connection, 5xx, or an answer with no post id). */
  | 'unknown_outcome'
  /** 5xx or a write conflict on a call that is safe to repeat. */
  | 'server_error'
  | 'network_error'

export type LinkedInRetryAdvice = 'never' | 'after_reset' | 'read_back_first' | 'safe'

export interface LinkedInError {
  kind: LinkedInErrorKind
  status: number | null
  /** LinkedIn's own message, never rewritten. */
  message: string
  /** LinkedIn's `code` (for example ACCESS_DENIED) or OAuth `error`, when present. */
  providerCode: string | null
  serviceErrorCode: number | null
  /** A local validation code ('too_long', 'bad_urn', ...) when the library refused before sending. */
  code: string | null
  /** For rate_limited: whose limit it was, when the message says. */
  limitScope: 'member' | 'application' | null
  /** ISO time to try again after, for rate_limited. */
  resetAt: string | null
  retry: LinkedInRetryAdvice
  mayHaveApplied: boolean
}

export type LinkedInOutcome<T> =
  | { ok: true; value: T; status: number }
  | { ok: false; error: LinkedInError }

export interface LinkedInContext {
  fetch: FetchFn
  /** The member's access token (w_member_social). */
  accessToken: string
  /** The LinkedIn-Version header, YYYYMM. Defaults to LINKEDIN_API_VERSION. */
  apiVersion?: string
  /** Defaults to https://api.linkedin.com */
  baseUrl?: string
  /** Per-call timeout; defaults to 30 000 ms. A timeout on a post is an unknown outcome. */
  timeoutMs?: number
}
