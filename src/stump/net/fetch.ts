import type { StumpEnv } from '../env.ts'

/** The header that carries a request's original origin to the network edge. */
export const EDGE_ORIGIN_HEADER = 'x-stump-edge-origin'

const loopback = (hostname: string) => {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host)
}

export class NetworkEdgeError extends Error {
  constructor(message: string) { super(message); this.name = 'NetworkEdgeError' }
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

/**
 * The one outbound fetch every Stump network call uses. With STUMP_NETWORK_EDGE
 * set in a local runtime, a request to any non-loopback host goes to that
 * origin with its method, path, query, headers and body unchanged, and its
 * original origin in x-stump-edge-origin. Loopback hosts (a local Mastodon or
 * PDS) are fetched directly.
 */
export function stumpFetch(env: Pick<StumpEnv, 'STUMP_NETWORK_EDGE' | 'AUTH_LOCAL'>, fetcher: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url), edge = edgeOrigin(env)
    if (!edge || loopback(url.hostname)) return fetcher(request)
    const headers = new Headers(request.headers)
    headers.set(EDGE_ORIGIN_HEADER, url.origin)
    const body = ['GET', 'HEAD'].includes(request.method) ? null : await request.arrayBuffer()
    return fetcher(new Request(`${edge}${url.pathname}${url.search}`, { method: request.method, headers, body, redirect: request.redirect, signal: request.signal }))
  }
}
