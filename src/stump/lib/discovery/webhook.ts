/**
 * Signed webhook alerts. STUMP-WATCH-004.5.
 *
 * Each delivery carries
 *   X-Stump-Event-Id:   a stable id; a replay of the same alert carries the same id
 *   X-Stump-Signature:  t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>
 * so a receiver verifies the signature over the exact bytes it received, rejects a timestamp outside
 * its tolerance, and treats a repeated event id as already handled. Same scheme family as Stripe's
 * (https://docs.stripe.com/webhooks#verify-manually) built on Web Crypto HMAC
 * (https://developer.mozilla.org/docs/Web/API/SubtleCrypto/sign).
 */
import { SourceError } from './errors.ts'
import { failureDetail, readText, send, rateLimitRetryAt, type HttpOptions } from './http.ts'
import type { AlertMessage } from './alert-types.ts'
import { parseHttpUrl } from './url.ts'
import type { DeliveryResult } from './types.ts'

export const EVENT_ID_HEADER = 'X-Stump-Event-Id'
export const SIGNATURE_HEADER = 'X-Stump-Signature'
export const DEFAULT_TOLERANCE_SECONDS = 300

const hex = (bytes: ArrayBuffer | Uint8Array): string =>
  [...new Uint8Array(bytes instanceof ArrayBuffer ? bytes : bytes.buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)))
}

/** The `X-Stump-Signature` value for a body signed at `timestamp` (unix seconds). */
export async function signWebhook(secret: string, body: string, timestamp: number): Promise<string> {
  if (!secret) throw new SourceError('invalid_request', 'alert', 'A signed webhook needs a secret')
  const t = Math.floor(timestamp)
  return `t=${t},v1=${await hmacHex(secret, `${t}.${body}`)}`
}

function equalConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export interface VerifyResult {
  valid: boolean
  reason?: 'malformed' | 'stale' | 'mismatch'
  timestamp?: number
}

/** What a receiver does. Accepts several `v1=` values (secret rotation). */
export async function verifyWebhookSignature(args: {
  secret: string
  header: string | null | undefined
  body: string
  now_seconds?: number
  tolerance_seconds?: number
}): Promise<VerifyResult> {
  const parts = (args.header ?? '').split(',').map((p) => p.trim())
  const t = Number(parts.find((p) => p.startsWith('t='))?.slice(2))
  const sigs = parts.filter((p) => p.startsWith('v1=')).map((p) => p.slice(3))
  if (!Number.isInteger(t) || sigs.length === 0) return { valid: false, reason: 'malformed' }
  const now = args.now_seconds ?? Math.floor(Date.now() / 1000)
  if (Math.abs(now - t) > (args.tolerance_seconds ?? DEFAULT_TOLERANCE_SECONDS)) return { valid: false, reason: 'stale', timestamp: t }
  const expected = await hmacHex(args.secret, `${t}.${args.body}`)
  return sigs.some((s) => equalConstantTime(s, expected)) ? { valid: true, timestamp: t } : { valid: false, reason: 'mismatch', timestamp: t }
}

/** A fresh random event id. */
export function newEventId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return `evt_${hex(bytes)}`
}

/** The same id for the same inputs, so a retried alert for one finding and one watch is one event. */
export async function deriveEventId(parts: string[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('\u0000')))
  return `evt_${hex(digest).slice(0, 32)}`
}

export interface AlertEvent {
  id: string
  type: 'watch.alert'
  created_at: string
  kind: 'immediate' | 'digest'
  watch: { name: string; url?: string }
  findings: {
    id?: string
    title: string
    url: string
    source: string
    source_url: string
    author: string
    published_at?: string
    relevance?: number
    reasons?: string[]
  }[]
}

/** The JSON object a webhook receives. Excerpts of found text are not sent. */
export function buildAlertEvent(eventId: string, msg: AlertMessage): AlertEvent {
  return {
    id: eventId,
    type: 'watch.alert',
    created_at: msg.generated_at,
    kind: msg.kind,
    watch: { name: msg.watch_name, ...(msg.watch_url ? { url: msg.watch_url } : {}) },
    findings: msg.findings.map((f) => ({
      ...(f.id ? { id: f.id } : {}),
      title: f.title,
      url: f.url,
      source: f.source,
      source_url: f.source_url,
      author: f.author,
      ...(f.published_at ? { published_at: f.published_at } : {}),
      ...(typeof f.relevance === 'number' ? { relevance: f.relevance } : {}),
      ...(f.reasons?.length ? { reasons: f.reasons } : {}),
    })),
  }
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

export function assertWebhookUrl(url: string): URL {
  const u = parseHttpUrl(url)
  if (!u || u.username || u.password || (u.protocol === 'http:' && !LOOPBACK.has(u.hostname))) {
    throw new SourceError('invalid_request', 'alert', 'A webhook address must be an https URL (http only for localhost)')
  }
  return u
}

export interface WebhookRequest {
  url: string
  init: RequestInit & { headers: Record<string, string>; body: string }
}

/** Build the exact request. Pure apart from Web Crypto; the caller stores `body` so a replay re-sends the same bytes. */
export async function buildWebhookRequest(args: {
  url: string
  secret: string
  event_id: string
  body: string
  timestamp_seconds: number
}): Promise<WebhookRequest> {
  const u = assertWebhookUrl(args.url)
  return {
    url: u.href,
    init: {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'user-agent': 'Stump-Webhooks/1',
        [EVENT_ID_HEADER]: args.event_id,
        [SIGNATURE_HEADER]: await signWebhook(args.secret, args.body, args.timestamp_seconds),
      },
      body: args.body,
    },
  }
}

export interface WebhookDelivery extends DeliveryResult {
  event_id: string
  /** Unix seconds signed into this attempt. */
  signed_at: number
}

/**
 * Deliver (or replay) one event. A replay is a call with the same `event_id` and `body`: it gets a new
 * timestamp and signature, and a receiver that already handled the event id has no second effect.
 * `delivered` on 2xx; `retry` on 408, 425, 429, 5xx; `rejected` on other 4xx and on redirects;
 * `unknown` when the request may have arrived.
 */
export async function deliverWebhook(args: HttpOptions & { url: string; secret: string; event_id: string; body: string }): Promise<WebhookDelivery> {
  const now = args.now ?? Date.now
  const signedAt = Math.floor(now() / 1000)
  const req = await buildWebhookRequest({ url: args.url, secret: args.secret, event_id: args.event_id, body: args.body, timestamp_seconds: signedAt })
  const base = { event_id: args.event_id, signed_at: signedAt }
  let response: Response
  try {
    response = await send('alert', args, req.url, req.init)
  } catch (e) {
    // Built from the error kind only: a receiver's address may carry a token in its path.
    return { ...base, outcome: 'unknown', detail: `The receiver may or may not have received the event: ${failureDetail(e)}` }
  }
  let note = ''
  try {
    note = (await readText('alert', response, req.url, 2_000)).trim().slice(0, 120)
  } catch {
    note = ''
  }
  const s = response.status
  if (s >= 200 && s < 300) return { ...base, outcome: 'delivered', status: s, detail: `The receiver answered HTTP ${s}` }
  if (s === 429) {
    return { ...base, outcome: 'retry', status: s, retry_at: rateLimitRetryAt(response.headers, now()) ?? now() + 60_000, detail: 'The receiver rate limited the webhook' }
  }
  if (s === 408 || s === 425 || s >= 500) return { ...base, outcome: 'retry', status: s, detail: `The receiver answered HTTP ${s}${note ? `: ${note}` : ''}` }
  if (s >= 300 && s < 400) return { ...base, outcome: 'rejected', status: s, detail: `The receiver answered HTTP ${s}; redirects are not followed` }
  return { ...base, outcome: 'rejected', status: s, detail: `The receiver refused the event with HTTP ${s}${note ? `: ${note}` : ''}` }
}
