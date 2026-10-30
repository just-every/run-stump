import type { StumpEnv } from '../env.ts'

// Network credentials at rest: AES-GCM under a key derived (HKDF) from the
// installation key, bound to what they belong to by the additional data. The
// envelope names the key it was sealed with, so a rotated installation key
// (INSTALLATION_KEY_PREVIOUS) still opens what it sealed. Nothing sealed here
// ever leaves the installation or appears in a response.

const DOMAIN = 'stump-at-rest-v1'
const enc = new TextEncoder()
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
const unb64 = (text: string) => Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0))

export class SealError extends Error {
  constructor(readonly code: 'installation_key_missing' | 'sealed_unreadable') { super(code); this.name = 'SealError' }
}

const valid = (secret: unknown): secret is string => typeof secret === 'string' && /^[a-f0-9]{64}$/.test(secret)

async function material(secret: string) {
  const root = await crypto.subtle.importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode(DOMAIN), info: enc.encode(`${DOMAIN}:credentials`) }, root, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  const kid = b64(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`${DOMAIN}:key-id\0${secret}`)))).slice(0, 22)
  return { key, kid }
}

/** Seals a JSON value for one purpose (for example "account:<id>"). */
export async function seal(env: Pick<StumpEnv, 'INSTALLATION_KEY'>, purpose: string, value: unknown): Promise<string> {
  if (!valid(env.INSTALLATION_KEY)) throw new SealError('installation_key_missing')
  const { key, kid } = await material(env.INSTALLATION_KEY)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(`${DOMAIN}|${purpose}|${kid}`) }, key, enc.encode(JSON.stringify(value))))
  return JSON.stringify({ v: 1, kid, iv: b64(iv), ct: b64(ciphertext) })
}

/** Opens what seal() made for the same purpose, with the current or previous installation key. */
export async function unseal<T>(env: Pick<StumpEnv, 'INSTALLATION_KEY' | 'INSTALLATION_KEY_PREVIOUS'>, purpose: string, sealed: string): Promise<T> {
  let envelope: { v?: unknown; kid?: unknown; iv?: unknown; ct?: unknown }
  try { envelope = JSON.parse(sealed) } catch { throw new SealError('sealed_unreadable') }
  if (envelope.v !== 1 || typeof envelope.kid !== 'string' || typeof envelope.iv !== 'string' || typeof envelope.ct !== 'string') throw new SealError('sealed_unreadable')
  for (const secret of [env.INSTALLATION_KEY, env.INSTALLATION_KEY_PREVIOUS].filter(valid)) {
    const { key, kid } = await material(secret)
    if (kid !== envelope.kid) continue
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(envelope.iv), additionalData: enc.encode(`${DOMAIN}|${purpose}|${kid}`) }, key, unb64(envelope.ct))
      return JSON.parse(new TextDecoder().decode(plain)) as T
    } catch { throw new SealError('sealed_unreadable') }
  }
  throw new SealError('sealed_unreadable')
}

/** A digest for looking a secret value up without storing it (consent `state`). */
export async function digest(value: string): Promise<string> {
  return b64(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`${DOMAIN}:state\0${value}`))))
}
