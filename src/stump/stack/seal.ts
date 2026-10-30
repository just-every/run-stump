import type { StumpEnv } from '../env.ts'

// Secrets entered for a sibling seed are sealed under the installation key
// (AES-GCM, key derived with HKDF) and bound to their connection, so a sealed
// value cannot be moved to another one. Nothing answers a secret back.
const DOMAIN = 'stump-stack-secret-v1'
const encoder = new TextEncoder()
const b64 = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
const unb64 = (value: string) => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0))
const valid = (secret: unknown): secret is string => typeof secret === 'string' && /^[a-f0-9]{64}$/.test(secret)

async function material(secret: string) {
  const root = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(DOMAIN), info: encoder.encode('seal') }, root, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  return { key, kid: b64(await crypto.subtle.digest('SHA-256', encoder.encode(`${DOMAIN}:kid\0${secret}`))).slice(0, 16) }
}

export class SealError extends Error {
  constructor(message: string) { super(message); this.name = 'SealError' }
}

export async function seal(env: Pick<StumpEnv, 'INSTALLATION_KEY'>, binding: string, plain: string): Promise<string> {
  if (!valid(env.INSTALLATION_KEY)) throw new SealError('The installation key is missing, so secrets cannot be kept.')
  const { key, kid } = await material(env.INSTALLATION_KEY), iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(binding), tagLength: 128 }, key, encoder.encode(plain))
  return JSON.stringify({ v: 1, kid, iv: b64(iv), ct: b64(sealed) })
}

export async function open(env: Pick<StumpEnv, 'INSTALLATION_KEY' | 'INSTALLATION_KEY_PREVIOUS'>, binding: string, sealed: string): Promise<string> {
  let envelope: { v?: number; kid?: string; iv?: string; ct?: string }
  try { envelope = JSON.parse(sealed) as typeof envelope } catch { throw new SealError('The stored secret is unreadable.') }
  for (const secret of [env.INSTALLATION_KEY, env.INSTALLATION_KEY_PREVIOUS]) {
    if (!valid(secret)) continue
    const { key, kid } = await material(secret)
    if (kid !== envelope.kid || envelope.v !== 1 || typeof envelope.iv !== 'string' || typeof envelope.ct !== 'string') continue
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(envelope.iv), additionalData: encoder.encode(binding), tagLength: 128 }, key, unb64(envelope.ct)))
    } catch { throw new SealError('The stored secret does not open. Connect again.') }
  }
  throw new SealError('The installation key that sealed this secret is not available. Connect again.')
}
