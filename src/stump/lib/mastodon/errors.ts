// Result envelope and error classification for Mastodon calls.
//
// Sources:
//   Error bodies and status codes: https://docs.joinmastodon.org/api/guidelines/
//   OAuth error bodies:            https://docs.joinmastodon.org/methods/oauth/
//   verify_credentials 401/403/422: https://docs.joinmastodon.org/methods/accounts/
//   Rate limit headers and 5 minute window: https://docs.joinmastodon.org/api/rate-limits/
//   Idempotency keys kept 1 hour:  https://docs.joinmastodon.org/methods/statuses/

export type ErrorKind =
  | 'rate_limited'
  | 'auth_revoked'
  | 'client_invalid'
  | 'forbidden'
  | 'validation'
  | 'not_found'
  | 'gone'
  | 'unknown_outcome'
  | 'server_error'
  | 'network_error'
  | 'invalid_response';

export interface RateLimitInfo {
  limit?: number;
  remaining?: number;
  /** Epoch milliseconds at which the window resets. */
  resetAtMs?: number;
}

export interface NetworkError {
  kind: ErrorKind;
  status?: number;
  /** Provider code when the body carries one (for example invalid_grant), else a reason this library derived. */
  code?: string;
  /** The network's own message, shown as is. */
  message: string;
  /** rate_limited: epoch milliseconds before which nothing should be sent. */
  retryAtMs?: number;
  retryAtSource?: 'header' | 'window_default';
  /**
   * True when a write may have taken effect although no answer arrived
   * (timeout, dropped connection or 5xx). The caller reads back before it retries.
   */
  outcomeUnknown: boolean;
  rate?: RateLimitInfo;
  /** Draft problems, set on validation errors raised before any request. */
  problems?: Problem[];
}

export interface Problem {
  code: string;
  message: string;
  /** Where in the draft the problem sits, for example media[1].description. */
  path?: string;
}

export interface Ok<T> {
  ok: true;
  value: T;
  rate?: RateLimitInfo;
}
export interface Err {
  ok: false;
  error: NetworkError;
}
export type Result<T> = Ok<T> | Err;

export const WINDOW_DEFAULT_MS = 5 * 60 * 1000; // "300 requests per 5 minutes"

export function ok<T>(value: T, rate?: RateLimitInfo): Ok<T> {
  return rate ? { ok: true, value, rate } : { ok: true, value };
}

export function fail(error: NetworkError): Err {
  return { ok: false, error };
}

export function validationError(problems: Problem[]): Err {
  return fail({
    kind: 'validation',
    code: problems[0]?.code ?? 'invalid',
    message: problems.map((p) => p.message).join('; '),
    outcomeUnknown: false,
    problems,
  });
}

export function parseRateLimit(headers: Headers): RateLimitInfo | undefined {
  const limit = num(headers.get('x-ratelimit-limit'));
  const remaining = num(headers.get('x-ratelimit-remaining'));
  const reset = headers.get('x-ratelimit-reset');
  const resetAtMs = reset ? parseInstant(reset, Date.now()) : undefined;
  if (limit === undefined && remaining === undefined && resetAtMs === undefined) return undefined;
  const info: RateLimitInfo = {};
  if (limit !== undefined) info.limit = limit;
  if (remaining !== undefined) info.remaining = remaining;
  if (resetAtMs !== undefined) info.resetAtMs = resetAtMs;
  return info;
}

function num(v: string | null): number | undefined {
  if (v === null || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parses a header value that names an instant: an ISO 8601 timestamp (what
 * Mastodon sends in X-RateLimit-Reset), epoch seconds, a number of seconds
 * to wait (Retry-After), or an HTTP date.
 */
export function parseInstant(value: string, nowMs: number): number | undefined {
  const v = value.trim();
  if (/^\d+(\.\d+)?$/.test(v)) {
    const n = Number(v);
    return n > 1e9 ? Math.round(n * 1000) : nowMs + Math.round(n * 1000);
  }
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : t;
}

const FORBIDDEN_REASONS: Array<[RegExp, string]> = [
  [/currently disabled/i, 'account_disabled'],
  [/pending approval/i, 'account_pending_approval'],
  [/confirmed e-?mail/i, 'email_unconfirmed'],
  [/not allowed/i, 'permission_denied'],
];

export interface ClassifyInput {
  status: number;
  headers: Headers;
  body: unknown;
  /** True for a request that changes state on the network. */
  write: boolean;
  nowMs: number;
}

function bodyError(body: unknown): { message?: string; code?: string } {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    const error = typeof b.error === 'string' ? b.error : undefined;
    const description = typeof b.error_description === 'string' ? b.error_description : undefined;
    const isCode = error !== undefined && /^[a-z_]+$/.test(error);
    const out: { message?: string; code?: string } = {};
    if (isCode) out.code = error;
    const message = description ?? error;
    if (message !== undefined) out.message = message;
    return out;
  }
  return {};
}

/** Turns a non-2xx answer into a classified error. */
export function classifyResponse(input: ClassifyInput): NetworkError {
  const { status, headers, body, write, nowMs } = input;
  const rate = parseRateLimit(headers);
  const { message: bodyMessage, code } = bodyError(body);
  const message = bodyMessage ?? `HTTP ${status}`;
  const base = { status, message, rate, outcomeUnknown: false } as const;
  const withCode = (extra: Partial<NetworkError> & { kind: ErrorKind }): NetworkError => {
    const e: NetworkError = { ...base, ...extra };
    if (rate === undefined) delete e.rate;
    return e;
  };

  if (status === 429) {
    const retryAfter = headers.get('retry-after');
    const fromRetry = retryAfter ? parseInstant(retryAfter, nowMs) : undefined;
    const fromReset = rate?.resetAtMs;
    const header = fromRetry ?? fromReset;
    return withCode({
      kind: 'rate_limited',
      code: 'rate_limited',
      retryAtMs: header ?? nowMs + WINDOW_DEFAULT_MS,
      retryAtSource: header !== undefined ? 'header' : 'window_default',
    });
  }
  if (status === 401) {
    // Mastodon tokens do not expire, so an invalid token has been revoked or the app removed.
    if (code === 'invalid_client') return withCode({ kind: 'client_invalid', code });
    return withCode({ kind: 'auth_revoked', code: code ?? 'invalid_token' });
  }
  if (status === 403) {
    const reason = FORBIDDEN_REASONS.find(([re]) => re.test(message))?.[1];
    return withCode({ kind: 'forbidden', code: code ?? reason ?? 'forbidden' });
  }
  if (status === 404) return withCode({ kind: 'not_found', code: code ?? 'not_found' });
  if (status === 410) return withCode({ kind: 'gone', code: code ?? 'gone' });
  if (status === 413) return withCode({ kind: 'validation', code: 'payload_too_large' });
  if (status >= 400 && status < 500) {
    return withCode({ kind: 'validation', code: code ?? (status === 422 ? 'unprocessable' : 'invalid_request') });
  }
  if (status >= 500) {
    return write
      ? withCode({ kind: 'unknown_outcome', code: 'server_error', outcomeUnknown: true })
      : withCode({ kind: 'server_error', code: 'server_error' });
  }
  return withCode({ kind: 'invalid_response', code: 'unexpected_status' });
}

/** Turns a rejected fetch (timeout, abort, dropped connection) into an error. */
export function classifyThrown(err: unknown, write: boolean): NetworkError {
  const name = err instanceof Error ? err.name : 'Error';
  const timedOut = name === 'TimeoutError' || name === 'AbortError';
  const message = err instanceof Error && err.message ? err.message : String(err);
  // The injected fetch refused the address before sending anything, so nothing can have happened.
  if (name === 'NotPublicError') return { kind: 'validation', code: 'not_public', message, outcomeUnknown: false };
  return write
    ? { kind: 'unknown_outcome', code: timedOut ? 'timeout' : 'network', message, outcomeUnknown: true }
    : { kind: 'network_error', code: timedOut ? 'timeout' : 'network', message, outcomeUnknown: false };
}

export function invalidResponse(message: string, status?: number): Err {
  const e: NetworkError = { kind: 'invalid_response', code: 'invalid_response', message, outcomeUnknown: false };
  if (status !== undefined) e.status = status;
  return fail(e);
}
