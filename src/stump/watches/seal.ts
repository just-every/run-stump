import type { StumpEnv } from '../env.ts'

// Alert addresses and webhook secrets are credentials. They are sealed at rest with AES-GCM under a
// key derived from the installation's key, and never answered back through any door.
const DOMAIN = 'stump-watch-alerts-v1'
const bytes = (text: string) => new TextEncoder().encode(text)
const b64 = (data: Uint8Array) => btoa(String.fromCharCode(...data))
const unb64 = (text: string) => Uint8Array.from(atob(text), char => char.charCodeAt(0))

async function key(env: Pick<StumpEnv, 'INSTALLATION_KEY'>): Promise<CryptoKey> {
  if (!env.INSTALLATION_KEY) throw new Error('The installation key is missing, so alert credentials cannot be sealed.')
  const root = await crypto.subtle.importKey('raw', bytes(env.INSTALLATION_KEY), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: bytes(DOMAIN), info: bytes('aes-gcm') }, root, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

/** Seals one value for one place (`context` names the watch and field, so a sealed value cannot move). */
export async function seal(env: Pick<StumpEnv, 'INSTALLATION_KEY'>, context: string, value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: bytes(context) }, await key(env), bytes(value)))
  return `v1.${b64(iv)}.${b64(sealed)}`
}

export async function open(env: Pick<StumpEnv, 'INSTALLATION_KEY'>, context: string, sealed: string): Promise<string> {
  const [version, iv, data] = sealed.split('.')
  if (version !== 'v1' || !iv || !data) throw new Error('A sealed alert credential is malformed.')
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: bytes(context) }, await key(env), unb64(data))
  return new TextDecoder().decode(plain)
}
