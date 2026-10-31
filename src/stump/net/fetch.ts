import type { StumpEnv } from '../env.ts'
import { hostOf, publicByName, publicDns } from './address.ts'

/** The header that carries a request's original origin to the network edge. */
export const EDGE_ORIGIN_HEADER = 'x-stump-edge-origin'

/** The most any network answer may hold unless a caller sets its own cap: the largest feed Stump reads is 5 MB. */
export const ANSWER_BYTES = 8 * 1024 * 1024

const loopback = (hostname: string) => {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host)
}

export class NetworkEdgeError extends Error {
  constructor(message: string) { super(message); this.name = 'NetworkEdgeError' }
}

/** A network answer larger than its cap; the rest of it is never read. */
export class AnswerTooLargeError extends Error {
  constructor(origin: string, max: number) { super(`The answer from ${origin} is larger than ${max} bytes.`); this.name = 'AnswerTooLargeError' }
}

/** A request aimed at an address that is not on the public web; nothing was sent to it. */
export class NotPublicError extends Error {
  readonly host: string
  constructor(url: URL) { super(`${url.host || url.protocol} is not a public web address.`); this.name = 'NotPublicError'; this.host = url.host || url.protocol }
}

function edgeOrigin(env: Pick<StumpEnv, 'STUMP_NETWORK_EDGE' | 'AUTH_LOCAL'>): string | null {
  const edge = env.STUMP_NETWORK_EDGE?.trim()
  if (!edge) return null
  // A deployed Worker never carries the edge; one that does refuses every outbound call instead of reaching real networks unnoticed.
  if (env.AUTH_LOCAL !== 'true') throw new NetworkEdgeError('STUMP_NETWORK_EDGE is set outside a local runtime. Remove it from this deployment.')
  let url: URL
  try { url = new URL(edge) } catch { throw new NetworkEdgeError('STUMP_NETWORK_EDGE must be an http or https origin.') }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin === 'null' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new NetworkEdgeError('STUMP_NETWORK_EDGE must be an http or https origin.')
  }
  return url.origin
}

/** The answer with its body counted as it is read: past `max` bytes the read fails and the rest is never taken in. */
function capped(response: Response, max: number, url: URL, redirected: boolean): Response {
  const origin = url.origin
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > max) { void response.body?.cancel().catch(() => {}); throw new AnswerTooLargeError(origin, max) }
  if (!response.body || [101, 204, 205, 304].includes(response.status)) return response
  let size = 0
  const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength
      if (size > max) controller.error(new AnswerTooLargeError(origin, max))
      else controller.enqueue(chunk)
    },
  }))
  const counted = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
  // Callers read where the answer came from (a feed's base URL, where a redirect landed): the address asked, never the edge's.
  Object.defineProperty(counted, 'url', { value: url.href })
  Object.defineProperty(counted, 'redirected', { value: redirected })
  return counted
}

export interface FetchOptions {
  /** The most this answer may hold, in bytes (default ANSWER_BYTES). */
  maxBytes?: number
  /**
   * Services the person named themselves for this call, by URL or origin: a Mastodon instance, a
   * Bluesky server, the AI provider or a sibling seed. In a local runtime one of these on loopback
   * is reached directly; nothing else is exempt from the public-address rule.
   */
  named?: Array<string | null | undefined>
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]), MAX_HOPS = 5
const DNS_MS = 60_000
const dnsAnswers = new Map<string, { public: boolean; until: number }>()

/**
 * Throws NotPublicError unless the URL is a public web address (address.ts); a local
 * runtime with no network edge also checks the name's public DNS answers, since its
 * own network can reach private addresses. Loopback is not exempt.
 */
export async function assertPublic(env: Pick<StumpEnv, 'STUMP_NETWORK_EDGE' | 'AUTH_LOCAL'>, url: URL, fetcher: typeof fetch = fetch): Promise<void> {
  if (!publicByName(url)) throw new NotPublicError(url)
  const host = hostOf(url)
  if (env.AUTH_LOCAL !== 'true' || edgeOrigin(env) || /^[\d.]+$|:/.test(host)) return
  let known = dnsAnswers.get(host)
  if (!known || known.until < Date.now()) dnsAnswers.set(host, known = { public: await publicDns(fetcher, host), until: Date.now() + DNS_MS })
  if (!known.public) throw new NotPublicError(url)
}

/**
 * A service a person names for Stump to send to (an AI provider, a sibling seed, a webhook):
 * on the public web, or in a local runtime a loopback one. Throws NotPublicError otherwise, so
 * the address is refused when it is saved, not first when it is used.
 */
export async function assertNamedService(env: Pick<StumpEnv, 'STUMP_NETWORK_EDGE' | 'AUTH_LOCAL'>, url: URL): Promise<void> {
  if (env.AUTH_LOCAL === 'true' && loopback(url.hostname)) return
  await assertPublic(env, url)
}

/** The loopback origins a person named, honoured only in a local runtime. */
function namedLocal(env: Pick<StumpEnv, 'AUTH_LOCAL'>, named: FetchOptions['named']): Set<string> {
  const origins = new Set<string>()
  if (env.AUTH_LOCAL !== 'true') return origins
  for (const value of named ?? []) {
    if (!value) continue
    try { const url = new URL(value); if (loopback(url.hostname)) origins.add(url.origin) } catch { /* not an address: names nothing */ }
  }
  return origins
}

/** One request exactly as given, through the edge when one is set, never following a redirect. */
async function sendOnce(env: Pick<StumpEnv, 'STUMP_NETWORK_EDGE' | 'AUTH_LOCAL'>, fetcher: typeof fetch, request: Request, url: URL): Promise<Response> {
  const edge = edgeOrigin(env)
  if (!edge || loopback(url.hostname)) return fetcher(new Request(request, { redirect: 'manual' }))
  const headers = new Headers(request.headers)
  headers.set(EDGE_ORIGIN_HEADER, url.origin)
  const body = ['GET', 'HEAD'].includes(request.method) ? null : await request.arrayBuffer()
  return fetcher(new Request(`${edge}${url.pathname}${url.search}`, { method: request.method, headers, body, redirect: 'manual', signal: request.signal }))
}

/**
 * The one outbound fetch every Stump network call uses. Every address, the first
 * and each one a redirect names, must be on the public web (address.ts) before
 * anything is sent to it; in a local runtime the only exception is a loopback
 * service the person named (`options.named`). Anything else throws NotPublicError
 * with nothing sent. A read follows at most five redirects, each checked, and
 * drops its credentials when one leaves the origin; a write never follows one and
 * gets the redirect itself as its answer. Every answer is capped at ANSWER_BYTES,
 * or the caller's own cap. With STUMP_NETWORK_EDGE set in a local runtime, a
 * request to any non-loopback host goes to that origin with its method, path,
 * query, headers and body unchanged, and its original origin in x-stump-edge-origin.
 */
export function stumpFetch(env: Pick<StumpEnv, 'STUMP_NETWORK_EDGE' | 'AUTH_LOCAL'>, fetcher: typeof fetch = fetch, options: FetchOptions = {}): typeof fetch {
  const max = options.maxBytes ?? ANSWER_BYTES, local = namedLocal(env, options.named)
  return async (input, init) => {
    const first = new Request(input, init), reads = ['GET', 'HEAD'].includes(first.method)
    let request = first, url = new URL(first.url)
    for (let hop = 0; ; hop++) {
      if (!local.has(url.origin)) await assertPublic(env, url, fetcher)
      const response = await sendOnce(env, fetcher, request, url)
      const location = response.headers.get('location')
      if (!REDIRECTS.has(response.status) || !location || first.redirect === 'manual' || !reads) return capped(response, max, url, hop > 0)
      await response.body?.cancel().catch(() => {})
      if (first.redirect === 'error') throw new TypeError(`${url.origin} answered with a redirect.`)
      if (hop === MAX_HOPS) throw new Error(`${url.origin} redirected more than ${MAX_HOPS} times.`)
      const next = new URL(location, url), headers = new Headers(request.headers)
      // Credentials never follow a redirect to another origin.
      if (next.origin !== url.origin) { headers.delete('authorization'); headers.delete('cookie') }
      request = new Request(next.href, { method: first.method, headers, signal: first.signal })
      url = next
    }
  }
}

/**
 * The fetch for reads whose address a person, an agent or someone else's feed
 * chooses: a source page, the company site, a feed and its transcripts, a
 * posted link. It only reads, and it exempts no address, not even a loopback
 * one in a local runtime.
 */
export function publicFetch(env: Pick<StumpEnv, 'STUMP_NETWORK_EDGE' | 'AUTH_LOCAL'>, fetcher: typeof fetch = fetch, options: Pick<FetchOptions, 'maxBytes'> = {}): typeof fetch {
  const send = stumpFetch(env, fetcher, { maxBytes: options.maxBytes })
  return async (input, init) => {
    const request = new Request(input, init)
    if (!['GET', 'HEAD'].includes(request.method)) throw new TypeError('publicFetch only reads.')
    return send(request)
  }
}
