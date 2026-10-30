import { KIND_FIELDS, ROUTE_LABELS, STATUS_LABELS } from '../kinds.ts'
import type { Venue } from './types.ts'

/** The platforms a venue runs on, by the id the venue records, in each one's own name (never a title-cased id). */
const PLATFORMS: Record<string, string> = {
  hn: 'Hacker News', hackernews: 'Hacker News', reddit: 'Reddit', x: 'X', twitter: 'X', bluesky: 'Bluesky', mastodon: 'Mastodon', discord: 'Discord', slack: 'Slack',
  producthunt: 'Product Hunt', linkedin: 'LinkedIn', indiehackers: 'Indie Hackers', lobsters: 'Lobsters', github: 'GitHub', discourse: 'Discourse', youtube: 'YouTube',
}
/**
 * A venue's kind in words, with the platform it runs on where neither the kind nor the venue's own name already says it: a
 * Mastodon instance is a forum by kind, and reads "Forum on Mastodon"; "Hacker News" on hn reads "Forum". A platform the map
 * does not know adds nothing.
 */
export const kindLabel = (kind: string, platform?: string | null, name?: string | null) => {
  const label = (KIND_FIELDS as Record<string, { label: string }>)[kind]?.label ?? kind
  const on = platform ? PLATFORMS[platform.toLowerCase().replace(/[^a-z0-9]/g, '')] : undefined
  if (!on) return label
  const says = (text: string | null | undefined) => !!text && text.toLowerCase().includes(on.toLowerCase())
  return says(label) || says(name) ? label : `${label} on ${on}`
}
export const statusLabel = (status: string) => STATUS_LABELS[status] ?? status
export const routeLabel = (route: string) => ROUTE_LABELS[route] ?? route

/** Venues a company pitches, never posts in: a person there decides what runs. */
const PITCHED = ['podcast', 'newsletter', 'journalist', 'publication']

/**
 * The one route a list shows (display only; the routes field keeps the interface's words): none yet for a candidate, a pitch
 * for a venue you pitch, else the widest route open there, the same routes the venue's own page lists.
 */
export function primaryRoute(venue: Pick<Venue, 'kind' | 'status' | 'routes'>): string | null {
  if (venue.status === 'candidate') return null
  if (PITCHED.includes(venue.kind) || venue.status === 'editorial') return 'Pitch'
  const route = ['publish', 'handoff_draft', 'handoff_brief'].find(item => venue.routes.includes(item))
  return route ? routeLabel(route) : null
}

const short = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' })
const DAY = 86_400_000
/**
 * When a venue's shared limit next lets the company post, in the limit's own UTC days, worded as Hand-offs words its dates:
 * "Today" (open now), "Tomorrow", a weekday up to six days out ("Thu"), else "Mon Nov 2".
 */
export function nextOpen(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null
  const at = new Date(iso).getTime(), days = Math.floor(at / DAY) - Math.floor(now / DAY)
  if (at <= now || days <= 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days <= 6) return weekday.format(new Date(at))
  return short.format(new Date(at)).replace(',', '')
}
/** When a venue next has room, as both the list and the venue page say it: "Any time" with no shared limit. */
export const nextOpenWords = (venue: Pick<Venue, 'shared_limit' | 'next_open_at'>, now = Date.now()) =>
  venue.shared_limit ? nextOpen(venue.next_open_at, now) ?? 'Not within a year' : 'Any time'
export const readOn = (date: string | null) => date ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`)) : null
export const limitWords = (limit: { posts: number; per: string } | null) => limit ? `${limit.posts === 1 ? 'One post' : `${limit.posts}\u00a0posts`} a ${limit.per}` : null

/** The status dot: filled when the venue is ready to use, open otherwise. */
export const statusTone = (status: string) => status === 'ready' ? 'ok' : status === 'hold' || status === 'excluded' ? 'held' : ''
