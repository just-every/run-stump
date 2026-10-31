import { DEFAULT_SCOPE, createBlueskyClient, type BlueskyClient, type OAuthClientConfig } from '../lib/bluesky/index.ts'
import { linkedInTokenStatus, refreshLinkedInToken, type LinkedInContext } from '../lib/linkedin/index.ts'
import { createMastodonClient, type MastodonClient } from '../lib/mastodon/index.ts'
import { ensureFreshXTokens, revokeXToken, type XContext } from '../lib/x/index.ts'
import type { StumpEnv } from '../env.ts'
import { stumpFetch } from '../net/fetch.ts'
import { appKeys, callbackUrl } from './apps.ts'
import { needsReconnect, openCredentials, reconnectStep, saveCredentials, type AccountRow, type Credentials } from './store.ts'
import { shownHandle } from './handle.ts'

// A ready network client for one connected account: credentials opened,
// refreshed where the network expires them, and stored again when they change.
// A refusal at refresh marks the account for its owner to reconnect.

export interface Opened<C> { ok: true; client: C; credentials: Credentials }
export interface NotReady { ok: false; code: 'not_connected' | 'reconnect' | 'app_not_set'; message: string; reason?: string }

/** The account already waits for its owner: the reconnect step is the reason anything on it holds. */
const waiting = (row: AccountRow): NotReady =>
  ({ ok: false, code: 'reconnect', message: `${shownHandle(row)} is ${row.state}. ${row.state_reason ?? ''}`.trim(), reason: reconnectStep(row, /revoked/i.test(row.state_reason ?? '') ? 'revoked' : 'expired') })

/** The network refused the account's credentials: it reads expired, and the reason names the reconnect step. */
async function refused(env: StumpEnv, db: D1Database, row: AccountRow, message: string, now: number): Promise<NotReady> {
  const reason = await needsReconnect(db, env, row, /revok/i.test(message) ? 'revoked' : 'expired', now)
  return { ok: false, code: 'reconnect', message, reason }
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

/**
 * Stump as an atproto OAuth client. A local installation is a loopback
 * development client (no metadata to host); a deployed one serves its client
 * metadata at /oauth/bluesky/client-metadata.json.
 */
export function blueskyOAuthClient(env: Pick<StumpEnv, 'AUTH_ORIGIN'>): OAuthClientConfig {
  const origin = new URL(env.AUTH_ORIGIN), redirectUri = callbackUrl(env, 'bluesky')
  if (origin.protocol === 'http:' && LOOPBACK.has(origin.hostname)) {
    const query = new URLSearchParams({ redirect_uri: redirectUri, scope: DEFAULT_SCOPE })
    return { clientId: `http://localhost?${query.toString()}`, redirectUri, scope: DEFAULT_SCOPE, clientAuth: { method: 'none' } }
  }
  return { clientId: `${origin.origin}/oauth/bluesky/client-metadata.json`, redirectUri, scope: DEFAULT_SCOPE, clientAuth: { method: 'none' } }
}

async function credentials(env: StumpEnv, row: AccountRow): Promise<Credentials | NotReady> {
  if (row.state === 'disconnected') return { ok: false, code: 'not_connected', message: `${shownHandle(row)} is disconnected.` }
  if (row.state !== 'connected') return waiting(row)
  const opened = await openCredentials(env, row)
  return opened ?? { ok: false, code: 'not_connected', message: `${shownHandle(row)} has no credentials.` }
}
const notReady = (value: Credentials | NotReady): value is NotReady => 'ok' in value

export async function mastodonFor(env: StumpEnv, row: AccountRow): Promise<Opened<MastodonClient> | NotReady> {
  const creds = await credentials(env, row)
  if (notReady(creds)) return creds
  if (creds.network !== 'mastodon') throw new Error('Not a Mastodon account')
  return { ok: true, credentials: creds, client: createMastodonClient({ fetch: stumpFetch(env, undefined, { named: [creds.origin] }), instance: creds.origin, accessToken: creds.access_token }) }
}

export async function blueskyFor(env: StumpEnv, db: D1Database, row: AccountRow, now: () => number): Promise<Opened<BlueskyClient> | NotReady> {
  const creds = await credentials(env, row)
  if (notReady(creds)) return creds
  if (creds.network !== 'bluesky') throw new Error('Not a Bluesky account')
  let held = row.credentials
  const client = createBlueskyClient({
    fetch: stumpFetch(env, undefined, { named: [creds.pds_url] }), pdsUrl: creds.pds_url, auth: creds.auth, oauthClient: blueskyOAuthClient(env),
    // Refresh tokens are single use: keep each new session before the next call. A session the account no
    // longer holds (disconnected or reconnected meanwhile) is ended at its server, and nothing is sent with it.
    onAuthChange: async auth => {
      const expires = auth.kind === 'password' ? auth.refreshExpiresAtMs : auth.expiresAtMs
      const kept = await saveCredentials(db, env, row.id, { ...creds, auth }, expires, now(), held)
      if (!kept) {
        await createBlueskyClient({ fetch: stumpFetch(env, undefined, { named: [creds.pds_url] }), pdsUrl: creds.pds_url, auth, oauthClient: blueskyOAuthClient(env) }).disconnect()
        throw new Error(`${shownHandle(row)} was disconnected or reconnected while its session refreshed.`)
      }
      held = kept
    },
  })
  return { ok: true, credentials: creds, client }
}

export async function xFor(env: StumpEnv, db: D1Database, row: AccountRow, now: () => number): Promise<Opened<XContext> | NotReady> {
  const creds = await credentials(env, row)
  if (notReady(creds)) return creds
  if (creds.network !== 'x') throw new Error('Not an X account')
  const keys = await appKeys(db, env, 'x')
  if (!keys) return { ok: false, code: 'app_not_set', message: 'Enter the company\'s X app keys in Settings, Publishing.' }
  const fetch = stumpFetch(env)
  const fresh = await ensureFreshXTokens({ fetch, keys, tokens: creds.tokens, now })
  if (!fresh.ok) {
    // X refused the refresh (or no refresh token is held): the grant expired or was revoked.
    if (fresh.error.kind === 'auth_revoked') return refused(env, db, row, fresh.error.message, now())
    return { ok: false, code: 'not_connected', message: fresh.error.message }
  }
  const current: Credentials = fresh.value.refreshed ? { ...creds, tokens: fresh.value.tokens } : creds
  if (fresh.value.refreshed && !await saveCredentials(db, env, row.id, current, Date.parse(fresh.value.tokens.expiresAt), now(), row.credentials)) {
    // The account was disconnected or reconnected during the refresh: the new grant goes back to X and nothing is sent.
    const tokens = fresh.value.tokens
    if (tokens.refreshToken) await revokeXToken({ fetch, keys, token: tokens.refreshToken, tokenTypeHint: 'refresh_token' })
    await revokeXToken({ fetch, keys, token: tokens.accessToken, tokenTypeHint: 'access_token' })
    return { ok: false, code: 'not_connected', message: `${shownHandle(row)} was disconnected or reconnected while its access refreshed.` }
  }
  return { ok: true, credentials: current, client: { fetch, accessToken: fresh.value.tokens.accessToken, username: creds.username } }
}

export async function linkedInFor(env: StumpEnv, db: D1Database, row: AccountRow, now: () => number): Promise<Opened<LinkedInContext> | NotReady> {
  const creds = await credentials(env, row)
  if (notReady(creds)) return creds
  if (creds.network !== 'linkedin') throw new Error('Not a LinkedIn account')
  const fetch = stumpFetch(env)
  if (linkedInTokenStatus(creds.tokens, now(), 0) !== 'expired') return { ok: true, credentials: creds, client: { fetch, accessToken: creds.tokens.accessToken } }
  // LinkedIn issues refresh tokens only to apps it approved for them; otherwise the member reconnects.
  const keys = await appKeys(db, env, 'linkedin')
  if (creds.tokens.refreshToken && keys) {
    const refreshed = await refreshLinkedInToken({ fetch, keys, refreshToken: creds.tokens.refreshToken, now })
    if (refreshed.ok) {
      const current: Credentials = { ...creds, tokens: refreshed.value }
      // LinkedIn offers no revocation: a refresh that overlapped a disconnect or a reconnect is dropped, and nothing is sent.
      if (!await saveCredentials(db, env, row.id, current, Date.parse(refreshed.value.expiresAt), now(), row.credentials)) {
        return { ok: false, code: 'not_connected', message: `${shownHandle(row)} was disconnected or reconnected while its access refreshed.` }
      }
      return { ok: true, credentials: current, client: { fetch, accessToken: refreshed.value.accessToken } }
    }
  }
  return refused(env, db, row, 'The LinkedIn access expired. Its owner reconnects it.', now())
}
