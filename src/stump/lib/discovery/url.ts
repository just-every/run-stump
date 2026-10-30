/**
 * URL handling: safe http(s) parsing, redirect unwrapping (Google Alerts), canonical form for
 * de-duplication (STUMP-WATCH-002.5, .6), and the Reddit host test (STUMP-WATCH-002.8).
 *
 * Google Alerts feed links are redirects of the form
 *   https://www.google.com/url?rct=j&sa=t&url=<alerted page>&ct=ga&cd=...&usg=...
 * Google documents Alerts feeds at https://support.google.com/websearch/answer/4815696 but not the
 * redirect shape; the `url` (and, on older feeds, `q`) parameter is the stable part.
 */

/** Parse an absolute or base-relative http(s) URL; null for anything else (javascript:, data:, mailto:). */
export function parseHttpUrl(value: string, base?: string): URL | null {
  const v = value.trim()
  if (!v) return null
  try {
    const u = new URL(v, base)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!u.hostname) return null
    return u
  } catch {
    return null
  }
}

function isGoogleRedirect(u: URL): boolean {
  return /^(www\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/i.test(u.hostname) && u.pathname === '/url'
}

/** The page a Google redirect points at, or the input unchanged. Unwraps nested wrappers (at most three). */
export function unwrapRedirect(url: string): string {
  let current = url
  for (let depth = 0; depth < 3; depth++) {
    const u = parseHttpUrl(current)
    if (!u || !isGoogleRedirect(u)) return current
    const target = u.searchParams.get('url') ?? u.searchParams.get('q')
    const parsed = target ? parseHttpUrl(target) : null
    if (!parsed) return current
    current = parsed.href
  }
  return current
}

const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'igshid', 'mc_cid', 'mc_eid',
  '_hsenc', '_hsmi', 'mkt_tok', 'vero_id', 'oly_enc_id', 'oly_anon_id', 'ref_src', 'ref_url', 's_cid', 'cmpid',
])

/**
 * A form of the URL two copies of one page share: scheme upgraded to https, lower-case host without
 * `www.`, no default port, no fragment, tracking parameters removed, remaining parameters sorted,
 * no trailing slash. Google redirects are unwrapped first. Returns the input trimmed when it is not an
 * http(s) URL, so callers can still compare it.
 */
export function canonicalUrl(url: string): string {
  const unwrapped = unwrapRedirect(url)
  const u = parseHttpUrl(unwrapped)
  if (!u) return unwrapped.trim()
  u.protocol = 'https:'
  u.hash = ''
  u.username = ''
  u.password = ''
  if (u.port === '443' || u.port === '80') u.port = ''
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  const params: [string, string][] = []
  for (const [k, v] of u.searchParams) {
    const key = k.toLowerCase()
    if (key.startsWith('utm_') || TRACKING_PARAMS.has(key)) continue
    params.push([k, v])
  }
  params.sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1))
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : ''
  const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') || '/' : u.pathname
  const port = u.port ? `:${u.port}` : ''
  return `https://${host}${port}${path}${query}`
}

/** True for reddit.com, its subdomains, redd.it and its subdomains. */
export function isRedditHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '')
  return h === 'reddit.com' || h.endsWith('.reddit.com') || h === 'redd.it' || h.endsWith('.redd.it')
}

export function isRedditUrl(url: string): boolean {
  const u = parseHttpUrl(url)
  return u ? isRedditHost(u.hostname) : false
}

export function hostOf(url: string): string {
  return parseHttpUrl(url)?.hostname.toLowerCase().replace(/^www\./, '') ?? ''
}
