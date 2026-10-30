// atproto OAuth in the Workers runtime: client metadata, discovery, PAR, PKCE, DPoP, token exchange,
// refresh and revocation, for a PDS that offers it. App passwords stay the other way to connect.
//
// Sources:
//   atproto OAuth profile (client metadata document, discovery chain, PAR required, PKCE S256, state,
//     iss check, DPoP with nonces, sub must equal the account DID, scope atproto, transitional scope
//     transition:generic, token lifetimes): https://atproto.com/specs/oauth
//   Pushed authorization requests: RFC 9126 https://www.rfc-editor.org/rfc/rfc9126
//   DPoP: RFC 9449 https://www.rfc-editor.org/rfc/rfc9449
//   Token revocation: RFC 7009 https://www.rfc-editor.org/rfc/rfc7009
//   Authorization server metadata: RFC 8414; protected resource metadata: RFC 9728
//     https://www.rfc-editor.org/rfc/rfc8414 , https://www.rfc-editor.org/rfc/rfc9728

import { createClientAssertion, generateKeyPair, randomToken, sha256b64url, type ClientKey } from './dpop.ts';
import { dpopSend, type NonceBox } from './dpop-send.ts';
import { fail, invalidResponse, ok, type Result } from './errors.ts';
import { send, type HttpDeps } from './http.ts';
import { resolveIdentity } from './identity.ts';
import type { AuthServerRef, DpopKeyPair, OAuthAuth } from './types.ts';

export const DEFAULT_SCOPE = 'atproto transition:generic';

export type ClientAuth = { method: 'none' } | { method: 'private_key_jwt'; key: ClientKey };

/** The company's own OAuth client: the same for every account that connects. */
export interface OAuthClientConfig {
  /** https URL of the client metadata document (or the http://localhost loopback form in development). */
  clientId: string;
  redirectUri: string;
  scope?: string;
  clientAuth: ClientAuth;
}

/** The document to serve at clientId. */
export function buildClientMetadata(input: {
  clientId: string;
  clientName: string;
  clientUri: string;
  redirectUris: string[];
  scope?: string;
  clientAuth: ClientAuth;
  logoUri?: string;
  tosUri?: string;
  policyUri?: string;
}): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    client_id: input.clientId,
    application_type: 'web',
    client_name: input.clientName,
    client_uri: input.clientUri,
    grant_types: ['authorization_code', 'refresh_token'],
    scope: input.scope ?? DEFAULT_SCOPE,
    response_types: ['code'],
    redirect_uris: input.redirectUris,
    dpop_bound_access_tokens: true,
    token_endpoint_auth_method: input.clientAuth.method,
  };
  if (input.logoUri) doc.logo_uri = input.logoUri;
  if (input.tosUri) doc.tos_uri = input.tosUri;
  if (input.policyUri) doc.policy_uri = input.policyUri;
  if (input.clientAuth.method === 'private_key_jwt') {
    doc.token_endpoint_auth_signing_alg = 'ES256';
    doc.jwks = { keys: [input.clientAuth.key.publicJwk] };
  }
  return doc;
}

export interface AuthServerMetadata extends AuthServerRef {
  authorizationEndpoint: string;
  parEndpoint: string;
  scopesSupported: string[];
  supportsPrivateKeyJwt: boolean;
}

function isOrigin(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) ? url.pathname === '/' && !url.search && !url.hash : false;
  } catch {
    return false;
  }
}

/**
 * Asks a PDS whether it offers OAuth and reads its authorization server. Returns null inside ok()
 * when the PDS publishes no protected-resource metadata (it only supports app passwords).
 */
export async function discoverOAuth(deps: HttpDeps, pdsUrl: string): Promise<Result<AuthServerMetadata | null>> {
  const rs = await send(deps, { method: 'GET', url: `${pdsUrl}/.well-known/oauth-protected-resource`, headers: { accept: 'application/json' }, write: false });
  if (!rs.ok) return rs.error.kind === 'not_found' ? ok(null) : fail(rs.error);
  const servers = (rs.value.json as Record<string, unknown>).authorization_servers;
  const issuerUrl = Array.isArray(servers) && servers.length === 1 && typeof servers[0] === 'string' ? servers[0] : null;
  if (!issuerUrl || !isOrigin(issuerUrl)) return invalidResponse('The PDS must name exactly one authorization server, as a plain origin');
  const issuerOrigin = new URL(issuerUrl).origin;
  const as = await send(deps, { method: 'GET', url: `${issuerOrigin}/.well-known/oauth-authorization-server`, headers: { accept: 'application/json' }, write: false });
  if (!as.ok) return fail(as.error);
  const m = as.value.json as Record<string, unknown>;
  const strs = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === 'string') : []);
  const problems: string[] = [];
  if (m.issuer !== issuerOrigin) problems.push('issuer does not match the origin it was fetched from');
  for (const f of ['authorization_endpoint', 'token_endpoint', 'pushed_authorization_request_endpoint']) {
    if (typeof m[f] !== 'string') problems.push(`${f} is missing`);
  }
  if (m.require_pushed_authorization_requests !== true) problems.push('require_pushed_authorization_requests is not true');
  if (m.client_id_metadata_document_supported !== true) problems.push('client metadata documents are not supported');
  if (!strs(m.scopes_supported).includes('atproto')) problems.push('scope atproto is not supported');
  if (!strs(m.code_challenge_methods_supported).includes('S256')) problems.push('PKCE S256 is not supported');
  if (!strs(m.dpop_signing_alg_values_supported).includes('ES256')) problems.push('DPoP ES256 is not supported');
  if (m.authorization_response_iss_parameter_supported !== true) problems.push('the iss response parameter is not supported');
  if (problems.length > 0) return invalidResponse(`Authorization server ${issuerOrigin} does not meet the atproto OAuth profile: ${problems.join('; ')}`);
  return ok({
    issuer: issuerOrigin,
    authorizationEndpoint: m.authorization_endpoint as string,
    tokenEndpoint: m.token_endpoint as string,
    parEndpoint: m.pushed_authorization_request_endpoint as string,
    revocationEndpoint: typeof m.revocation_endpoint === 'string' ? m.revocation_endpoint : null,
    scopesSupported: strs(m.scopes_supported),
    supportsPrivateKeyJwt: strs(m.token_endpoint_auth_methods_supported).includes('private_key_jwt'),
  });
}

async function clientAuthFields(client: OAuthClientConfig, issuer: string, nowMs?: number): Promise<Array<[string, string]>> {
  const fields: Array<[string, string]> = [['client_id', client.clientId]];
  if (client.clientAuth.method === 'private_key_jwt') {
    const input: { clientId: string; issuer: string; nowMs?: number } = { clientId: client.clientId, issuer };
    if (nowMs !== undefined) input.nowMs = nowMs;
    fields.push(
      ['client_assertion_type', 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'],
      ['client_assertion', await createClientAssertion(client.clientAuth.key, input)],
    );
  }
  return fields;
}

function formBody(fields: () => Promise<Array<[string, string]>>): () => Promise<URLSearchParams> {
  return async () => {
    const p = new URLSearchParams();
    for (const [k, v] of await fields()) p.append(k, v);
    return p;
  };
}

/** What to keep, keyed by `state`, between sending the person to consent and their return. */
export interface PendingOAuth {
  state: string;
  codeVerifier: string;
  dpopKey: DpopKeyPair;
  /** The authorization server's latest DPoP nonce. */
  nonce: string | null;
  authServer: AuthServerRef;
  did: string;
  handle: string | null;
  pdsUrl: string;
  redirectUri: string;
  scope: string;
  createdAtMs: number;
}

export interface StartOAuthInput {
  /** The handle or DID the account's person typed. */
  identifier: string;
  /** Server that answers resolveHandle for the handle step (the person's PDS, or an AppView). */
  handleResolverUrl: string;
  plcDirectory?: string;
}

/**
 * Begins consent: verifies the identity, finds the PDS's authorization server, pushes the
 * authorization request (PAR) with PKCE and DPoP, and returns the URL to send the person to.
 * Returns kind not_found / code oauth_not_offered when the PDS offers only app passwords.
 */
export async function startOAuth(deps: HttpDeps, client: OAuthClientConfig, input: StartOAuthInput): Promise<Result<{ authorizeUrl: string; pending: PendingOAuth }>> {
  const idOptions: { handleResolverUrl: string; plcDirectory?: string } = { handleResolverUrl: input.handleResolverUrl };
  if (input.plcDirectory) idOptions.plcDirectory = input.plcDirectory;
  const identity = await resolveIdentity(deps, input.identifier, idOptions);
  if (!identity.ok) return fail(identity.error);
  const meta = await discoverOAuth(deps, identity.value.pdsUrl);
  if (!meta.ok) return fail(meta.error);
  if (meta.value === null) {
    return fail({ kind: 'not_found', code: 'oauth_not_offered', message: `${identity.value.pdsUrl} does not offer OAuth; connect with an app password`, outcomeUnknown: false });
  }
  if (client.clientAuth.method === 'private_key_jwt' && !meta.value.supportsPrivateKeyJwt) {
    return fail({ kind: 'validation', code: 'client_auth_unsupported', message: `${meta.value.issuer} does not accept private_key_jwt client authentication`, outcomeUnknown: false });
  }
  const scope = client.scope ?? DEFAULT_SCOPE;
  const state = randomToken(24);
  const codeVerifier = randomToken(48);
  const challenge = await sha256b64url(codeVerifier);
  const dpopKey = await generateKeyPair();
  const nonce: NonceBox = { value: null };
  const nowMs = (deps.now ?? Date.now)();
  const par = await dpopSend(deps, dpopKey, nonce, {
    method: 'POST',
    url: meta.value.parEndpoint,
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: formBody(async () => [
      ...(await clientAuthFields(client, meta.value!.issuer, nowMs)),
      ['response_type', 'code'],
      ['code_challenge', challenge],
      ['code_challenge_method', 'S256'],
      ['state', state],
      ['redirect_uri', client.redirectUri],
      ['scope', scope],
      ['login_hint', input.identifier.trim().replace(/^@/, '')],
    ]),
    write: false,
  });
  if (!par.ok) return fail(par.error);
  const requestUri = (par.value.json as Record<string, unknown>).request_uri;
  if (typeof requestUri !== 'string') return invalidResponse('The PAR answer has no request_uri', par.value.status);
  const q = new URLSearchParams({ client_id: client.clientId, request_uri: requestUri });
  const authorizeUrl = `${meta.value.authorizationEndpoint}${meta.value.authorizationEndpoint.includes('?') ? '&' : '?'}${q.toString()}`;
  return ok({
    authorizeUrl,
    pending: {
      state,
      codeVerifier,
      dpopKey,
      nonce: nonce.value,
      authServer: { issuer: meta.value.issuer, tokenEndpoint: meta.value.tokenEndpoint, revocationEndpoint: meta.value.revocationEndpoint },
      did: identity.value.did,
      handle: identity.value.handle,
      pdsUrl: identity.value.pdsUrl,
      redirectUri: client.redirectUri,
      scope,
      createdAtMs: nowMs,
    },
  });
}

export interface OAuthCallback {
  code?: string | null;
  state?: string | null;
  iss?: string | null;
  error?: string | null;
  error_description?: string | null;
}

export function parseCallback(url: string | URL): OAuthCallback {
  const u = typeof url === 'string' ? new URL(url) : url;
  const g = (k: string): string | null => u.searchParams.get(k);
  return { code: g('code'), state: g('state'), iss: g('iss'), error: g('error'), error_description: g('error_description') };
}

function tokenSession(pending: Pick<PendingOAuth, 'did' | 'handle' | 'dpopKey' | 'authServer' | 'scope'>, json: unknown, nowMs: number, nonces: OAuthAuth['nonces'], previousRefresh: string | null): Result<OAuthAuth> {
  const j = json as Record<string, unknown>;
  if (typeof j.access_token !== 'string') return invalidResponse('Token answer has no access_token');
  if (typeof j.token_type !== 'string' || j.token_type.toLowerCase() !== 'dpop') return invalidResponse('Token answer is not DPoP-bound');
  const scope = typeof j.scope === 'string' ? j.scope : pending.scope;
  if (!scope.split(' ').includes('atproto')) return invalidResponse('Token answer does not grant the atproto scope');
  return ok({
    kind: 'oauth',
    did: pending.did,
    handle: pending.handle,
    accessToken: j.access_token,
    refreshToken: typeof j.refresh_token === 'string' ? j.refresh_token : previousRefresh,
    expiresAtMs: typeof j.expires_in === 'number' ? nowMs + j.expires_in * 1000 : null,
    scope,
    dpopKey: pending.dpopKey,
    authServer: pending.authServer,
    nonces,
  });
}

/**
 * Finishes consent: checks state and the iss parameter, exchanges the code with PKCE and DPoP, and
 * checks that the token is for the account the person named (sub equals the verified DID).
 */
export async function completeOAuth(deps: HttpDeps, client: OAuthClientConfig, pending: PendingOAuth, callback: OAuthCallback): Promise<Result<OAuthAuth>> {
  if (callback.error) {
    return fail({ kind: 'forbidden', code: callback.error, message: callback.error_description ?? callback.error, outcomeUnknown: false });
  }
  if (!callback.state || callback.state !== pending.state) {
    return fail({ kind: 'validation', code: 'state_mismatch', message: 'The callback does not belong to this consent request', outcomeUnknown: false });
  }
  if (callback.iss !== pending.authServer.issuer) {
    return fail({ kind: 'validation', code: 'issuer_mismatch', message: 'The callback came from a different authorization server', outcomeUnknown: false });
  }
  if (!callback.code) return fail({ kind: 'validation', code: 'code_missing', message: 'The callback carries no code', outcomeUnknown: false });
  const nonce: NonceBox = { value: pending.nonce };
  const nowMs = (deps.now ?? Date.now)();
  const code = callback.code;
  const res = await dpopSend(deps, pending.dpopKey, nonce, {
    method: 'POST',
    url: pending.authServer.tokenEndpoint,
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: formBody(async () => [
      ...(await clientAuthFields(client, pending.authServer.issuer, nowMs)),
      ['grant_type', 'authorization_code'],
      ['code', code],
      ['redirect_uri', pending.redirectUri],
      ['code_verifier', pending.codeVerifier],
    ]),
    write: true, // a code is used once
  });
  if (!res.ok) return fail(res.error);
  const sub = (res.value.json as Record<string, unknown>).sub;
  if (sub !== pending.did) {
    return fail({ kind: 'validation', code: 'sub_mismatch', message: `The token is for ${String(sub)}, not ${pending.did}`, outcomeUnknown: false });
  }
  return tokenSession(pending, res.value.json, nowMs, { authServer: nonce.value, pds: null }, null);
}

/** Exchanges the refresh token. Refresh tokens are single use: persist the returned session before using it. */
export async function refreshOAuth(deps: HttpDeps, client: OAuthClientConfig, auth: OAuthAuth): Promise<Result<OAuthAuth>> {
  if (!auth.refreshToken) return fail({ kind: 'auth_revoked', code: 'no_refresh_token', message: 'The session has no refresh token', outcomeUnknown: false });
  const refreshToken = auth.refreshToken;
  const nonce: NonceBox = { value: auth.nonces.authServer };
  const nowMs = (deps.now ?? Date.now)();
  const res = await dpopSend(deps, auth.dpopKey, nonce, {
    method: 'POST',
    url: auth.authServer.tokenEndpoint,
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: formBody(async () => [
      ...(await clientAuthFields(client, auth.authServer.issuer, nowMs)),
      ['grant_type', 'refresh_token'],
      ['refresh_token', refreshToken],
    ]),
    write: true,
  });
  if (!res.ok) return fail(res.error);
  const sub = (res.value.json as Record<string, unknown>).sub;
  if (typeof sub === 'string' && sub !== auth.did) {
    return fail({ kind: 'validation', code: 'sub_mismatch', message: `The refreshed token is for ${sub}, not ${auth.did}`, outcomeUnknown: false });
  }
  return tokenSession({ did: auth.did, handle: auth.handle, dpopKey: auth.dpopKey, authServer: auth.authServer, scope: auth.scope }, res.value.json, nowMs, { authServer: nonce.value, pds: auth.nonces.pds }, auth.refreshToken);
}

/** Revokes the grant at the authorization server (disconnect). */
export async function revokeOAuth(deps: HttpDeps, client: OAuthClientConfig, auth: OAuthAuth): Promise<Result<true>> {
  const endpoint = auth.authServer.revocationEndpoint;
  if (!endpoint) return fail({ kind: 'validation', code: 'revocation_unsupported', message: 'The authorization server offers no revocation endpoint', outcomeUnknown: false });
  const token = auth.refreshToken ?? auth.accessToken;
  const nonce: NonceBox = { value: auth.nonces.authServer };
  const nowMs = (deps.now ?? Date.now)();
  const res = await dpopSend(deps, auth.dpopKey, nonce, {
    method: 'POST',
    url: endpoint,
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: formBody(async () => [...(await clientAuthFields(client, auth.authServer.issuer, nowMs)), ['token', token], ['token_type_hint', auth.refreshToken ? 'refresh_token' : 'access_token']]),
    write: true,
    allowEmpty: true,
  });
  if (!res.ok) return fail(res.error);
  return ok(true);
}
