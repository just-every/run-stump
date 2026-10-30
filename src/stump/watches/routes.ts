import { canonicalUrl, parseHttpUrl, type Finding } from '../lib/discovery/index.ts'

export type Route = 'publish' | 'handoff_draft' | 'handoff_brief' | 'dismiss'
export interface FindingRoutes { routes: Route[]; venue: { id: string; name: string } | null }

export interface VenueRow { id: string; name: string; url: string | null; url_key: string | null; status: string; rules: string }
/** A venue rule as the venues area stores it (STUMP-VENUE-002): its value and the page and date it was read from. */
interface Rule { value?: unknown; source_url?: string | null; read_at?: string | null }

const hostOf = (url: string | null | undefined) => (url ? parseHttpUrl(url)?.hostname.replace(/^www\./, '').toLowerCase() ?? null : null)
const ruleOf = (rules: Record<string, unknown>, key: string): Rule | null => { const rule = rules[key]; return rule && typeof rule === 'object' ? rule as Rule : null }
/** A rule opens a route only with its source: the page it was read from and the date it was read. */
const sourced = (rule: Rule | null) => rule !== null && typeof rule.source_url === 'string' && rule.source_url !== '' && typeof rule.read_at === 'string' && rule.read_at !== ''
const says = (rule: Rule | null, ...values: string[]) => rule !== null && values.includes(String(rule.value))

/** Where a finding lives, as venue addresses name it. */
function homes(finding: Pick<Finding, 'source' | 'source_ref' | 'url'>): { exact: string[]; hosts: string[] } {
  if (finding.source === 'hn') return { exact: [], hosts: ['news.ycombinator.com'] }
  if (finding.source === 'bluesky') return { exact: [], hosts: ['bsky.app'] }
  if (finding.source === 'mastodon') return { exact: [], hosts: [finding.source_ref.toLowerCase()] }
  return { exact: [canonicalUrl(finding.source_ref)], hosts: [hostOf(finding.source_ref), hostOf(finding.url)].filter((host): host is string => host !== null) }
}

/**
 * The routes a venue's rules open, read as the venues area reads them (D-3, STUMP-VENUE-002.1, .2):
 * publish needs a sourced rule that lets software post from the company's account; a hand-off with a
 * draft needs a sourced rule that allows AI-written text, with or without disclosure; a banned
 * self-promotion rule closes both, sourced or not. A hand-off with a brief and facts is always open.
 */
export function venueRoutes(rulesJson: string): Route[] {
  const rules = JSON.parse(rulesJson) as Record<string, unknown>
  const posting = ruleOf(rules, 'posting'), ai = ruleOf(rules, 'ai_text')
  if (says(ruleOf(rules, 'self_promotion'), 'banned')) return ['handoff_brief']
  return [
    ...(says(posting, 'company_account') && sourced(posting) ? ['publish' as const] : []),
    ...(says(ai, 'allowed', 'allowed_with_disclosure') && sourced(ai) ? ['handoff_draft' as const] : []),
    'handoff_brief',
  ]
}

/**
 * The routes a finding may take, computed from the rules of the venue it lives in (D-3, STUMP-VENUE-002.6)
 * and from nothing the finding says (D-7). A finding in no recorded venue gets a hand-off with a brief.
 * Stump has no write door to Hacker News and never generates HN comment text, so an HN finding offers
 * only the hand-off with a brief, whatever its venue records (STUMP-WATCH-001.3).
 * Every finding can also be dismissed.
 */
export function routesFor(venues: readonly VenueRow[], finding: Pick<Finding, 'source' | 'source_ref' | 'url'>): FindingRoutes {
  const place = homes(finding)
  const venue = venues.find(row => place.exact.includes(canonicalUrl(row.url ?? '')) || (row.url_key !== null && place.exact.includes(row.url_key)))
    ?? venues.find(row => { const host = hostOf(row.url); return host !== null && place.hosts.includes(host) })
  const open: Route[] = venue && finding.source !== 'hn' ? venueRoutes(venue.rules) : ['handoff_brief']
  const routes: Route[] = [...open, 'dismiss']
  return { routes, venue: venue ? { id: venue.id, name: venue.name } : null }
}

/** The venues a finding can live in: every one not archived or excluded, in priority order. */
export async function loadVenues(db: D1Database): Promise<VenueRow[]> {
  return (await db.prepare("SELECT id,name,url,url_key,status,rules FROM stump_venues WHERE archived=0 AND status<>'excluded' ORDER BY priority IS NULL,priority DESC,name,id").all<VenueRow>()).results
}
