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

/** A read aimed at an address that is not on the public web; nothing was sent to it. */
export class NotPublicError extends Error {
  constructor(url: URL) { super(`${url.host || url.protocol} is not a public web address.`); this.name = 'NotPublicError' }
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
function capped(response: Response, max: number, origin: string): Response {
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
  // Callers read where the answer came from (a feed's base URL, where a redirect landed).
  Object.defineProperty(counted, 'url', { value: response.url })
  Object.defineProperty(counted, 'redirected', { value: response.redirected })
  return counted
}

export interface FetchOptions {
  /** The most this answer may hold, in bytes (default ANSWER_BYTES). */
  maxBytes?: number
}

/**
 * The one outbound fetch every Stump network call uses. Every answer is capped
 * at ANSWER_BYTES, or the caller's own cap. With STUMP_NETWORK_EDGE set in a
 * local runtime, a request to any non-loopback host goes to that origin with
 * its method, path, query, headers and body unchanged, and its original origin
 * in x-stump-edge-origin. Loopback hosts (a local Mastodon or PDS the person
 * connects) are fetched directly.
 */
export function stumpFetch(env: Pick<StumpEnv, 'STUMP_NETWORK_EDGE' | 'AUTH_LOCAL'>, fetcher: typeof fetch = fetch, options: FetchOptions = {}): typeof fetch {
  const max = options.maxBytes ?? ANSWER_BYTES
  return async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url), edge = edgeOrigin(env)
    if (!edge || loopback(url.hostname)) return capped(await fetcher(request), max, url.origin)
    const headers = new Headers(request.headers)
    headers.set(EDGE_ORIGIN_HEADER, url.origin)
    const body = ['GET', 'HEAD'].includes(request.method) ? null : await request.arrayBuffer()
    return capped(await fetcher(new Request(`${edge}${url.pathname}${url.search}`, { method: request.method, headers, body, redirect: request.redirect, signal: request.signal })), max, url.origin)
  }
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]), MAX_HOPS = 5

/**
 * The fetch for reads whose address a person, an agent or someone else's feed
 * chooses: a source page, the company site, a feed and its transcripts, a
 * posted link. It reads only public web addresses (address.ts), checked before
 * each request and again at every redirect, at most five; a local runtime with
 * no network edge also checks the name's public DNS answers. Loopback is not
 * exempt here, with or without the edge. Anything else throws NotPublicError
 * before a request is sent.
 */
export function publicFetch(env: Pick<StumpEnv, 'STUMP_NETWORK_EDGE' | 'AUTH_LOCAL'>, fetcher: typeof fetch = fetch, options: FetchOptions = {}): typeof fetch {
  const send = stumpFetch(env, fetcher, options)
  const checkDns = env.AUTH_LOCAL === 'true' && !edgeOrigin(env)
  const allowed = async (url: URL) => {
    if (!publicByName(url)) throw new NotPublicError(url)
    if (checkDns && !/^[\d.]+$|:/.test(hostOf(url)) && !await publicDns(fetcher, hostOf(url))) throw new NotPublicError(url)
  }
  return async (input, init) => {
    const first = new Request(input, init)
    if (!['GET', 'HEAD'].includes(first.method)) throw new TypeError('publicFetch only reads.')
    const headers = new Headers(first.headers), follow = first.redirect === 'follow'
    let url = new URL(first.url)
    for (let hop = 0; ; hop++) {
      await allowed(url)
      const response = await send(url.href, { method: first.method, headers, redirect: 'manual', signal: first.signal })
      const location = response.headers.get('location')
      if (!follow || !REDIRECTS.has(response.status) || !location) return response
      await response.body?.cancel()
      if (hop === MAX_HOPS) throw new Error(`${url.origin} redirected more than ${MAX_HOPS} times.`)
      const next = new URL(location, url)
      // Credentials never follow a redirect to another origin.
      if (next.origin !== url.origin) { headers.delete('authorization'); headers.delete('cookie') }
      url = next
    }
  }
}
