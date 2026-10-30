// UTM tagging for the company's own links (STUMP-LINK-001).
//
// UTM parameters are Google Analytics' campaign tags: utm_source, utm_medium,
// utm_campaign and utm_content (https://support.google.com/analytics/answer/10917952).
// Only links whose host is one of the company's own domains (or a subdomain of one)
// are tagged; every other link is returned untouched. A tag the author already put
// on a link is kept, never overwritten. Tagging happens before counting: Bluesky
// and LinkedIn count a tagged URL at its full length, X and Mastodon at their
// fixed URL weight.

import { extractUrls, urlHost } from './urls'

export type Route = 'published' | 'handoff'

export interface LinkRules {
  /** Domains the company owns, e.g. ["example.com"]; subdomains count. */
  own_domains: readonly string[]
  /** The utm_medium for each route: social, community, referral, email or press. */
  mediums: Readonly<Record<Route, string>>
}

export interface LinkContext {
  /** Network or venue the item goes to; becomes utm_source. */
  source: string
  route: Route
  campaign: string
  /** The item (or its id); becomes utm_content. */
  content: string
}

export interface TaggedLink {
  original: string
  tagged: string
  /** The link is on a company domain. */
  own: boolean
  /** The URL was changed. */
  changed: boolean
  /** Tags the author had already set, left as they were. */
  kept: string[]
}

export interface TagResult {
  text: string
  links: TaggedLink[]
}

export function normalizeDomain(input: string): string {
  const d = input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '')
  return d.replace(/^www\./, '')
}

export function isOwnHost(host: string, ownDomains: readonly string[]): boolean {
  const h = normalizeDomain(host)
  return ownDomains.some((d) => {
    const own = normalizeDomain(d)
    return own !== '' && (h === own || h.endsWith(`.${own}`))
  })
}

export function isOwnUrl(url: string, ownDomains: readonly string[]): boolean {
  return isOwnHost(urlHost(url), ownDomains)
}

/** Lower-case slug for tag values: letters, digits, hyphen and underscore. */
export function tagValue(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const MEDIUMS = new Set(['social', 'community', 'referral', 'email', 'press'])

export function validateLinkRules(rules: LinkRules): string[] {
  const errors: string[] = []
  if (!rules.own_domains.some((d) => normalizeDomain(d))) errors.push('own_domains needs at least one domain')
  for (const route of ['published', 'handoff'] as const) {
    const m = rules.mediums[route]
    if (!m || !MEDIUMS.has(m)) errors.push(`mediums.${route} must be one of ${[...MEDIUMS].join(', ')}`)
  }
  return errors
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

export function tagUrl(url: string, rules: LinkRules, ctx: LinkContext): TaggedLink {
  if (!isOwnUrl(url, rules.own_domains)) return { original: url, tagged: url, own: false, changed: false, kept: [] }

  const hashAt = url.indexOf('#')
  const fragment = hashAt === -1 ? '' : url.slice(hashAt)
  const noFragment = hashAt === -1 ? url : url.slice(0, hashAt)
  const queryAt = noFragment.indexOf('?')
  const base = queryAt === -1 ? noFragment : noFragment.slice(0, queryAt)
  const query = queryAt === -1 ? '' : noFragment.slice(queryAt + 1)

  const present = new Set(
    query
      .split('&')
      .filter(Boolean)
      .map((pair) => safeDecode((pair.split('=')[0] ?? '').replace(/\+/g, ' ')).toLowerCase()),
  )
  const wanted: Array<[string, string]> = [
    ['utm_source', tagValue(ctx.source)],
    ['utm_medium', tagValue(rules.mediums[ctx.route])],
    ['utm_campaign', tagValue(ctx.campaign)],
    ['utm_content', tagValue(ctx.content)],
  ]
  const kept = wanted.map(([k]) => k).filter((k) => present.has(k))
  const add = wanted.filter(([k, v]) => !present.has(k) && v !== '')
  if (add.length === 0) return { original: url, tagged: url, own: true, changed: false, kept }

  const extra = add.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
  const tagged = `${base}?${query ? `${query}&` : ''}${extra}${fragment}`
  return { original: url, tagged, own: true, changed: true, kept }
}

/** Tag every link to the company's own domains in a text; other links are left alone. */
export function tagLinks(text: string, rules: LinkRules, ctx: LinkContext): TagResult {
  const urls = extractUrls(text, { extraBareHosts: rules.own_domains.map(normalizeDomain) })
  const links: TaggedLink[] = []
  let out = ''
  let cursor = 0
  for (const u of urls) {
    const link = tagUrl(u.url, rules, ctx)
    links.push(link)
    out += text.slice(cursor, u.start) + link.tagged
    cursor = u.end
  }
  out += text.slice(cursor)
  return { text: out, links }
}
