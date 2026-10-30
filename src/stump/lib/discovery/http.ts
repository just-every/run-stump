/**
 * HTTP helpers shared by the sources: a request with a hard timeout, a size-capped body read with
 * charset handling, status mapping, and rate-limit header parsing.
 *
 * Rate-limit headers read:
 *  - Retry-After: RFC 9110 section 10.2.3 (https://www.rfc-editor.org/rfc/rfc9110#field.retry-after)
 *  - Bluesky RateLimit-Reset (epoch seconds) and Mastodon X-RateLimit-Reset (ISO 8601):
 *    https://bsky.network/docs/advanced-guides/rate-limits and https://docs.joinmastodon.org/api/rate-limits/
 */
import { SourceError } from './errors.ts'
import type { FetchFn, SourceKind } from './types.ts'

export interface HttpOptions {
  fetch: FetchFn
  timeout_ms?: number
  now?: () => number
}

export const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_RATE_LIMIT_WAIT_MS = 60_000

/** Origin and path only, so stored errors never carry query strings or credentials. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname.length > 60 ? `${u.pathname.slice(0, 57)}...` : u.pathname
    return `${u.protocol}//${u.host}${path}`
  } catch {
    return '(invalid url)'
  }
}

/** Issue one request. Network failures and timeouts become SourceErrors; HTTP statuses do not. */
export async function send(
  source: SourceKind | 'alert',
  opts: HttpOptions,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const timeout = opts.timeout_ms ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new SourceError('timeout', source, `Request to ${redactUrl(url)} timed out after ${timeout} ms`))
    }, timeout)
  })
  try {
    const pending = Promise.resolve().then(() => opts.fetch(url, { ...init, signal: controller.signal }))
    pending.catch(() => {}) // a fetch that fails after the timeout already won must not surface as an unhandled rejection
    return await Promise.race([pending, timedOut])
  } catch (e) {
    if (e instanceof SourceError) throw e
    const reason = e instanceof Error ? e.message : String(e)
    throw new SourceError('network', source, `Request to ${redactUrl(url)} failed: ${reason}`)
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Milliseconds since epoch when the response says to wait until, or null when it says nothing. */
export function rateLimitRetryAt(headers: Headers, nowMs: number): number | null {
  const retryAfter = headers.get('retry-after')
  if (retryAfter) {
    const secs = Number(retryAfter)
    if (Number.isFinite(secs) && secs >= 0) return nowMs + Math.ceil(secs) * 1000
    const date = Date.parse(retryAfter)
    if (Number.isFinite(date)) return Math.max(date, nowMs)
  }
  const reset = headers.get('ratelimit-reset') ?? headers.get('x-ratelimit-reset')
  if (reset) {
    const n = Number(reset)
    if (Number.isFinite(n)) {
      if (n > 1e12) return Math.max(n, nowMs) // epoch milliseconds
      if (n > 1e9) return Math.max(n * 1000, nowMs) // epoch seconds (Bluesky)
      return nowMs + Math.ceil(n) * 1000 // delta seconds (IETF draft)
    }
    const date = Date.parse(reset) // ISO 8601 (Mastodon)
    if (Number.isFinite(date)) return Math.max(date, nowMs)
  }
  return null
}

/** Throws for any non-2xx response, with rate limits and sign-in requirements told apart. */
export function assertOk(source: SourceKind | 'alert', response: Response, url: string, nowMs: number): void {
  if (response.ok) return
  const where = redactUrl(url)
  if (response.status === 429) {
    const retryAt = rateLimitRetryAt(response.headers, nowMs) ?? nowMs + DEFAULT_RATE_LIMIT_WAIT_MS
    throw new SourceError('rate_limited', source, `Rate limited by ${where}`, { status: 429, retry_at: retryAt })
  }
  if (response.status === 401 || response.status === 403) {
    throw new SourceError('auth_required', source, `${where} answered ${response.status}: it needs a signed-in request`, {
      status: response.status,
    })
  }
  const retryAt = response.status === 503 ? rateLimitRetryAt(response.headers, nowMs) ?? undefined : undefined
  throw new SourceError('http', source, `${where} answered HTTP ${response.status}`, { status: response.status, retry_at: retryAt })
}

function charsetOf(contentType: string | null): string | null {
  const m = /charset\s*=\s*"?([A-Za-z0-9_.:-]+)"?/i.exec(contentType ?? '')
  return m ? m[1].toLowerCase() : null
}

function decode(bytes: Uint8Array, label: string | null): string {
  try {
    return new TextDecoder(label ?? 'utf-8').decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

/**
 * Read a body up to `maxBytes`. Charset: the Content-Type header, else (for XML) the declaration in
 * the first bytes, else UTF-8. A body over the cap is a bad response, not a silent truncation.
 */
export async function readText(
  source: SourceKind | 'alert',
  response: Response,
  url: string,
  maxBytes: number,
  opts: { xml?: boolean } = {},
): Promise<string> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new SourceError('bad_response', source, `${redactUrl(url)} is larger than ${maxBytes} bytes`)
  }
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = response.body?.getReader()
  if (!reader) return ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new SourceError('bad_response', source, `${redactUrl(url)} is larger than ${maxBytes} bytes`)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    bytes.set(c, at)
    at += c.byteLength
  }
  let label = charsetOf(response.headers.get('content-type'))
  if (!label && opts.xml) {
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200))
    const m = /^\s*<\?xml[^>]*encoding\s*=\s*["']([A-Za-z0-9_.:-]+)["']/i.exec(head)
    if (m) label = m[1].toLowerCase()
  }
  return decode(bytes, label)
}

export async function readJson(
  source: SourceKind | 'alert',
  response: Response,
  url: string,
  maxBytes = 8_000_000,
): Promise<unknown> {
  const text = await readText(source, response, url, maxBytes)
  try {
    return JSON.parse(text)
  } catch {
    throw new SourceError('bad_response', source, `${redactUrl(url)} did not return JSON`)
  }
}

export async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
