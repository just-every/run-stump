import { completeOAuth, createBlueskyClient, createSession, discoverOAuth, resolveIdentity, resolveIdentityAtServer, startOAuth, type BlueskyAuth, type PendingOAuth } from '../lib/bluesky/index.ts'
import { buildLinkedInAuthorizeUrl, exchangeLinkedInCode, getLinkedInMember } from '../lib/linkedin/index.ts'
import { buildAuthorizeUrl, createMastodonClient, createPkce, exchangeCode, normalizeInstance, randomToken, registerApp, revokeToken, type RegisteredApp } from '../lib/mastodon/index.ts'
import { buildXAuthorizeUrl, createPkcePair, exchangeXCode, getXMe, revokeXToken } from '../lib/x/index.ts'
import { refuse } from '../actions/refusals.ts'
import type { ActionContext } from '../actions/types.ts'
import { stumpFetch } from '../net/fetch.ts'
import { IMPORT_HOLD_SQL, moveItem, type ItemState } from '../items/state.ts'
import { appKeys, callbackUrl, NETWORK_NAMES, type Network } from './apps.ts'
import { blueskyOAuthClient } from './clients.ts'
import { digest, seal, unseal } from './seal.ts'
import { accountView, openCredentials, readAccount, sealCredentials, type AccountRow, type Credentials } from './store.ts'

// Connecting an account through the network's own consent screen (or a
// Bluesky app password where the server offers no consent screen). A consent
// is bound to the person who asked for it, and an account has one owner
// (STUMP-PUBLISH-001, STUMP-CONNECT-001, D-1).

const CONSENT_MINUTES = 15
const DEFAULT_BLUESKY_SERVICE = 'https://bsky.social'

const loopback = (hostname: string) => {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host)
}
const originOf = (url: string) => { try { return new URL(url).origin } catch { return null } }

/** A Bluesky server a person names: an https origin, or an http one on this machine in a local runtime. */
function namedServer(ctx: ActionContext, value: string): string {
  let url: URL | null = null
  try { url = new URL(value.trim()) } catch { /* refused below */ }
  const local = !!url && ctx.env.AUTH_LOCAL === 'true' && loopback(url.hostname)
  if (!url || !(url.protocol === 'https:' || (local && url.protocol === 'http:')) || url.pathname.replace(/\/+$/, '') !== '' || url.search || url.hash || url.username || url.password) {
    refuse('invalid_arguments', { field: 'service', reason: 'Name the Bluesky server by its https address, such as https://bsky.social.' })
  }
  return url.origin
}

/**
 * Who a Bluesky handle or DID is, from the public record: the handle resolved and named
 * back by its DID document, which comes from the PLC directory (did:plc) or its own
 * domain (did:web). A named server is only checked against that record. Only a local
 * runtime asks a server on this machine, a development PDS with its own PLC, to answer
 * for its own accounts.
 */
async function blueskyIdentity(ctx: ActionContext, identifier: string, service: string | null, stored: string | null) {
  const fetch = stumpFetch(ctx.env), hint = service ?? stored, hintOrigin = hint ? originOf(hint) : null
  const local = !!hintOrigin && ctx.env.AUTH_LOCAL === 'true' && loopback(new URL(hintOrigin).hostname)
  const identity = local
    ? await resolveIdentityAtServer({ fetch }, hintOrigin!, identifier)
    : await resolveIdentity({ fetch }, identifier, { handleResolverUrl: DEFAULT_BLUESKY_SERVICE })
  if (!identity.ok) networkError('bluesky', identity.error)
  if (service && originOf(identity.value.pdsUrl) !== service) {
    networkError('bluesky', { kind: 'validation', code: 'pds_mismatch', message: `${identity.value.did} keeps its records on ${identity.value.pdsUrl}, not ${service}.` })
  }
  return { ...identity.value, local }
}

type Pending =
  | { network: 'mastodon'; origin: string; redirect_uri: string; verifier: string }
  | { network: 'bluesky'; method: 'oauth'; oauth: PendingOAuth }
  | { network: 'bluesky'; method: 'app_password'; did: string; handle: string | null; pds_url: string }
  | { network: 'x'; verifier: string; redirect_uri: string }
  | { network: 'linkedin'; redirect_uri: string }

interface ConnectionRow { id: string; network: Network; owner_kind: 'person' | 'company'; person_id: string; account_id: string | null; method: 'oauth' | 'app_password'; pending: string; expires_at: number; completed_at: number | null }

const isAdmin = (ctx: ActionContext) => ctx.person.role === 'owner' || ctx.person.role === 'admin'

/** Who may act on an account: its owner, or for a company account the owner and admins. */
export function mayManage(ctx: ActionContext, row: AccountRow): boolean {
  return row.owner_kind === 'company' ? isAdmin(ctx) : row.owner_person_id === ctx.person.id
}

async function ownerName(db: D1Database, row: Pick<AccountRow, 'owner_kind' | 'owner_person_id'>) {
  if (row.owner_kind === 'company') return 'the company'
  return (await db.prepare('SELECT display_name FROM stump_people WHERE id=?').bind(row.owner_person_id).first<{ display_name: string }>())?.display_name ?? 'someone else'
}

function networkError(network: Network, error: { message: string; code?: string | null; kind?: string }): never {
  return refuse('network_refused', { network, code: error.code ?? error.kind ?? 'error', message: error.message })
}

async function mastodonApp(ctx: ActionContext, origin: string, redirectUri: string): Promise<RegisteredApp> {
  const stored = await ctx.db.prepare('SELECT registration FROM stump_mastodon_apps WHERE origin=? AND redirect_uri=?').bind(origin, redirectUri).first<{ registration: string }>()
  if (stored) return unseal<RegisteredApp>(ctx.env, `mastodon-app:${origin}`, stored.registration)
  const registered = await registerApp({ fetch: stumpFetch(ctx.env) }, origin, { clientName: 'Stump', redirectUris: [redirectUri], website: ctx.env.AUTH_ORIGIN })
  if (!registered.ok) networkError('mastodon', registered.error)
  await ctx.db.prepare('INSERT INTO stump_mastodon_apps(origin,redirect_uri,registration,created_at) VALUES(?,?,?,?) ON CONFLICT DO NOTHING')
    .bind(origin, redirectUri, await seal(ctx.env, `mastodon-app:${origin}`, registered.value), ctx.now()).run()
  return registered.value
}

export interface StartInput { network: Network; owner: 'me' | 'company'; instance?: string; service?: string; handle?: string; account?: AccountRow }

/**
 * One network account has one owner (STUMP-PUBLISH-001.3): connecting an account
 * Stump already holds for someone else is refused, naming that owner, and the
 * consent that proved its identity is given back to the network.
 */
async function refuseOwnedElsewhere(ctx: ActionContext, network: Network, networkUserId: string, owner: { kind: 'person' | 'company'; person_id: string | null }, revoke?: () => Promise<void>) {
  const existing = await ctx.db.prepare('SELECT * FROM stump_accounts WHERE network=? AND network_user_id=?').bind(network, networkUserId).first<AccountRow>()
  if (!existing || (existing.owner_kind === owner.kind && existing.owner_person_id === owner.person_id)) return existing
  await revoke?.()
  refuse('account_owned', { network, handle: existing.handle, owner: { kind: existing.owner_kind, person_id: existing.owner_person_id, name: await ownerName(ctx.db, existing) } })
}

/** Begins a connection; answers the consent URL, or the app-password step where a PDS has no consent screen. */
export async function startConnection(ctx: ActionContext, input: StartInput) {
  const { network } = input
  if (input.owner === 'company' && !isAdmin(ctx)) refuse('forbidden', { reason: 'company_accounts_need_admin', role: ctx.person.role })
  const state = randomToken(32), id = crypto.randomUUID(), fetch = stumpFetch(ctx.env)
  let pending: Pending, consentUrl: string | null = null
  if (network === 'mastodon') {
    const instance = normalizeInstance(input.instance ?? input.account?.instance ?? '')
    if (!instance.ok) refuse('invalid_arguments', { field: 'instance', reason: instance.message })
    const redirectUri = callbackUrl(ctx.env, 'mastodon'), app = await mastodonApp(ctx, instance.origin, redirectUri), pkce = await createPkce()
    pending = { network, origin: instance.origin, redirect_uri: redirectUri, verifier: pkce.verifier }
    consentUrl = buildAuthorizeUrl(instance.origin, { clientId: app.clientId, redirectUri, state, codeChallenge: pkce.challenge })
  } else if (network === 'bluesky') {
    // A reconnect names the account by its own DID; its stored server is only a hint, since an account may move to another server.
    const identifier = (input.account?.network_user_id ?? input.handle ?? input.account?.handle ?? '').trim().replace(/^@/, '')
    if (!identifier) refuse('invalid_arguments', { field: 'handle' })
    const identity = await blueskyIdentity(ctx, identifier, input.service === undefined ? null : namedServer(ctx, input.service), input.account?.instance ?? null)
    // The handle already names its DID, so an account someone else owns is refused here, before any consent screen.
    await refuseOwnedElsewhere(ctx, 'bluesky', identity.did, { kind: input.owner === 'company' ? 'company' : 'person', person_id: input.owner === 'company' ? null : ctx.person.id })
    const offered = await discoverOAuth({ fetch }, identity.pdsUrl)
    if (!offered.ok) networkError('bluesky', offered.error)
    if (offered.value === null) {
      pending = { network, method: 'app_password', did: identity.did, handle: identity.handle, pds_url: identity.pdsUrl }
    } else {
      const started = await startOAuth({ fetch }, blueskyOAuthClient(ctx.env), { identifier: identity.did, handleResolverUrl: identity.local ? identity.pdsUrl : DEFAULT_BLUESKY_SERVICE, identity })
      if (!started.ok) networkError('bluesky', started.error)
      // The library made its own state; Stump's binds the consent to this person.
      pending = { network, method: 'oauth', oauth: started.value.pending }
      consentUrl = started.value.authorizeUrl
      await insert(ctx, id, await digest(started.value.pending.state), input, 'oauth', pending)
      return { connection_id: id, network, consent_url: consentUrl, expires_at: new Date(ctx.now() + CONSENT_MINUTES * 60_000).toISOString() }
    }
  } else if (network === 'x') {
    const keys = await appKeys(ctx.db, ctx.env, 'x')
    if (!keys) refuse('app_not_set', { network })
    const pkce = await createPkcePair(), redirectUri = callbackUrl(ctx.env, 'x')
    pending = { network, verifier: pkce.verifier, redirect_uri: redirectUri }
    consentUrl = buildXAuthorizeUrl({ clientId: keys.clientId, redirectUri, state, codeChallenge: pkce.challenge })
  } else {
    const keys = await appKeys(ctx.db, ctx.env, 'linkedin')
    if (!keys) refuse('app_not_set', { network })
    const redirectUri = callbackUrl(ctx.env, 'linkedin')
    pending = { network, redirect_uri: redirectUri }
    consentUrl = buildLinkedInAuthorizeUrl({ clientId: keys.clientId, redirectUri, state })
  }
  const method = pending.network === 'bluesky' && pending.method === 'app_password' ? 'app_password' : 'oauth'
  await insert(ctx, id, await digest(state), input, method, pending)
  const expires_at = new Date(ctx.now() + CONSENT_MINUTES * 60_000).toISOString()
  return method === 'app_password'
    ? { connection_id: id, network, needs: 'app_password' as const, handle: pending.network === 'bluesky' && pending.method === 'app_password' ? pending.handle : null, expires_at }
    : { connection_id: id, network, consent_url: consentUrl, expires_at }
}

async function insert(ctx: ActionContext, id: string, stateHash: string, input: StartInput, method: 'oauth' | 'app_password', pending: Pending) {
  await ctx.db.prepare(`INSERT INTO stump_connections(id,state_hash,network,owner_kind,person_id,agent_id,account_id,method,pending,created_at,expires_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(id, stateHash, input.network, input.owner === 'company' ? 'company' : 'person', ctx.person.id, ctx.agent?.id ?? null,
      input.account?.id ?? null, method, await seal(ctx.env, `connection:${id}`, pending), ctx.now(), ctx.now() + CONSENT_MINUTES * 60_000).run()
}

export interface CompleteInput { state?: string; connection_id?: string; code?: string; iss?: string; error?: string; app_password?: string }

interface Connected { networkUserId: string; handle: string; displayName: string | null; instance: string | null; credentials: Credentials; expiresAt: number | null
  /** The follower count the network reports at connect; null where it reports none (a LinkedIn member). */
  followers: number | null
  bot?: boolean; botRules?: Array<{ id: string; text: string }>; postLimit?: number | null; revoke(): Promise<void> }

/** Finishes a connection the same person started, and answers the account. */
export async function completeConnection(ctx: ActionContext, input: CompleteInput) {
  const connection = input.state
    ? await ctx.db.prepare('SELECT * FROM stump_connections WHERE state_hash=?').bind(await digest(input.state)).first<ConnectionRow>()
    : input.connection_id ? await ctx.db.prepare('SELECT * FROM stump_connections WHERE id=?').bind(input.connection_id).first<ConnectionRow>() : null
  if (!connection) refuse('not_found', { connection: input.connection_id ?? 'state' })
  // A consent belongs to the person who asked for it, and cannot connect an account for anyone else.
  if (connection.person_id !== ctx.person.id) refuse('consent_not_yours', { connection_id: connection.id })
  if (connection.completed_at !== null) refuse('consent_used', { connection_id: connection.id })
  if (connection.expires_at < ctx.now()) refuse('consent_expired', { connection_id: connection.id })
  if (input.error) refuse('consent_declined', { network: connection.network, error: input.error })
  const pending = await unseal<Pending>(ctx.env, `connection:${connection.id}`, connection.pending)
  const connected = await exchange(ctx, connection, pending, input)
  const reconnecting = connection.account_id ? await readAccount(ctx.db, connection.account_id) : null
  const ownerKind = connection.owner_kind, ownerId = ownerKind === 'person' ? connection.person_id : null
  // Mastodon, X and LinkedIn first name the account here, once the consent is done; Bluesky was checked at start too.
  const existing = await refuseOwnedElsewhere(ctx, connection.network, connected.networkUserId, { kind: ownerKind, person_id: ownerId }, () => connected.revoke())
  if (reconnecting && existing && existing.id !== reconnecting.id) {
    await connected.revoke()
    refuse('different_account', { account_id: reconnecting.id, handle: connected.handle })
  }
  const now = ctx.now(), id = existing?.id ?? reconnecting?.id ?? crypto.randomUUID()
  const sealed = await sealCredentials(ctx.env, id, connected.credentials as Credentials)
  const fields = [connected.handle, connected.displayName, connected.instance, sealed, connected.networkUserId, connected.bot ? 1 : 0, JSON.stringify(connected.botRules ?? []), connected.postLimit ?? null, connected.expiresAt,
    connected.followers ?? null]
  if (existing || reconnecting) {
    await ctx.db.batch([
      ctx.db.prepare(`UPDATE stump_accounts SET handle=?,display_name=?,instance=?,credentials=?,network_user_id=?,bot=?,bot_rules=?,post_limit=?,token_expires_at=?,follower_count=COALESCE(?,follower_count),
        state='connected',state_reason=NULL,reconnect_url=NULL,connected_by=?,connected_at=?,disconnected_at=NULL,disconnected_by=NULL,updated_at=?,revision=revision+1 WHERE id=?`).bind(...fields, ctx.person.id, now, now, id),
      ctx.db.prepare('UPDATE stump_connections SET completed_at=?,account_id=? WHERE id=?').bind(now, id, connection.id),
    ])
  } else {
    await ctx.db.batch([
      ctx.db.prepare(`INSERT INTO stump_accounts(id,network,handle,display_name,instance,credentials,network_user_id,bot,bot_rules,post_limit,token_expires_at,follower_count,owner_kind,owner_person_id,
        connected_by,connected_at,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'connected',?,?)`).bind(id, connection.network, ...fields, ownerKind, ownerId, ctx.person.id, now, now, now),
      ctx.db.prepare('UPDATE stump_connections SET completed_at=?,account_id=? WHERE id=?').bind(now, id, connection.id),
    ])
  }
  ctx.emit('account.connected', `stump://accounts/${id}`, { network: connection.network })
  return { account: accountView((await readAccount(ctx.db, id))!) }
}

async function exchange(ctx: ActionContext, connection: ConnectionRow, pending: Pending, input: CompleteInput): Promise<Connected> {
  const fetch = stumpFetch(ctx.env), now = ctx.now
  if (pending.network === 'bluesky' && pending.method === 'app_password') {
    if (!input.app_password) refuse('invalid_arguments', { field: 'app_password' })
    const session = await createSession({ fetch }, pending.pds_url, { identifier: pending.did, password: input.app_password })
    if (!session.ok) networkError('bluesky', session.error)
    // The account stays on the server its public record names, whatever the session says.
    return bluesky(ctx, pending.pds_url, session.value.auth, { did: pending.did, handle: pending.handle })
  }
  if (!input.code) refuse('invalid_arguments', { field: 'code' })
  if (pending.network === 'mastodon') {
    const app = await mastodonApp(ctx, pending.origin, pending.redirect_uri)
    const token = await exchangeCode({ fetch }, pending.origin, { clientId: app.clientId, clientSecret: app.clientSecret, redirectUri: pending.redirect_uri, code: input.code, codeVerifier: pending.verifier })
    if (!token.ok) networkError('mastodon', token.error)
    const client = createMastodonClient({ fetch, instance: pending.origin, accessToken: token.value.accessToken })
    const [account, instance] = [await client.account(), await client.instance()]
    if (!account.ok) networkError('mastodon', account.error)
    if (!instance.ok) networkError('mastodon', instance.error)
    return {
      networkUserId: `${pending.origin}|${account.value.id}`, handle: account.value.handle.replace(/^@/, ''), displayName: account.value.displayName, instance: pending.origin,
      credentials: { network: 'mastodon', origin: pending.origin, redirect_uri: pending.redirect_uri, access_token: token.value.accessToken }, expiresAt: null,
      bot: account.value.bot, botRules: instance.value.botFlagRules, postLimit: instance.value.maxCharacters, followers: account.value.followersCount,
      revoke: async () => { await revokeToken({ fetch }, pending.origin, { clientId: app.clientId, clientSecret: app.clientSecret, token: token.value.accessToken }) },
    }
  }
  if (pending.network === 'bluesky') {
    const auth = await completeOAuth({ fetch }, blueskyOAuthClient(ctx.env), pending.oauth, { code: input.code, state: input.state ?? pending.oauth.state, iss: input.iss ?? null })
    if (!auth.ok) networkError('bluesky', auth.error)
    return bluesky(ctx, pending.oauth.pdsUrl, auth.value, { did: pending.oauth.did, handle: pending.oauth.handle })
  }
  if (pending.network === 'x') {
    const keys = await appKeys(ctx.db, ctx.env, 'x')
    if (!keys) refuse('app_not_set', { network: 'x' })
    const tokens = await exchangeXCode({ fetch, keys, code: input.code, redirectUri: pending.redirect_uri, codeVerifier: pending.verifier, now })
    if (!tokens.ok) networkError('x', tokens.error)
    const me = await getXMe({ fetch, accessToken: tokens.value.accessToken })
    if (!me.ok) networkError('x', me.error)
    return {
      networkUserId: me.value.id, handle: me.value.username, displayName: me.value.name, instance: null, expiresAt: Date.parse(tokens.value.expiresAt), followers: me.value.followers,
      credentials: { network: 'x', tokens: tokens.value, user_id: me.value.id, username: me.value.username },
      // X lets longer posts through only for subscribed accounts; everyone else has the weighted 280.
      postLimit: me.value.verifiedType && me.value.verifiedType !== 'none' ? 25_000 : 280,
      revoke: async () => { await revokeXToken({ fetch, keys, token: tokens.value.accessToken, tokenTypeHint: 'access_token' }) },
    }
  }
  const keys = await appKeys(ctx.db, ctx.env, 'linkedin')
  if (!keys) refuse('app_not_set', { network: 'linkedin' })
  const tokens = await exchangeLinkedInCode({ fetch, keys, code: input.code, redirectUri: pending.redirect_uri, now })
  if (!tokens.ok) networkError('linkedin', tokens.error)
  const member = await getLinkedInMember({ fetch, accessToken: tokens.value.accessToken })
  if (!member.ok) networkError('linkedin', member.error)
  return {
    networkUserId: member.value.sub, handle: member.value.name, displayName: member.value.name, instance: null, expiresAt: Date.parse(tokens.value.expiresAt),
    credentials: { network: 'linkedin', tokens: tokens.value, urn: member.value.urn }, postLimit: 3000,
    // Share on LinkedIn grants no read of a member's followers (docs/networks.md).
    followers: null,
    // LinkedIn's member products offer no token revocation endpoint.
    revoke: async () => {},
  }
}

/**
 * The connected Bluesky account: the identity resolved at start (its DID, handle and server),
 * which the session must be for. A session for any other DID is ended and refused.
 */
async function bluesky(ctx: ActionContext, pdsUrl: string, auth: BlueskyAuth, expected: { did: string; handle: string | null }): Promise<Connected> {
  const fetch = stumpFetch(ctx.env)
  const client = createBlueskyClient({ fetch, pdsUrl, auth, oauthClient: blueskyOAuthClient(ctx.env), onAuthChange: next => { auth = next } })
  const profile = auth.did === expected.did ? await client.profile() : null
  if (profile && !profile.ok) networkError('bluesky', profile.error)
  if (!profile || profile.value.did !== expected.did) {
    await client.disconnect()
    networkError('bluesky', { kind: 'validation', code: 'did_mismatch', message: `The server signed in as another account, not ${expected.handle ?? expected.did}.` })
  }
  const followers = await client.followers()
  return {
    networkUserId: expected.did, handle: expected.handle ?? profile.value.handle, displayName: profile.value.displayName, instance: pdsUrl,
    get credentials() { return { network: 'bluesky' as const, pds_url: pdsUrl, auth } },
    expiresAt: auth.kind === 'password' ? auth.refreshExpiresAtMs : auth.expiresAtMs, postLimit: 300, followers: followers.ok ? followers.value : null,
    revoke: async () => { await client.disconnect() },
  }
}

/**
 * Disconnects an account: revokes its access at the network where the network
 * supports that, and unschedules every item queued on it, listing them for
 * whoever reassigns them (STUMP-PUBLISH-001.5, STUMP-CONNECT-001).
 */
export async function disconnectAccount(ctx: ActionContext, row: AccountRow) {
  let revoked: 'revoked' | 'not_supported' | 'failed' | 'nothing_to_revoke' = 'nothing_to_revoke'
  // An imported post waiting for the person's release keeps waiting; the release checks the account again.
  const queued = (await ctx.db.prepare(`SELECT id,state,scheduled_at FROM stump_items WHERE account_id=? AND state IN ('scheduled','paused','held') AND NOT ${IMPORT_HOLD_SQL} ORDER BY scheduled_at,id`)
    .bind(row.id).all<{ id: string; state: ItemState; scheduled_at: number | null }>()).results
  const mover = { db: ctx.db, person: ctx.person, agent: ctx.agent, now: ctx.now }, now = ctx.now()
  // First the account stops being connected, so no refresh in flight can keep new credentials on it;
  // then whatever it holds at that moment is revoked at the network and dropped.
  await ctx.db.batch([
    ctx.db.prepare("UPDATE stump_accounts SET state='disconnected',reconnect_url=NULL,disconnected_at=?,disconnected_by=?,updated_at=?,revision=revision+1 WHERE id=?").bind(now, ctx.person.id, now, row.id),
    ...queued.flatMap(item => moveItem(mover, item, 'draft', 'account disconnected', { scheduled_at: null, queued: 0, hold: null })),
  ])
  const held = await readAccount(ctx.db, row.id)
  const creds = held?.credentials ? await openCredentials(ctx.env, held).catch(() => null) : null
  if (creds) revoked = await revokeAtNetwork(ctx, creds)
  if (held?.credentials) await ctx.db.prepare("UPDATE stump_accounts SET credentials=NULL WHERE id=? AND state='disconnected' AND credentials=?").bind(row.id, held.credentials).run()
  ctx.emit('account.disconnected', `stump://accounts/${row.id}`, { network: row.network })
  return {
    account: accountView((await readAccount(ctx.db, row.id))!), revoked,
    unscheduled: queued.map(item => ({ item_id: item.id, state: item.state, scheduled_at: item.scheduled_at === null ? null : new Date(item.scheduled_at).toISOString() })),
  }
}

async function revokeAtNetwork(ctx: ActionContext, creds: Credentials): Promise<'revoked' | 'not_supported' | 'failed'> {
  const fetch = stumpFetch(ctx.env)
  if (creds.network === 'mastodon') {
    const app = await mastodonApp(ctx, creds.origin, creds.redirect_uri)
    return (await revokeToken({ fetch }, creds.origin, { clientId: app.clientId, clientSecret: app.clientSecret, token: creds.access_token })).ok ? 'revoked' : 'failed'
  }
  if (creds.network === 'bluesky') {
    const client = createBlueskyClient({ fetch, pdsUrl: creds.pds_url, auth: creds.auth, oauthClient: blueskyOAuthClient(ctx.env) })
    return (await client.disconnect()).ok ? 'revoked' : 'failed'
  }
  if (creds.network === 'x') {
    const keys = await appKeys(ctx.db, ctx.env, 'x')
    if (!keys) return 'failed'
    // Both tokens: revoking the refresh token alone can leave the current access token working until it expires.
    const refresh = creds.tokens.refreshToken ? (await revokeXToken({ fetch, keys, token: creds.tokens.refreshToken, tokenTypeHint: 'refresh_token' })).ok : true
    const access = (await revokeXToken({ fetch, keys, token: creds.tokens.accessToken, tokenTypeHint: 'access_token' })).ok
    return refresh && access ? 'revoked' : 'failed'
  }
  return 'not_supported'
}

export const networkName = (network: Network) => NETWORK_NAMES[network]
