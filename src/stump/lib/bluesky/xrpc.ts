// Authenticated XRPC calls to one PDS: bearer tokens for app-password sessions, DPoP for OAuth,
// a refresh when the access token has run out, and a single retry afterwards.
//
// Sources:
//   XRPC over HTTP (GET with query parameters, POST with a JSON or raw body, /xrpc/<nsid>):
//     https://atproto.com/specs/xrpc
//   Expired access tokens answer ExpiredToken; refreshSession spends the refresh token:
//     lexicons com.atproto.server.refreshSession (see session.ts)
//   DPoP and token refresh for OAuth sessions: see oauth.ts and dpop-send.ts

import { dpopSend, type NonceBox } from './dpop-send.ts';
import { fail, ok, type Result } from './errors.ts';
import { send, type HttpDeps, type RawRequest, type RawResponse } from './http.ts';
import { refreshOAuth, type OAuthClientConfig } from './oauth.ts';
import { refreshSession } from './session.ts';
import type { BlueskyAuth, OAuthAuth, PasswordAuth } from './types.ts';

export interface XrpcCall {
  nsid: string;
  method: 'GET' | 'POST';
  query?: Record<string, string>;
  json?: unknown;
  bytes?: { data: Uint8Array; contentType: string };
  /** Changes state on the network: a lost answer is an unknown outcome. */
  write: boolean;
  /** Default true. Reads of public records pass false. */
  authenticated?: boolean;
  allowEmpty?: boolean;
}

export interface TransportConfig extends HttpDeps {
  pdsUrl: string;
  auth: BlueskyAuth | null;
  oauthClient?: OAuthClientConfig;
  /** Called with the new session whenever tokens change. Persist it before the next call. */
  onAuthChange?: (auth: BlueskyAuth) => void | Promise<void>;
}

export interface Transport {
  call(call: XrpcCall): Promise<Result<RawResponse>>;
  auth(): BlueskyAuth | null;
  refresh(): Promise<Result<true>>;
}

const REFRESH_MARGIN_MS = 30_000;

function isOAuth(a: BlueskyAuth | null): a is OAuthAuth {
  return a?.kind === 'oauth';
}

export function createTransport(config: TransportConfig): Transport {
  let auth = config.auth;
  let refreshing: Promise<Result<true>> | null = null;
  const now = config.now ?? Date.now;
  const pdsNonce: NonceBox = { value: isOAuth(auth) ? auth.nonces.pds : null };

  const doRefresh = async (): Promise<Result<true>> => {
    if (!auth) return fail({ kind: 'auth_revoked', code: 'no_session', message: 'No session to refresh', outcomeUnknown: false });
    if (auth.kind === 'password') {
      const res = await refreshSession(config, config.pdsUrl, auth.refreshJwt);
      if (!res.ok) return fail(res.error);
      auth = res.value.auth satisfies PasswordAuth;
    } else {
      if (!config.oauthClient) return fail({ kind: 'validation', code: 'oauth_client_missing', message: 'Refreshing an OAuth session needs the OAuth client configuration', outcomeUnknown: false });
      const res = await refreshOAuth(config, config.oauthClient, auth);
      if (!res.ok) return fail(res.error);
      auth = { ...res.value, nonces: { authServer: res.value.nonces.authServer, pds: pdsNonce.value } };
    }
    await config.onAuthChange?.(auth);
    return ok(true);
  };

  // One refresh at a time: refresh tokens are spent when used.
  const refresh = (): Promise<Result<true>> => {
    refreshing ??= doRefresh().finally(() => {
      refreshing = null;
    });
    return refreshing;
  };

  const expiresAt = (): number | null => (auth === null ? null : auth.kind === 'password' ? auth.accessExpiresAtMs : auth.expiresAtMs);

  const once = async (c: XrpcCall): Promise<Result<RawResponse>> => {
    const qs = c.query ? `?${new URLSearchParams(c.query).toString()}` : '';
    const url = `${config.pdsUrl}/xrpc/${c.nsid}${qs}`;
    const headers: Record<string, string> = { accept: 'application/json' };
    let body: string | Uint8Array | undefined;
    if (c.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(c.json);
    } else if (c.bytes) {
      headers['content-type'] = c.bytes.contentType;
      body = c.bytes.data;
    }
    const base = { method: c.method, url, headers, write: c.write, ...(c.allowEmpty ? { allowEmpty: true } : {}) };
    const authed = c.authenticated !== false;
    if (!authed || !auth) {
      const raw: RawRequest = body === undefined ? base : { ...base, body };
      return send(config, raw);
    }
    if (auth.kind === 'password') {
      headers.authorization = `Bearer ${auth.accessJwt}`;
      const raw: RawRequest = body === undefined ? { ...base, headers } : { ...base, headers, body };
      return send(config, raw);
    }
    const res = await dpopSend(config, auth.dpopKey, pdsNonce, {
      ...base,
      headers,
      accessToken: auth.accessToken,
      ...(body === undefined ? {} : { body: async () => body! }),
    });
    return res;
  };

  const call = async (c: XrpcCall): Promise<Result<RawResponse>> => {
    const authed = c.authenticated !== false && auth !== null;
    if (authed) {
      const exp = expiresAt();
      if (exp !== null && now() >= exp - REFRESH_MARGIN_MS) {
        const r = await refresh();
        if (!r.ok) return fail(r.error);
      }
    }
    const first = await once(c);
    if (first.ok || !authed) return first;
    const expired =
      first.error.kind === 'auth_expired' ||
      (isOAuth(auth) && first.error.status === 401 && (first.error.code === 'InvalidToken' || first.error.code === 'invalid_token'));
    if (!expired) return first;
    // The token ran out before the request was processed, so repeating it is safe.
    const r = await refresh();
    if (!r.ok) return fail(r.error);
    return once(c);
  };

  return { call, auth: () => auth, refresh };
}
