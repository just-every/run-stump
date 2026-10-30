// App registration per instance, the OAuth consent URL, code exchange and revocation.
//
// Sources:
//   POST /api/v1/apps:   https://docs.joinmastodon.org/methods/apps/
//   OAuth flow, PKCE S256 (4.3+), token, revoke: https://docs.joinmastodon.org/methods/oauth/
//   Scopes:              https://docs.joinmastodon.org/api/oauth-scopes/

import { fail, invalidResponse, ok, type Result } from './errors.ts';
import { formBody, send, type HttpDeps } from './http.ts';

/** What Stump needs: read the account and bot flag, read back statuses, post, upload media. */
export const DEFAULT_SCOPES = 'read:accounts read:statuses write:statuses write:media';

export interface RegisteredApp {
  clientId: string;
  clientSecret: string;
  name: string;
  scopes: string[];
  redirectUris: string[];
  website: string | null;
}

export async function registerApp(
  deps: HttpDeps,
  origin: string,
  input: { clientName: string; redirectUris: string[]; scopes?: string; website?: string },
): Promise<Result<RegisteredApp>> {
  const scopes = input.scopes ?? DEFAULT_SCOPES;
  const body = formBody([
    ['client_name', input.clientName],
    ['redirect_uris', input.redirectUris.join('\n')],
    ['scopes', scopes],
  ]);
  if (input.website) body.append('website', input.website);
  const res = await send(deps, { method: 'POST', url: `${origin}/api/v1/apps`, body, write: true, headers: { accept: 'application/json' } });
  if (!res.ok) return fail(res.error);
  const j = res.value.json as Record<string, unknown>;
  if (typeof j.client_id !== 'string' || typeof j.client_secret !== 'string') {
    return invalidResponse('App registration answered without client_id and client_secret', res.value.status);
  }
  const redirects = Array.isArray(j.redirect_uris) ? (j.redirect_uris as unknown[]).filter((u): u is string => typeof u === 'string') : typeof j.redirect_uri === 'string' ? (j.redirect_uri as string).split('\n') : input.redirectUris;
  const scopeList = Array.isArray(j.scopes) ? (j.scopes as unknown[]).filter((s): s is string => typeof s === 'string') : scopes.split(' ');
  return ok({
    clientId: j.client_id,
    clientSecret: j.client_secret,
    name: typeof j.name === 'string' ? j.name : input.clientName,
    scopes: scopeList,
    redirectUris: redirects,
    website: typeof j.website === 'string' ? j.website : null,
  });
}

export interface AuthorizeUrlInput {
  clientId: string;
  redirectUri: string;
  scopes?: string;
  /** Binds the consent to the signed-in person who asked for it; returned unchanged on the callback. */
  state: string;
  /** S256 challenge from createPkce(), for instances at 4.3 or later. */
  codeChallenge?: string;
  forceLogin?: boolean;
  lang?: string;
}

export function buildAuthorizeUrl(origin: string, input: AuthorizeUrlInput): string {
  const q = new URLSearchParams();
  q.set('response_type', 'code');
  q.set('client_id', input.clientId);
  q.set('redirect_uri', input.redirectUri);
  q.set('scope', input.scopes ?? DEFAULT_SCOPES);
  q.set('state', input.state);
  if (input.codeChallenge) {
    q.set('code_challenge', input.codeChallenge);
    q.set('code_challenge_method', 'S256');
  }
  if (input.forceLogin) q.set('force_login', 'true');
  if (input.lang) q.set('lang', input.lang);
  return `${origin}/oauth/authorize?${q.toString()}`;
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Random URL-safe token for state values and PKCE verifiers. */
export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function createPkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomToken(48);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

export interface AccessToken {
  accessToken: string;
  tokenType: string;
  scope: string;
  /** Epoch milliseconds. */
  createdAtMs: number;
}

export async function exchangeCode(
  deps: HttpDeps,
  origin: string,
  input: { clientId: string; clientSecret: string; redirectUri: string; code: string; codeVerifier?: string },
): Promise<Result<AccessToken>> {
  const fields: Array<[string, string]> = [
    ['grant_type', 'authorization_code'],
    ['code', input.code],
    ['client_id', input.clientId],
    ['client_secret', input.clientSecret],
    ['redirect_uri', input.redirectUri],
  ];
  if (input.codeVerifier) fields.push(['code_verifier', input.codeVerifier]);
  // A code can be used once, so a lost answer to this call is an unknown outcome.
  const res = await send(deps, { method: 'POST', url: `${origin}/oauth/token`, body: formBody(fields), write: true, headers: { accept: 'application/json' } });
  if (!res.ok) return fail(res.error);
  const j = res.value.json as Record<string, unknown>;
  if (typeof j.access_token !== 'string') return invalidResponse('Token answer has no access_token', res.value.status);
  return ok({
    accessToken: j.access_token,
    tokenType: typeof j.token_type === 'string' ? j.token_type : 'Bearer',
    scope: typeof j.scope === 'string' ? j.scope : '',
    createdAtMs: typeof j.created_at === 'number' ? j.created_at * 1000 : Date.now(),
  });
}

/** Revokes a token at the instance. Idempotent there: revoking twice answers 200. */
export async function revokeToken(
  deps: HttpDeps,
  origin: string,
  input: { clientId: string; clientSecret: string; token: string },
): Promise<Result<true>> {
  const res = await send(deps, {
    method: 'POST',
    url: `${origin}/oauth/revoke`,
    body: formBody([
      ['client_id', input.clientId],
      ['client_secret', input.clientSecret],
      ['token', input.token],
    ]),
    write: true,
    headers: { accept: 'application/json' },
  });
  if (!res.ok) return fail(res.error);
  return ok(true);
}
