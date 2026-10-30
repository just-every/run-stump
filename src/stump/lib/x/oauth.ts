/**
 * OAuth 2.0 authorization code with PKCE for X, with refresh and revoke.
 *
 * Sources (read 30 Oct 2026):
 *  - https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code
 *    authorize URL https://x.com/i/oauth2/authorize; token URL https://api.x.com/2/oauth2/token;
 *    code_challenge_method S256; the code must be exchanged within 30 seconds; access tokens
 *    last two hours; `offline.access` issues a refresh token; refresh takes
 *    grant_type=refresh_token, refresh_token and client_id; confidential clients may send
 *    HTTP Basic client_id:client_secret instead of client_id in the body.
 *  - https://docs.x.com/x-api/posts/creation-of-a-post (tweet.read, users.read, tweet.write)
 *  - https://docs.x.com/x-api/media/metadata-create (media.write)
 *
 * X rotates the refresh token on every refresh: the caller must store the new one.
 */
import { classifyXResponse, classifyXThrown } from './errors'
import { X_API_BASE } from './http'
import type { FetchFn, XError, XResult } from './types'

export const X_AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize'
export const X_TOKEN_PATH = '/2/oauth2/token'
export const X_REVOKE_PATH = '/2/oauth2/revoke'

/** What posting, thread replies, read-back, mentions and media need. */
export const X_DEFAULT_SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'offline.access', 'media.write'] as const

export interface XAppKeys {
  clientId: string
  /** Present for a confidential client (a Web App or Automated App). */
  clientSecret?: string
}

export interface XTokenSet {
  accessToken: string
  refreshToken: string | null
  /** ISO time the access token stops working. */
  expiresAt: string
  scopes: string[]
}

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A random URL-safe string for `state`. X allows up to 500 characters. */
export function createOAuthState(byteLength = 24): string {
  return b64url(crypto.getRandomValues(new Uint8Array(byteLength)))
}

/** A PKCE verifier (43 characters) and its S256 challenge. Keep the verifier server-side until the code comes back. */
export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: b64url(new Uint8Array(digest)) }
}

export interface XAuthorizeInput {
  clientId: string
  redirectUri: string
  state: string
  codeChallenge: string
  scopes?: readonly string[]
}

/** The consent URL a person opens to connect their X account to the company's app. */
export function buildXAuthorizeUrl(input: XAuthorizeInput): string {
  const url = new URL(X_AUTHORIZE_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('scope', (input.scopes ?? X_DEFAULT_SCOPES).join(' '))
  url.searchParams.set('state', input.state)
  url.searchParams.set('code_challenge', input.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

/** Reads `code`, `state` and `error` off the redirect X sends the person back to. */
export function parseXCallback(url: string): { code: string | null; state: string | null; error: string | null; errorDescription: string | null } {
  const q = new URL(url).searchParams
  return { code: q.get('code'), state: q.get('state'), error: q.get('error'), errorDescription: q.get('error_description') }
}

function basicAuth(keys: XAppKeys): string {
  const bytes = new TextEncoder().encode(`${keys.clientId}:${keys.clientSecret ?? ''}`)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return `Basic ${btoa(s)}`
}

interface TokenCall {
  fetch: FetchFn
  keys: XAppKeys
  baseUrl?: string
  timeoutMs?: number
  now?: () => number
}

async function postForm(
  call: TokenCall,
  path: string,
  params: Record<string, string>,
): Promise<{ ok: true; status: number; json: any } | { ok: false; error: XError }> {
  const form = new URLSearchParams(params)
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }
  if (call.keys.clientSecret) headers.authorization = basicAuth(call.keys)
  else form.set('client_id', call.keys.clientId)
  const req = { method: 'POST', visible: false }
  const controller = new AbortController()
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      controller.abort()
      reject(new Error('timeout'))
    }, call.timeoutMs ?? 30_000)
  })
  try {
    const exchange = (async () => {
      const r = await call.fetch((call.baseUrl ?? X_API_BASE) + path, { method: 'POST', headers, body: form.toString(), signal: controller.signal })
      return { r, t: await r.text() }
    })()
    exchange.catch(() => {})
    const { r, t } = await Promise.race([exchange, timeout])
    let json: any = null
    try {
      json = t.trim() ? JSON.parse(t) : null
    } catch {
      json = null
    }
    if (r.status < 200 || r.status > 299) return { ok: false, error: classifyXResponse(r.status, r.headers, json, t, req) }
    return { ok: true, status: r.status, json }
  } catch (err) {
    return { ok: false, error: classifyXThrown(err, req, timedOut) }
  } finally {
    clearTimeout(timer)
  }
}

function toTokenSet(json: any, now: number, fallbackScopes: readonly string[]): XTokenSet | XError {
  if (!json || typeof json.access_token !== 'string' || json.access_token === '') {
    return {
      kind: 'invalid_request', status: 200, message: 'X answered without an access token.', type: null, code: 'no_access_token',
      resetAt: null, retry: 'never', mayHaveApplied: false,
    }
  }
  const expiresIn = Number(json.expires_in)
  const seconds = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 7200
  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === 'string' && json.refresh_token ? json.refresh_token : null,
    expiresAt: new Date(now + seconds * 1000).toISOString(),
    scopes: typeof json.scope === 'string' && json.scope ? json.scope.split(/\s+/) : [...fallbackScopes],
  }
}

export interface XExchangeInput extends TokenCall {
  code: string
  redirectUri: string
  codeVerifier: string
}

/** Trades the one-time code for tokens. Do it within 30 seconds of the redirect. */
export async function exchangeXCode(input: XExchangeInput): Promise<XResult<XTokenSet>> {
  const sent = await postForm(input, X_TOKEN_PATH, {
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  })
  if (!sent.ok) return sent
  const set = toTokenSet(sent.json, (input.now ?? Date.now)(), X_DEFAULT_SCOPES)
  if ('kind' in set) return { ok: false, error: set }
  return { ok: true, value: set, status: sent.status, rateLimit: null }
}

export interface XRefreshInput extends TokenCall {
  refreshToken: string
}

/** Gets a fresh access token. Store the returned refresh token: the old one no longer works. */
export async function refreshXTokens(input: XRefreshInput): Promise<XResult<XTokenSet>> {
  const sent = await postForm(input, X_TOKEN_PATH, { grant_type: 'refresh_token', refresh_token: input.refreshToken })
  if (!sent.ok) return sent
  const set = toTokenSet(sent.json, (input.now ?? Date.now)(), X_DEFAULT_SCOPES)
  if ('kind' in set) return { ok: false, error: set }
  // A refresh answer without a new refresh token keeps the old one.
  if (!set.refreshToken) set.refreshToken = input.refreshToken
  return { ok: true, value: set, status: sent.status, rateLimit: null }
}

/** Revokes a token at X (used when a person disconnects). */
export async function revokeXToken(input: TokenCall & { token: string; tokenTypeHint?: 'access_token' | 'refresh_token' }): Promise<XResult<{ revoked: boolean }>> {
  const params: Record<string, string> = { token: input.token }
  if (input.tokenTypeHint) params.token_type_hint = input.tokenTypeHint
  const sent = await postForm(input, X_REVOKE_PATH, params)
  if (!sent.ok) return sent
  return { ok: true, value: { revoked: sent.json?.revoked !== false }, status: sent.status, rateLimit: null }
}

/** True when the access token is expired or within `skewMs` of expiring. */
export function xTokenNeedsRefresh(tokens: Pick<XTokenSet, 'expiresAt'>, now: number = Date.now(), skewMs = 60_000): boolean {
  return Date.parse(tokens.expiresAt) - skewMs <= now
}

/**
 * Returns usable tokens, refreshing first when needed. `refreshed` tells the
 * caller to store the new set. With no refresh token on an expired set the
 * result is an auth_revoked error: the person reconnects.
 */
export async function ensureFreshXTokens(
  input: TokenCall & { tokens: XTokenSet; skewMs?: number },
): Promise<XResult<{ tokens: XTokenSet; refreshed: boolean }>> {
  const now = (input.now ?? Date.now)()
  if (!xTokenNeedsRefresh(input.tokens, now, input.skewMs)) {
    return { ok: true, value: { tokens: input.tokens, refreshed: false }, status: 200, rateLimit: null }
  }
  if (!input.tokens.refreshToken) {
    return {
      ok: false,
      error: {
        kind: 'auth_revoked', status: null, message: 'The X access token expired and no refresh token is held.', type: null,
        code: 'no_refresh_token', resetAt: null, retry: 'never', mayHaveApplied: false,
      },
    }
  }
  const r = await refreshXTokens({ ...input, refreshToken: input.tokens.refreshToken })
  if (!r.ok) return r
  return { ok: true, value: { tokens: r.value, refreshed: true }, status: r.status, rateLimit: null }
}
