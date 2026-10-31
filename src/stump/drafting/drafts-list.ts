// Compose's list of drafts waiting to be opened and reviewed, an agent's
// among them, and the venues a new post's variant can be aimed at. Read only
// through the person door's existing actions.
import { runAction } from '../ui/api.ts'
import { openingWords } from '../today/sections.ts'
import type { ItemRecord } from './records.ts'
import { networkName, type Account } from './view.ts'

/** A venue as the variant's venue picker reads it. */
export interface VenueChoice { id: string; name: string; platform: string | null; archived: boolean; excluded: unknown; routes: string[] }

/** The venues a variant for this account can be aimed at: open venues on the account's network, those it may publish to first. */
export function venuesFor(venues: VenueChoice[], account: Pick<Account, 'network'> | undefined) {
  if (!account) return []
  const network = networkName(account.network).toLowerCase()
  return venues.filter(venue => !venue.archived && !venue.excluded && (venue.platform ?? '').trim().toLowerCase() === network)
    .sort((a, b) => Number(b.routes.includes('publish')) - Number(a.routes.includes('publish')) || a.name.localeCompare(b.name))
}

export interface DraftRow { key: string; name: string; meta: string; to: { master: string } | { item: string } }

/** A draft its check stops reads "Held", the word Today uses; one marked ready reads "Ready"; a plain draft says nothing (H16). */
const held = (item: ItemRecord) => item.state === 'held' || (item.state === 'draft' && (item.flags as Array<{ blocking?: boolean }> | null ?? []).some(flag => flag.blocking))
const stateWord = (items: ItemRecord[]) => items.some(held) ? 'Held' : items.every(item => item.state === 'ready') ? 'Ready' : null
const ago = (iso: string | null, now: number) => {
  if (!iso) return ''
  const minutes = Math.round((now - Date.parse(iso)) / 60_000)
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`
  return `${Math.round(minutes / 1440)}d ago`
}

/**
 * Drafts not yet scheduled, newest first: one row per master post (its variants together), else per item, each saying who wrote
 * it ("Release agent for Dana Reyes"), where it goes and, when it is not a plain draft, its state. A hand-off's own draft lives in
 * its brief, so it is left out.
 */
export async function openDrafts(now = Date.now()): Promise<DraftRow[]> {
  const list = (state: string) => runAction<{ items: ItemRecord[] }>('stump.drafts.revise', { action: 'list', state })
  const [draft, ready, held, queue, team] = await Promise.all([list('draft'), list('ready'), list('held'),
    runAction<{ items: Array<{ item_id: string | null }> }>('stump.handoffs.manage', { action: 'queue' }),
    runAction<{ items: Array<{ id: string; display_name: string }> }>('stump.team.manage', { action: 'list' })])
  const handedOff = new Set(queue.items.flatMap(handoff => handoff.item_id ? [handoff.item_id] : []))
  const names = new Map(team.items.map(person => [person.id, person.display_name]))
  const items = [...draft.items, ...ready.items, ...held.items].filter(item => !handedOff.has(item.id))
    .sort((a, b) => Date.parse(String(b.updated_at)) - Date.parse(String(a.updated_at)))
  const rows = new Map<string, Omit<DraftRow, 'meta'> & { networks: string[]; who: string; at: string | null; items: ItemRecord[] }>()
  for (const item of items) {
    const master = typeof item.master_id === 'string' ? item.master_id : null
    const key = master ? `master:${master}` : `item:${item.id}`
    const network = item.network ? networkName(String(item.network)) : null
    const row = rows.get(key)
    if (row) { row.items.push(item); if (network && !row.networks.includes(network)) row.networks.push(network); continue }
    const person = names.get(String(item.person_id)) ?? 'Someone who left'
    const agent = (item.agent as { name?: string } | null)?.name
    const words = item.format === 'pitch' && item.subject ? String(item.subject) : openingWords(String(item.text ?? (item.parts as string[] | null)?.[0] ?? ''))
    rows.set(key, { key, name: words, networks: network ? [network] : [], who: agent ? `${agent} for ${person}` : person, at: item.updated_at as string | null, items: [item],
      to: master ? { master } : { item: item.id } })
  }
  return [...rows.values()].map(({ networks, who, at, items: group, ...row }) => ({ ...row,
    meta: [networks.join(', '), who, stateWord(group), ago(at, now)].filter(Boolean).join(' · ') }))
}
