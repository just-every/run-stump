import { KIND_FIELDS, ROUTE_LABELS, STATUS_LABELS } from '../kinds.ts'
import type { Venue } from './types.ts'

export const kindLabel = (kind: string) => (KIND_FIELDS as Record<string, { label: string }>)[kind]?.label ?? kind
export const statusLabel = (status: string) => STATUS_LABELS[status] ?? status
export const routeLabel = (route: string) => ROUTE_LABELS[route] ?? route

/** The one route a list shows: a pitch for an editorial venue, else the widest route its rules open. */
export function primaryRoute(venue: Pick<Venue, 'status' | 'routes'>): string | null {
  if (venue.status === 'editorial') return 'Pitch'
  const route = ['publish', 'handoff_draft', 'handoff_brief'].find(item => venue.routes.includes(item))
  return route ? routeLabel(route) : null
}

const short = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
export const nextOpen = (iso: string | null) => iso ? short.format(new Date(iso)).replace(',', '') : null
export const readOn = (date: string | null) => date ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`)) : null
export const limitWords = (limit: { posts: number; per: string } | null) => limit ? `${limit.posts === 1 ? 'One post' : `${limit.posts} posts`} a ${limit.per}` : null

/** The status dot: filled when the venue is ready to use, open otherwise. */
export const statusTone = (status: string) => status === 'ready' ? 'ok' : status === 'hold' || status === 'excluded' ? 'held' : ''
