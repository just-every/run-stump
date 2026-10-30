import { canonicalUrl, parseHttpUrl, type Finding } from '../lib/discovery/index.ts'

export type Route = 'publish' | 'handoff_draft' | 'handoff_brief'
export interface FindingRoutes { routes: Route[]; venue: { id: string; name: string } | null }

export interface VenueRow { id: string; name: string; url: string | null; url_key: string | null; status: string; rules: string }
interface Rule { value?: unknown }

const hostOf = (url: string | null | undefined) => (url ? parseHttpUrl(url)?.hostname.replace(/^www\./, '').toLowerCase() ?? null : null)
const word = (rule: unknown) => String((rule as Rule | undefined)?.value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')

/** Where a finding lives, as venue addresses name it. */
function homes(finding: Pick<Finding, 'source' | 'source_ref' | 'url'>): { exact: string[]; hosts: string[] } {
  if (finding.source === 'hn') return { exact: [], hosts: ['news.ycombinator.com'] }
  if (finding.source === 'bluesky') return { exact: [], hosts: ['bsky.app'] }
  if (finding.source === 'mastodon') return { exact: [], hosts: [finding.source_ref.toLowerCase()] }
  return { exact: [canonicalUrl(finding.source_ref)], hosts: [hostOf(finding.source_ref), hostOf(finding.url)].filter((host): host is string => host !== null) }
}

/**
 * The routes a finding may take, computed from the rules of the venue it lives in (D-3, STUMP-VENUE-002.6)
 * and from nothing the finding says (D-7): a venue that bans AI-written text, keeps posting for its members,
 * or has no sourced rule gets a hand-off with a brief and no generated text; only a venue that records
 * posting from the company's account as allowed also offers publish. Hacker News has no write door at all.
 */
export function routesFor(venues: readonly VenueRow[], finding: Pick<Finding, 'source' | 'source_ref' | 'url'>): FindingRoutes {
  const place = homes(finding)
  const venue = venues.find(row => place.exact.includes(canonicalUrl(row.url ?? '')) || (row.url_key !== null && place.exact.includes(row.url_key)))
    ?? venues.find(row => { const host = hostOf(row.url); return host !== null && place.hosts.includes(host) })
  if (finding.source === 'hn') return { routes: ['handoff_brief'], venue: venue ? { id: venue.id, name: venue.name } : null }
  if (!venue) return { routes: ['handoff_brief'], venue: null }
  const rules = JSON.parse(venue.rules) as Record<string, unknown>
  const ai = word(rules.ai_text), posting = word(rules.posting)
  const aiAllowed = ai !== '' && !/^(banned|ban|no|none|forbidden|human|human_only|not_allowed)/.test(ai)
  const apiPosting = /^(api|account|company|company_account|software|bot|open|allowed|anyone)$/.test(posting)
  const routes: Route[] = []
  if (apiPosting && aiAllowed) routes.push('publish')
  routes.push(aiAllowed ? 'handoff_draft' : 'handoff_brief')
  return { routes, venue: { id: venue.id, name: venue.name } }
}

/** The venues a finding can live in: every one not archived or excluded, in priority order. */
export async function loadVenues(db: D1Database): Promise<VenueRow[]> {
  return (await db.prepare("SELECT id,name,url,url_key,status,rules FROM stump_venues WHERE archived=0 AND status<>'excluded' ORDER BY priority IS NULL,priority DESC,name,id").all<VenueRow>()).results
}
