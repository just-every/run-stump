// Handles and DIDs: resolving a handle, reading a DID document, finding an account's PDS.
//
// Sources:
//   com.atproto.identity.resolveHandle (does not require auth; HandleNotFound):
//     https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/identity/resolveHandle.json
//   Handle resolution by HTTPS well-known (/.well-known/atproto-did) and DID documents (did:plc via
//     the PLC directory, did:web via /.well-known/did.json); handle and DID must name each other:
//     https://atproto.com/specs/handle , https://atproto.com/specs/did , https://atproto.com/specs/oauth
//   Mentions resolve handles to DIDs: https://docs.bsky.app/docs/advanced-guides/posts

import { fail, invalidResponse, ok, type Result } from './errors.ts';
import { send, type HttpDeps } from './http.ts';
import { pdsFromDidDoc } from './session.ts';

export const PLC_DIRECTORY = 'https://plc.directory';

/** Resolves a handle to a DID through a server that offers resolveHandle (the account's PDS or an AppView). */
export async function resolveHandle(deps: HttpDeps, serverUrl: string, handle: string): Promise<Result<string | null>> {
  const res = await send(deps, {
    method: 'GET',
    url: `${serverUrl}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`,
    headers: { accept: 'application/json' },
    write: false,
  });
  if (!res.ok) {
    // HandleNotFound (400) means no such account. Anything else is a real failure and is passed up.
    if (res.error.code === 'HandleNotFound' || (res.error.status === 400 && /unable to resolve handle/i.test(res.error.message))) return ok(null);
    return fail(res.error);
  }
  const did = (res.value.json as Record<string, unknown>).did;
  if (typeof did !== 'string' || !did.startsWith('did:')) return invalidResponse('resolveHandle answered without a did', res.value.status);
  return ok(did, res.rate);
}

export interface DidDocument {
  id: string;
  alsoKnownAs: string[];
  pdsUrl: string | null;
}

export async function fetchDidDocument(deps: HttpDeps, did: string, plcDirectory: string = PLC_DIRECTORY): Promise<Result<DidDocument>> {
  let url: string;
  if (did.startsWith('did:plc:')) url = `${plcDirectory}/${did}`;
  else if (did.startsWith('did:web:')) {
    const host = decodeURIComponent(did.slice('did:web:'.length));
    if (host.includes(':') || host.includes('/')) return invalidResponse(`${did} names a path; only host-level did:web is supported for atproto`);
    url = `https://${host}/.well-known/did.json`;
  } else return invalidResponse(`${did} is not a did:plc or did:web identifier`);
  const res = await send(deps, { method: 'GET', url, headers: { accept: 'application/did+ld+json, application/json' }, write: false });
  if (!res.ok) return fail(res.error);
  const doc = res.value.json as Record<string, unknown>;
  if (doc.id !== did) return invalidResponse(`The DID document is for ${String(doc.id)}, not ${did}`, res.value.status);
  const aka = Array.isArray(doc.alsoKnownAs) ? (doc.alsoKnownAs as unknown[]).filter((a): a is string => typeof a === 'string') : [];
  return ok({ id: did, alsoKnownAs: aka, pdsUrl: pdsFromDidDoc(doc) }, res.rate);
}

export interface ResolvedIdentity {
  did: string;
  handle: string | null;
  pdsUrl: string;
}

/**
 * Resolves what a person typed (a handle or a DID) to a verified DID and PDS. A handle is only
 * accepted when the DID document names it back (bidirectional check).
 */
export async function resolveIdentity(
  deps: HttpDeps,
  input: string,
  options: { handleResolverUrl: string; plcDirectory?: string },
): Promise<Result<ResolvedIdentity>> {
  const typed = input.trim().replace(/^@/, '');
  let did: string;
  let handle: string | null = null;
  if (typed.startsWith('did:')) {
    did = typed;
  } else {
    handle = typed.toLowerCase();
    const r = await resolveHandle(deps, options.handleResolverUrl, handle);
    if (!r.ok) return fail(r.error);
    if (r.value === null) return fail({ kind: 'not_found', code: 'HandleNotFound', message: `No account has the handle ${handle}`, outcomeUnknown: false });
    did = r.value;
  }
  const doc = await fetchDidDocument(deps, did, options.plcDirectory);
  if (!doc.ok) return fail(doc.error);
  if (handle !== null && !doc.value.alsoKnownAs.some((a) => a.toLowerCase() === `at://${handle}`)) {
    return fail({ kind: 'validation', code: 'handle_not_verified', message: `${did} does not claim the handle ${handle}`, outcomeUnknown: false });
  }
  if (!doc.value.pdsUrl) return invalidResponse(`${did} names no PDS in its DID document`);
  if (handle === null) {
    const aka = doc.value.alsoKnownAs.find((a) => a.startsWith('at://'));
    handle = aka ? aka.slice('at://'.length) : null;
  }
  return ok({ did, handle, pdsUrl: doc.value.pdsUrl });
}
