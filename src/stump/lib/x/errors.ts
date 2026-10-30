/**
 * Sorts an X answer into the failure classes Stump acts on.
 *
 * Sources:
 *  - https://docs.x.com/x-api/fundamentals/response-codes-and-errors (status codes,
 *    problem JSON, x-rate-limit-* headers)
 *  - https://docs.x.com/x-api/getting-started/pricing (requests are blocked when the
 *    balance reaches zero or a spending limit is reached; the status code is not
 *    documented, so 402 and any answer naming credits, a spending limit or a usage
 *    cap are read as exhausted credits)
 *  - the duplicate-content refusal is a 403 whose detail says so (not in the error
 *    reference; matched on its text)
 *  - the API reply rule (replies only to authors who mentioned or quoted the account)
 *    is a 403 not-authorized-for-resource on a reply (X's Feb 2026 changelog)
 */
import type { RateLimit, XError, XErrorKind, XRetryAdvice } from './types'

export interface XRequestInfo {
  method: string
  /** True for a call that creates or removes something people can see (a post, a delete). */
  visible: boolean
  /** True when the request body replies to a post. */
  isReply?: boolean
}

export function parseRateLimit(headers: Headers): RateLimit | null {
  const num = (name: string) => {
    const v = headers.get(name)
    if (v === null || v.trim() === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  const limit = num('x-rate-limit-limit')
  const remaining = num('x-rate-limit-remaining')
  const reset = num('x-rate-limit-reset')
  if (limit === null && remaining === null && reset === null) return null
  return { limit, remaining, resetAt: reset === null ? null : new Date(reset * 1000).toISOString() }
}

interface Problem {
  type: string | null
  title: string
  detail: string
}

/** Pulls the network's own text and type out of whichever error shape X sent. */
export function readProblem(body: unknown, rawText: string): Problem {
  const out: Problem = { type: null, title: '', detail: '' }
  const b = body as Record<string, unknown> | null
  if (b && typeof b === 'object') {
    const first = Array.isArray(b.errors) && b.errors[0] && typeof b.errors[0] === 'object' ? (b.errors[0] as Record<string, unknown>) : null
    const str = (v: unknown) => (typeof v === 'string' ? v : '')
    out.type = str(b.type) || str(first?.type) || str(b.error) || null
    out.title = str(b.title) || str(first?.title)
    out.detail = str(b.detail) || str(b.error_description) || str(first?.detail) || str(first?.message) || str(b.message)
  }
  if (!out.detail && !out.title) out.detail = rawText.trim().slice(0, 300)
  return out
}

function make(kind: XErrorKind, status: number | null, p: Problem, extra: Partial<XError> = {}): XError {
  const message = p.detail || p.title || (status ? `X answered ${status}` : 'X did not answer')
  const retryByKind: Record<XErrorKind, XRetryAdvice> = {
    rate_limited: 'after_reset',
    credits_exhausted: 'never',
    duplicate_content: 'read_back_first',
    auth_revoked: 'never',
    unknown_outcome: 'read_back_first',
    reply_not_allowed: 'never',
    forbidden: 'never',
    not_found: 'never',
    invalid_request: 'never',
    server_error: 'safe',
    network_error: 'safe',
  }
  return {
    kind,
    status,
    message,
    type: p.type,
    code: null,
    resetAt: null,
    retry: retryByKind[kind],
    mayHaveApplied: kind === 'unknown_outcome' || kind === 'duplicate_content',
    ...extra,
  }
}

/** Builds an error for a request the library refused before sending it. */
export function localXError(code: string, message: string): XError {
  return {
    kind: 'invalid_request',
    status: null,
    message,
    type: null,
    code,
    resetAt: null,
    retry: 'never',
    mayHaveApplied: false,
  }
}

const CREDIT_WORDS = /credit|spending limit|usage cap|usage-capped|payment required|insufficient fund|billing/i
const DUPLICATE_WORDS = /duplicate content|duplicate (tweet|post)|already (tweeted|posted)/i
const REPLY_WORDS = /not been mentioned|otherwise engaged|mentioned or quoted|reply to this conversation is not allowed|not allowed to reply/i

/** Classifies an HTTP answer that was not a success. */
export function classifyXResponse(
  status: number,
  headers: Headers,
  body: unknown,
  rawText: string,
  req: XRequestInfo,
): XError {
  const p = readProblem(body, rawText)
  const signal = `${p.type ?? ''} ${p.title} ${p.detail}`
  const rl = parseRateLimit(headers)

  if (status === 402 || (status === 429 && CREDIT_WORDS.test(signal) && !/rate.?limit/i.test(p.type ?? ''))) {
    return make('credits_exhausted', status, p)
  }
  if (status === 429) {
    let resetAt = rl?.resetAt ?? null
    if (!resetAt) {
      const ra = Number(headers.get('retry-after'))
      if (Number.isFinite(ra) && ra > 0) resetAt = new Date(Date.now() + ra * 1000).toISOString()
    }
    return make('rate_limited', status, p, { resetAt })
  }
  if (status === 401) return make('auth_revoked', status, p)
  if (status === 403) {
    if (DUPLICATE_WORDS.test(signal)) return make('duplicate_content', status, p)
    if (CREDIT_WORDS.test(signal)) return make('credits_exhausted', status, p)
    if (REPLY_WORDS.test(signal) || (req.isReply && /not-authorized-for-resource/.test(p.type ?? ''))) {
      return make('reply_not_allowed', status, p)
    }
    if (/revoked|suspended|invalid.{0,12}token|expired token|token.{0,12}expired/i.test(signal)) {
      return make('auth_revoked', status, p)
    }
    return make('forbidden', status, p)
  }
  if (status === 404 || /resource-not-found/.test(p.type ?? '')) return make('not_found', status, p)
  if (status >= 500) {
    return req.visible ? make('unknown_outcome', status, p) : make('server_error', status, p)
  }
  // OAuth token endpoint: a refresh token that is spent, revoked or expired.
  if (status === 400 && p.type === 'invalid_grant') return make('auth_revoked', status, p)
  if (DUPLICATE_WORDS.test(signal)) return make('duplicate_content', status, p)
  return make('invalid_request', status, p)
}

/** Classifies a call that threw or timed out: no answer arrived. */
export function classifyXThrown(err: unknown, req: XRequestInfo, timedOut: boolean): XError {
  const detail = timedOut ? 'The request to X timed out.' : err instanceof Error ? err.message : String(err)
  const p: Problem = { type: null, title: '', detail }
  return req.visible ? make('unknown_outcome', null, p) : make('network_error', null, p)
}
