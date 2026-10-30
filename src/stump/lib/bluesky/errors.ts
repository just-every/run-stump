// Result envelope and error classification for atproto (Bluesky) calls.
//
// Sources:
//   Error names per method (AccountTakedown, AuthFactorTokenRequired, ExpiredToken, InvalidToken,
//     InvalidSwap, RecordNotFound, HandleNotFound): the lexicons com.atproto.server.createSession,
//     refreshSession, repo.createRecord, getRecord, deleteRecord, identity.resolveHandle at
//     https://github.com/bluesky-social/atproto/tree/main/lexicons/com/atproto
//   Rate limit headers (ratelimit-limit/-remaining/-reset) and 429:
//     https://docs.bsky.app/docs/advanced-guides/rate-limits
//   Write points 5,000 an hour and 35,000 a day; createSession 30 per 5 minutes: same page.
//   DPoP error use_dpop_nonce and OAuth errors: https://atproto.com/specs/oauth and RFC 9449.

export type ErrorKind =
  | 'rate_limited'
  | 'auth_expired' // the access token ran out; a refresh fixes it
  | 'auth_revoked' // the session or grant is gone; the owner must connect again
  | 'credentials_invalid' // identifier or app password refused at sign-in
  | 'auth_factor_required' // the account asks for an emailed code
  | 'forbidden'
  | 'validation'
  | 'not_found'
  | 'unknown_outcome'
  | 'server_error'
  | 'network_error'
  | 'invalid_response';

export interface RateLimitInfo {
  limit?: number;
  remaining?: number;
  /** Epoch milliseconds at which the window resets. */
  resetAtMs?: number;
  policy?: string;
}

export interface Problem {
  code: string;
  message: string;
  path?: string;
}

export interface NetworkError {
  kind: ErrorKind;
  status?: number;
  /** The provider's error name (for example ExpiredToken, RecordNotFound) or a reason derived here. */
  code?: string;
  /** The network's own message, shown as is. */
  message: string;
  retryAtMs?: number;
  retryAtSource?: 'header' | 'window_default';
  /** True when a write may have taken effect although no answer arrived. Read back before retrying. */
  outcomeUnknown: boolean;
  rate?: RateLimitInfo;
  problems?: Problem[];
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

/** Used when a 429 carries no reset time. The shortest documented window is 5 minutes (createSession). */
export const WINDOW_DEFAULT_MS = 5 * 60 * 1000;

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
export function invalidResponse(message: string, status?: number): Err {
  const e: NetworkError = { kind: 'invalid_response', code: 'invalid_response', message, outcomeUnknown: false };
  if (status !== undefined) e.status = status;
  return fail(e);
}

function num(v: string | null): number | undefined {
  if (v === null || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** An instant named by a header: epoch seconds, seconds to wait, an ISO timestamp or an HTTP date. */
export function parseInstant(value: string, nowMs: number): number | undefined {
  const v = value.trim();
  if (/^\d+(\.\d+)?$/.test(v)) {
    const n = Number(v);
    return n > 1e9 ? Math.round(n * 1000) : nowMs + Math.round(n * 1000);
  }
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : t;
}

export function parseRateLimit(headers: Headers, nowMs: number): RateLimitInfo | undefined {
  const limit = num(headers.get('ratelimit-limit'));
  const remaining = num(headers.get('ratelimit-remaining'));
  const reset = headers.get('ratelimit-reset');
  const resetAtMs = reset ? parseInstant(reset, nowMs) : undefined;
  const policy = headers.get('ratelimit-policy') ?? undefined;
  if (limit === undefined && remaining === undefined && resetAtMs === undefined) return undefined;
  const info: RateLimitInfo = {};
  if (limit !== undefined) info.limit = limit;
  if (remaining !== undefined) info.remaining = remaining;
  if (resetAtMs !== undefined) info.resetAtMs = resetAtMs;
  if (policy !== undefined) info.policy = policy;
  return info;
}

export interface ClassifyInput {
  status: number;
  headers: Headers;
  body: unknown;
  write: boolean;
  nowMs: number;
}

function bodyParts(body: unknown): { name?: string; message?: string } {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    const out: { name?: string; message?: string } = {};
    if (typeof b.error === 'string') out.name = b.error;
    if (typeof b.message === 'string') out.message = b.message;
    else if (typeof b.error_description === 'string') out.message = b.error_description;
    return out;
  }
  return {};
}

const REVOKED = new Set(['InvalidToken', 'AuthMissing', 'AuthenticationRequired', 'InvalidGrant', 'invalid_grant', 'invalid_token', 'AccountDeactivated']);
const TAKEN = new Set(['AccountTakedown', 'AccountSuspended']);

/** Turns a non-2xx answer into a classified error. */
export function classifyResponse(input: ClassifyInput): NetworkError {
  const { status, headers, body, write, nowMs } = input;
  const rate = parseRateLimit(headers, nowMs);
  const { name, message: bodyMessage } = bodyParts(body);
  const message = bodyMessage ?? name ?? `HTTP ${status}`;
  const make = (kind: ErrorKind, extra: Partial<NetworkError> = {}): NetworkError => {
    const e: NetworkError = { kind, status, message, outcomeUnknown: false, ...extra };
    if (name !== undefined && e.code === undefined) e.code = name;
    if (rate) e.rate = rate;
    return e;
  };

  if (status === 429 || name === 'RateLimitExceeded') {
    const retryAfter = headers.get('retry-after');
    const header = (retryAfter ? parseInstant(retryAfter, nowMs) : undefined) ?? rate?.resetAtMs;
    return make('rate_limited', {
      code: 'RateLimitExceeded',
      retryAtMs: header ?? nowMs + WINDOW_DEFAULT_MS,
      retryAtSource: header !== undefined ? 'header' : 'window_default',
    });
  }
  if (name === 'ExpiredToken') return make('auth_expired');
  if (name === 'AuthFactorTokenRequired') return make('auth_factor_required');
  if (name && TAKEN.has(name)) return make('forbidden');
  if (name === 'RecordNotFound' || name === 'HandleNotFound' || name === 'NotFound') return make('not_found');
  if (name && REVOKED.has(name)) return make('auth_revoked');
  if (status === 401) return make('auth_revoked', { code: name ?? 'Unauthorized' });
  if (status === 403) return make('forbidden', { code: name ?? 'Forbidden' });
  if (status === 404) return make('not_found', { code: name ?? 'NotFound' });
  if (status === 413 || name === 'BlobTooLarge' || name === 'PayloadTooLarge') return make('validation', { code: name ?? 'PayloadTooLarge' });
  if (status >= 400 && status < 500) return make('validation', { code: name ?? 'InvalidRequest' });
  if (status >= 500) {
    return write ? make('unknown_outcome', { code: name ?? 'ServerError', outcomeUnknown: true }) : make('server_error', { code: name ?? 'ServerError' });
  }
  return make('invalid_response', { code: 'unexpected_status' });
}

export function classifyThrown(err: unknown, write: boolean): NetworkError {
  const name = err instanceof Error ? err.name : 'Error';
  const timedOut = name === 'TimeoutError' || name === 'AbortError';
  const message = err instanceof Error && err.message ? err.message : String(err);
  return write
    ? { kind: 'unknown_outcome', code: timedOut ? 'timeout' : 'network', message, outcomeUnknown: true }
    : { kind: 'network_error', code: timedOut ? 'timeout' : 'network', message, outcomeUnknown: false };
}
