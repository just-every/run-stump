// Connecting with an app password: createSession, refreshSession, deleteSession, getSession.
//
// Sources:
//   com.atproto.server.createSession / refreshSession / deleteSession / getSession lexicons:
//     https://github.com/bluesky-social/atproto/tree/main/lexicons/com/atproto/server
//   refreshSession and deleteSession authenticate with the refreshJwt, not the accessJwt (lexicon text).
//   Token scopes (com.atproto.access = main password, com.atproto.appPass, com.atproto.appPassPrivileged,
//     com.atproto.refresh):
//     https://github.com/bluesky-social/atproto/blob/main/packages/pds/src/auth-scope.ts
//   createSession allows 30 per 5 minutes per account: https://docs.bsky.app/docs/advanced-guides/rate-limits

import { fail, invalidResponse, ok, type Result } from './errors.ts';
import { send, type HttpDeps } from './http.ts';
import type { PasswordAuth, PasswordKind } from './types.ts';

export function decodeJwt(jwt: string): Record<string, unknown> | null {
  const part = jwt.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const v: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function expMs(jwt: string): number | null {
  const exp = decodeJwt(jwt)?.exp;
  return typeof exp === 'number' ? exp * 1000 : null;
}

export function passwordKindOf(accessJwt: string): PasswordKind {
  const scope = decodeJwt(accessJwt)?.scope;
  if (scope === 'com.atproto.appPass') return 'app';
  if (scope === 'com.atproto.appPassPrivileged') return 'app_privileged';
  if (scope === 'com.atproto.access') return 'main';
  return 'unknown';
}

/** The PDS named in a DID document, if the document is present. */
export function pdsFromDidDoc(didDoc: unknown): string | null {
  if (!didDoc || typeof didDoc !== 'object') return null;
  const services = (didDoc as { service?: unknown }).service;
  if (!Array.isArray(services)) return null;
  for (const s of services as Array<Record<string, unknown>>) {
    const id = typeof s.id === 'string' ? s.id : '';
    if ((id === '#atproto_pds' || id.endsWith('#atproto_pds')) && typeof s.serviceEndpoint === 'string') return s.serviceEndpoint.replace(/\/+$/, '');
  }
  return null;
}

export interface SessionResult {
  auth: PasswordAuth;
  /** Where this account's records live: the PDS in its DID document, else the host that was asked. */
  pdsUrl: string;
  active: boolean;
  /** takendown, suspended or deactivated when the account is not active. */
  status: string | null;
}

function parseSession(json: unknown, askedPds: string): SessionResult | null {
  if (!json || typeof json !== 'object') return null;
  const j = json as Record<string, unknown>;
  if (typeof j.accessJwt !== 'string' || typeof j.refreshJwt !== 'string' || typeof j.did !== 'string' || typeof j.handle !== 'string') return null;
  return {
    auth: {
      kind: 'password',
      did: j.did,
      handle: j.handle,
      accessJwt: j.accessJwt,
      refreshJwt: j.refreshJwt,
      accessExpiresAtMs: expMs(j.accessJwt),
      refreshExpiresAtMs: expMs(j.refreshJwt),
      passwordKind: passwordKindOf(j.accessJwt),
    },
    pdsUrl: pdsFromDidDoc(j.didDoc) ?? askedPds,
    active: j.active !== false,
    status: typeof j.status === 'string' ? j.status : null,
  };
}

export interface CreateSessionInput {
  /** Handle, DID or email as the account signs in. */
  identifier: string;
  /** The app password the account's own person created for Stump. */
  password: string;
  /** The emailed code, when the account asked for one (error AuthFactorTokenRequired). */
  authFactorToken?: string;
  /** Accept a session made with the account's main password. Default false: such a session is deleted at once. */
  allowMainPassword?: boolean;
}

export async function createSession(deps: HttpDeps, pdsUrl: string, input: CreateSessionInput): Promise<Result<SessionResult>> {
  const body: Record<string, unknown> = { identifier: input.identifier, password: input.password };
  if (input.authFactorToken) body.authFactorToken = input.authFactorToken;
  const res = await send(deps, {
    method: 'POST',
    url: `${pdsUrl}/xrpc/com.atproto.server.createSession`,
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
    write: false, // a session is disposable: a lost answer costs nothing
  });
  if (!res.ok) {
    // A wrong identifier or password answers 401 AuthenticationRequired; that is not a revoked grant.
    // Specific answers (AuthFactorTokenRequired, AccountTakedown, rate limits) keep their own kinds.
    if (res.error.kind === 'auth_revoked') {
      return fail({ ...res.error, kind: 'credentials_invalid', code: res.error.code ?? 'AuthenticationRequired' });
    }
    return fail(res.error);
  }
  const session = parseSession(res.value.json, pdsUrl);
  if (!session) return invalidResponse('createSession answered without accessJwt, refreshJwt, did and handle', res.value.status);
  if (session.auth.passwordKind === 'main' && !input.allowMainPassword) {
    // Never keep a session that holds the account's full powers.
    await deleteSession(deps, session.pdsUrl, session.auth.refreshJwt);
    return fail({
      kind: 'validation',
      code: 'main_password_refused',
      message: 'That is the account password. Create an app password in Bluesky settings and enter that instead.',
      outcomeUnknown: false,
    });
  }
  if (!session.active) {
    return fail({ kind: 'forbidden', code: session.status ?? 'inactive', message: `The account is ${session.status ?? 'not active'}`, outcomeUnknown: false });
  }
  return ok(session, res.rate);
}

export async function refreshSession(deps: HttpDeps, pdsUrl: string, refreshJwt: string): Promise<Result<SessionResult>> {
  const res = await send(deps, {
    method: 'POST',
    url: `${pdsUrl}/xrpc/com.atproto.server.refreshSession`,
    headers: { authorization: `Bearer ${refreshJwt}`, accept: 'application/json' },
    write: true, // the refresh token is spent by a successful call, so a lost answer is not safe to repeat blindly
  });
  if (!res.ok) {
    // An expired or invalid refresh token ends the session; the owner connects again.
    if (res.error.code === 'ExpiredToken' || res.error.code === 'InvalidToken') return fail({ ...res.error, kind: 'auth_revoked' });
    return fail(res.error);
  }
  const session = parseSession(res.value.json, pdsUrl);
  if (!session) return invalidResponse('refreshSession answered without tokens', res.value.status);
  return ok(session, res.rate);
}

/** Ends the session at the PDS (disconnect). Idempotent in effect: an already-ended session counts as done. */
export async function deleteSession(deps: HttpDeps, pdsUrl: string, refreshJwt: string): Promise<Result<true>> {
  const res = await send(deps, {
    method: 'POST',
    url: `${pdsUrl}/xrpc/com.atproto.server.deleteSession`,
    headers: { authorization: `Bearer ${refreshJwt}` },
    write: true,
    allowEmpty: true,
  });
  if (!res.ok) {
    if (res.error.code === 'ExpiredToken' || res.error.code === 'InvalidToken') return ok(true);
    return fail(res.error);
  }
  return ok(true);
}
