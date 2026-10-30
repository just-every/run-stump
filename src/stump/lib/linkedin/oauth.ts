/**
 * LinkedIn 3-legged OAuth for a member: openid profile w_member_social.
 *
 * Sources (read 30 Oct 2026):
 *  - https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
 *      authorize at https://www.linkedin.com/oauth/v2/authorization (response_type, client_id,
 *      redirect_uri, state, space-delimited scope); the code lives 30 minutes; exchange at
 *      POST https://www.linkedin.com/oauth/v2/accessToken (form: grant_type, code, client_id,
 *      client_secret, redirect_uri); access tokens last 60 days; refresh tokens exist only for
 *      approved partners (programmatic refresh), otherwise the member goes through consent again.
 *  - https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2
 *      scopes openid and profile
 *  - https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin
 *      w_member_social comes with the Share on LinkedIn product
 */
import { classifyLinkedInResponse, classifyLinkedInThrown } from './errors'
import { parseJson, timedFetch } from './http'
import type { FetchFn, LinkedInError, LinkedInOutcome } from './types'

export const LINKEDIN_AUTHORIZE_URL = 'https://www.linkedin.com/oauth/v2/authorization'
export const LINKEDIN_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken'
export const LINKEDIN_MEMBER_SCOPES = ['openid', 'profile', 'w_member_social'] as const

export interface LinkedInAppKeys {
  clientId: string
  clientSecret: string
}

export interface LinkedInTokenSet {
  accessToken: string
  /** ISO time the access token stops working (60 days after issue). */
  expiresAt: string
  /** Present only for apps LinkedIn approved for programmatic refresh. */
  refreshToken: string | null
  refreshTokenExpiresAt: string | null
  scopes: string[]
  idToken: string | null
}

/** A random URL-safe string for `state`. */
export function createLinkedInState(byteLength = 24): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength))
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** The consent URL a person opens to connect their LinkedIn profile to the company's app. */
export function buildLinkedInAuthorizeUrl(input: {
  clientId: string
  redirectUri: string
  state: string
  scopes?: readonly string[]
}): string {
  const url = new URL(LINKEDIN_AUTHORIZE_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('state', input.state)
  url.searchParams.set('scope', (input.scopes ?? LINKEDIN_MEMBER_SCOPES).join(' '))
  return url.toString()
}

/** Reads `code`, `state` and the cancel errors (user_cancelled_login, user_cancelled_authorize) off the redirect. */
export function parseLinkedInCallback(url: string): { code: string | null; state: string | null; error: string | null; errorDescription: string | null } {
  const q = new URL(url).searchParams
  return { code: q.get('code'), state: q.get('state'), error: q.get('error'), errorDescription: q.get('error_description') }
}

interface TokenCall {
  fetch: FetchFn
  keys: LinkedInAppKeys
  timeoutMs?: number
  now?: () => number
  tokenUrl?: string
}

async function postToken(call: TokenCall, params: Record<string, string>): Promise<LinkedInOutcome<LinkedInTokenSet>> {
  const body = new URLSearchParams({ ...params, client_id: call.keys.clientId, client_secret: call.keys.clientSecret })
  const req = { method: 'POST', visible: false }
  const got = await timedFetch(
    call.fetch,
    call.tokenUrl ?? LINKEDIN_TOKEN_URL,
    { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: body.toString() },
    call.timeoutMs ?? 30_000,
  )
  if (!got.ok) return { ok: false, error: classifyLinkedInThrown(got.err, req, got.timedOut) }
  const json = parseJson(got.text) as Record<string, any> | null
  if (got.res.status < 200 || got.res.status > 299) {
    return { ok: false, error: classifyLinkedInResponse(got.res.status, got.res.headers, json, got.text, req, (call.now ?? Date.now)()) }
  }
  if (!json || typeof json.access_token !== 'string' || json.access_token === '') {
    const error: LinkedInError = {
      kind: 'invalid_request', status: got.res.status, message: 'LinkedIn answered without an access token.', providerCode: null,
      serviceErrorCode: null, code: 'no_access_token', limitScope: null, resetAt: null, retry: 'never', mayHaveApplied: false,
    }
    return { ok: false, error }
  }
  const now = (call.now ?? Date.now)()
  const expiresIn = Number(json.expires_in)
  const refreshIn = Number(json.refresh_token_expires_in)
  return {
    ok: true,
    status: got.res.status,
    value: {
      accessToken: json.access_token,
      expiresAt: new Date(now + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 5_184_000) * 1000).toISOString(),
      refreshToken: typeof json.refresh_token === 'string' && json.refresh_token ? json.refresh_token : null,
      refreshTokenExpiresAt: typeof json.refresh_token === 'string' && Number.isFinite(refreshIn) ? new Date(now + refreshIn * 1000).toISOString() : null,
      scopes: typeof json.scope === 'string' && json.scope ? json.scope.split(/[\s,]+/).filter(Boolean) : [],
      idToken: typeof json.id_token === 'string' ? json.id_token : null,
    },
  }
}

/** Trades the one-time code for a token. The code lives 30 minutes and works once. */
export function exchangeLinkedInCode(input: TokenCall & { code: string; redirectUri: string }): Promise<LinkedInOutcome<LinkedInTokenSet>> {
  return postToken(input, { grant_type: 'authorization_code', code: input.code, redirect_uri: input.redirectUri })
}

/**
 * Programmatic refresh, available only where LinkedIn enabled it for the app. Without it the
 * member reconnects through consent when the 60-day token ends.
 */
export function refreshLinkedInToken(input: TokenCall & { refreshToken: string }): Promise<LinkedInOutcome<LinkedInTokenSet>> {
  return postToken(input, { grant_type: 'refresh_token', refresh_token: input.refreshToken })
}

export type LinkedInTokenStatus = 'valid' | 'expiring' | 'expired'

/** `expiring` means within `warnMs` (default 7 days): ask the person to reconnect before items are held. */
export function linkedInTokenStatus(tokens: Pick<LinkedInTokenSet, 'expiresAt'>, now: number = Date.now(), warnMs = 7 * 86_400_000): LinkedInTokenStatus {
  const left = Date.parse(tokens.expiresAt) - now
  if (left <= 0) return 'expired'
  return left <= warnMs ? 'expiring' : 'valid'
}
