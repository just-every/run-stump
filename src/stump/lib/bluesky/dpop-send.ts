// A request that carries a DPoP proof and follows the server's nonce.
//
// Sources: https://atproto.com/specs/oauth (nonces are mandatory, taken from the DPoP-Nonce header,
// tracked per server; a stale nonce is answered with an error and a fresh DPoP-Nonce and the request
// is retried) and RFC 9449 section 8 (error use_dpop_nonce) and section 9 (resource requests use the
// DPoP authorization scheme and an ath claim): https://www.rfc-editor.org/rfc/rfc9449

import { createDpopProof } from './dpop.ts';
import type { Result } from './errors.ts';
import { judge, sendRaw, type HttpDeps, type RawRequest, type RawResponse } from './http.ts';
import type { DpopKeyPair } from './types.ts';

export interface NonceBox {
  value: string | null;
}

export interface DpopRequest extends Omit<RawRequest, 'body'> {
  /** Built again for each attempt, so one-time values (a client assertion) are never replayed. */
  body?: () => Promise<string | Uint8Array | URLSearchParams>;
  /** Set on resource requests: sent as "Authorization: DPoP <token>" and bound by ath. */
  accessToken?: string;
}

function asksForNonce(status: number, headers: Headers, json: unknown): boolean {
  if (status !== 400 && status !== 401) return false;
  const www = headers.get('www-authenticate') ?? '';
  if (/use_dpop_nonce/.test(www)) return true;
  const err = json && typeof json === 'object' ? (json as Record<string, unknown>).error : undefined;
  return err === 'use_dpop_nonce';
}

export async function dpopSend(deps: HttpDeps, key: DpopKeyPair, nonce: NonceBox, req: DpopRequest): Promise<Result<RawResponse>> {
  let result: Result<RawResponse> | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const proofInput: Parameters<typeof createDpopProof>[1] = { method: req.method, url: req.url, nonce: nonce.value };
    if (req.accessToken) proofInput.accessToken = req.accessToken;
    if (deps.now) proofInput.nowMs = deps.now();
    const headers: Record<string, string> = { ...(req.headers ?? {}), dpop: await createDpopProof(key, proofInput) };
    if (req.accessToken) headers.authorization = `DPoP ${req.accessToken}`;
    const raw: RawRequest = { method: req.method, url: req.url, headers, write: req.write };
    if (req.allowEmpty !== undefined) raw.allowEmpty = req.allowEmpty;
    if (req.body) raw.body = await req.body();
    const outcome = await sendRaw(deps, raw);
    if (!outcome.thrown) {
      const fresh = outcome.headers.get('dpop-nonce');
      if (fresh) nonce.value = fresh;
      if (attempt === 0 && fresh && asksForNonce(outcome.status, outcome.headers, outcome.json)) continue;
    }
    result = judge(deps, raw, outcome);
    break;
  }
  return result!;
}
