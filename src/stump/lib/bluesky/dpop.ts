// DPoP proofs and client assertions with Web Crypto (ES256, P-256).
//
// Sources:
//   atproto OAuth profile: DPoP is required for PAR, token and resource requests; ES256; nonces from
//     the DPoP-Nonce header, kept per server: https://atproto.com/specs/oauth
//   DPoP proof JWT (typ dpop+jwt; jwk header; claims jti, htm, htu, iat, nonce, ath): RFC 9449,
//     https://www.rfc-editor.org/rfc/rfc9449
//   private_key_jwt client assertion (RFC 7523; iss and sub = client_id, aud = issuer, jti, iat, exp):
//     https://atproto.com/specs/oauth and https://www.rfc-editor.org/rfc/rfc7523

import type { DpopKeyPair } from './types.ts';

const encoder = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlJson(v: unknown): string {
  return b64url(encoder.encode(JSON.stringify(v)));
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256b64url(input: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(input))));
}

export async function generateKeyPair(): Promise<DpopKeyPair> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { privateJwk, publicJwk: publicOnly(publicJwk) };
}

/** Only the members a verifier needs; never the private scalar. */
export function publicOnly(jwk: JsonWebKey): JsonWebKey {
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
}

async function signJwt(privateJwk: JsonWebKey, header: Record<string, unknown>, payload: Record<string, unknown>): Promise<string> {
  const key = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  // Web Crypto returns r||s, which is the JWS form of ES256.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(signingInput)));
  return `${signingInput}.${b64url(sig)}`;
}

/** The URL a proof names: no query and no fragment. */
export function htuOf(url: string): string {
  const u = new URL(url);
  return `${u.origin}${u.pathname}`;
}

export interface DpopProofInput {
  method: string;
  url: string;
  nonce?: string | null;
  /** The access token, when the proof accompanies a resource request. */
  accessToken?: string;
  nowMs?: number;
}

export async function createDpopProof(key: DpopKeyPair, input: DpopProofInput): Promise<string> {
  const payload: Record<string, unknown> = {
    jti: randomToken(16),
    htm: input.method.toUpperCase(),
    htu: htuOf(input.url),
    iat: Math.floor((input.nowMs ?? Date.now()) / 1000),
  };
  if (input.nonce) payload.nonce = input.nonce;
  if (input.accessToken) payload.ath = await sha256b64url(input.accessToken);
  return signJwt(key.privateJwk, { typ: 'dpop+jwt', alg: 'ES256', jwk: publicOnly(key.publicJwk) }, payload);
}

export interface ClientKey {
  /** Key id published in the client's jwks. */
  kid: string;
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey & { kid: string };
}

export async function generateClientKey(kid: string): Promise<ClientKey> {
  const pair = await generateKeyPair();
  return { kid, privateJwk: pair.privateJwk, publicJwk: { ...pair.publicJwk, kid, alg: 'ES256', use: 'sig' } as JsonWebKey & { kid: string } };
}

export async function createClientAssertion(key: ClientKey, input: { clientId: string; issuer: string; nowMs?: number }): Promise<string> {
  const iat = Math.floor((input.nowMs ?? Date.now()) / 1000);
  return signJwt(key.privateJwk, { alg: 'ES256', kid: key.kid, typ: 'JWT' }, { iss: input.clientId, sub: input.clientId, aud: input.issuer, jti: randomToken(16), iat, exp: iat + 60 });
}
