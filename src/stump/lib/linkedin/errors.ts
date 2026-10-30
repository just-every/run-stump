/**
 * Sorts a LinkedIn answer into the failure classes Stump acts on.
 *
 * Sources (read 30 Oct 2026):
 *  - https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
 *      "API Error Details": 400 INVALID_*, MISSING_FIELD, FIELD_LENGTH_TOO_LONG; 401 EMPTY_ACCESS_TOKEN;
 *      403 ACCESS_DENIED; 404 NOT_FOUND; 409 CONFLICT (retry); 422 UNPROCESSABLE_ENTITY; 429 TOO_MANY_REQUESTS;
 *      500/503.
 *  - https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin
 *      daily limit table (UTC): member 150, application 100,000.
 *  - https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
 *      token endpoint errors (invalid_request, invalid_redirect_uri), token lifetime 60 days.
 * Not in the docs and matched on text: the 401 bodies for an expired or revoked token, the
 * "MEMBER DAY" / "APPLICATION DAY" wording of throttle messages, and the duplicate-content 422.
 */
import type { LinkedInError, LinkedInErrorKind, LinkedInRetryAdvice } from './types'

export interface LinkedInRequestInfo {
  method: string
  /** True for a call that creates or removes a post. */
  visible: boolean
}

interface Problem {
  message: string
  providerCode: string | null
  serviceErrorCode: number | null
}

export function readLinkedInProblem(body: unknown, rawText: string): Problem {
  const b = body as Record<string, unknown> | null
  const out: Problem = { message: '', providerCode: null, serviceErrorCode: null }
  if (b && typeof b === 'object') {
    const msg = (typeof b.message === 'string' && b.message) || (typeof b.error_description === 'string' && b.error_description) || ''
    out.message = msg
    if (typeof b.code === 'string') out.providerCode = b.code
    else if (typeof b.error === 'string') out.providerCode = b.error
    if (typeof b.serviceErrorCode === 'number') out.serviceErrorCode = b.serviceErrorCode
  }
  if (!out.message) out.message = rawText.trim().slice(0, 300)
  return out
}

/** The next 00:00 UTC after `now`, when LinkedIn's day limits reset. */
export function nextUtcMidnight(now: number): string {
  const d = new Date(now)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString()
}

const RETRY: Record<LinkedInErrorKind, LinkedInRetryAdvice> = {
  rate_limited: 'after_reset',
  auth_expired: 'never',
  auth_revoked: 'never',
  permission_denied: 'never',
  duplicate_content: 'read_back_first',
  invalid_request: 'never',
  not_found: 'never',
  unknown_outcome: 'read_back_first',
  server_error: 'safe',
  network_error: 'safe',
}

function make(kind: LinkedInErrorKind, status: number | null, p: Problem, extra: Partial<LinkedInError> = {}): LinkedInError {
  return {
    kind,
    status,
    message: p.message || (status ? `LinkedIn answered ${status}` : 'LinkedIn did not answer'),
    providerCode: p.providerCode,
    serviceErrorCode: p.serviceErrorCode,
    code: null,
    limitScope: null,
    resetAt: null,
    retry: RETRY[kind],
    mayHaveApplied: kind === 'unknown_outcome' || kind === 'duplicate_content',
    ...extra,
  }
}

export function localLinkedInError(code: string, message: string): LinkedInError {
  return {
    kind: 'invalid_request', status: null, message, providerCode: null, serviceErrorCode: null, code,
    limitScope: null, resetAt: null, retry: 'never', mayHaveApplied: false,
  }
}

export function classifyLinkedInResponse(
  status: number,
  headers: Headers,
  body: unknown,
  rawText: string,
  req: LinkedInRequestInfo,
  now: number = Date.now(),
): LinkedInError {
  const p = readLinkedInProblem(body, rawText)
  const signal = `${p.providerCode ?? ''} ${p.message}`

  if (status === 429) {
    const m = /\b(MEMBER|APPLICATION)\b[\s\S]{0,20}\b(DAY|DAILY)\b/i.exec(signal)
    const limitScope = /\bMEMBER\b/i.test(signal) ? 'member' : /\bAPPLICATION\b/i.test(signal) ? 'application' : null
    let resetAt: string | null = null
    if (m) resetAt = nextUtcMidnight(now)
    else {
      const ra = Number(headers.get('retry-after'))
      if (Number.isFinite(ra) && ra > 0) resetAt = new Date(now + ra * 1000).toISOString()
    }
    return make('rate_limited', status, p, { limitScope, resetAt })
  }
  if (status === 401) {
    if (p.serviceErrorCode === 65601 || /revoked/i.test(signal)) return make('auth_revoked', status, p)
    return make('auth_expired', status, p)
  }
  if (status === 403) return make('permission_denied', status, p)
  if (status === 404) return make('not_found', status, p)
  if (status === 409) return make('server_error', status, p)
  if (status === 422 && /duplicate/i.test(signal)) return make('duplicate_content', status, p)
  if (status >= 500) return req.visible ? make('unknown_outcome', status, p) : make('server_error', status, p)
  // Token endpoint: a refresh token that is spent or revoked.
  if ((status === 400 || status === 401) && /invalid_grant|invalid_refresh_token/i.test(signal)) return make('auth_expired', status, p)
  return make('invalid_request', status, p)
}

export function classifyLinkedInThrown(err: unknown, req: LinkedInRequestInfo, timedOut: boolean): LinkedInError {
  const message = timedOut ? 'The request to LinkedIn timed out.' : err instanceof Error ? err.message : String(err)
  const p: Problem = { message, providerCode: null, serviceErrorCode: null }
  return req.visible ? make('unknown_outcome', null, p) : make('network_error', null, p)
}
