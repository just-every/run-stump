// What Today shows, shaped from the records the person door answers: hand-offs
// due today (the person's own first), what is held and why, what goes out today,
// and threads worth answering. Times are the viewer's own day.
import type { Account, Flag } from '../drafting/view.ts'
import { flagLine, networkName, spanOf } from '../drafting/view.ts'
import type { ItemRecord } from '../drafting/records.ts'
import type { Handoff } from '../handoffs/ui/words.ts'
import { rowTitle } from '../handoffs/ui/words.ts'
import type { FindingView } from '../watches/ui-types.ts'

/** Where a row opens: the screen that owns the record. */
export type Dest =
  | { kind: 'handoff'; id: string }
  | { kind: 'compose'; master?: string; item?: string; fix?: string }
  | { kind: 'listening'; watch: string; finding: string; act?: boolean }

export interface Day { start: number; end: number; week: number }

/** The viewer's day and week (from Monday), in their own time zone. */
export function dayOf(now: number): Day {
  const start = new Date(now); start.setHours(0, 0, 0, 0)
  const end = new Date(start); end.setDate(end.getDate() + 1)
  const week = new Date(start); week.setDate(week.getDate() - ((week.getDay() + 6) % 7))
  return { start: start.getTime(), end: end.getTime(), week: week.getTime() }
}

const ACTIVE = ['open', 'join_first']
const at = (iso: string | null) => iso ? Date.parse(iso) : NaN
export const timeOf = (iso: string) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
export const dayTimeOf = (iso: string) => `${new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(iso))} ${timeOf(iso)}`
const dateOf = (iso: string) => new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(iso))
const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] ?? 'Someone who left'

export interface DueRow { id: string; title: string; due: string; who: string; mine: boolean }

/** Hand-offs still to post that fall due by the end of today, the person's own first; and the next one after today. */
export function dueToday(queue: Handoff[], personId: string, day: Day) {
  const active = queue.filter(handoff => ACTIVE.includes(handoff.state) && handoff.due_at)
  const due = active.filter(handoff => at(handoff.due_at) < day.end)
    .sort((a, b) => Number(b.person_id === personId) - Number(a.person_id === personId) || at(a.due_at) - at(b.due_at))
  const rows: DueRow[] = due.map(handoff => {
    const when = handoff.due_at!, mine = handoff.person_id === personId
    const name = mine ? 'You' : firstName(handoff.person_name)
    return {
      id: handoff.id, title: rowTitle(handoff), mine,
      due: at(when) < day.start ? `Was due ${dayTimeOf(when)}` : `Due ${timeOf(when)}`,
      who: handoff.state === 'join_first' ? `${name} ${mine ? 'join' : 'joins'} first, then ${mine ? 'post' : 'posts'} by hand` : `${name} ${mine ? 'post' : 'posts'} by hand`,
    }
  })
  const next = active.filter(handoff => at(handoff.due_at) >= day.end)
    .sort((a, b) => Number(b.person_id === personId) - Number(a.person_id === personId) || at(a.due_at) - at(b.due_at))[0]
  return { rows, next: next ? { id: next.id, title: rowTitle(next), when: dateOf(next.due_at!) } : null }
}

/** A held row: its name, then one meta line (H16). `thread` links the words in the meta that name a venue's promotion thread; the address itself is never printed. */
export interface HeldRow { key: string; name: string; meta: string; thread: { words: string; url: string } | null; action: { label: string; to: Dest }; mine: boolean; at: number }

const FORMAT: Record<string, string> = { post: 'Post', thread: 'Thread', reply: 'Reply', pitch: 'Pitch' }
const blockingOf = (item: ItemRecord) => (item.flags as Flag[]).filter(flag => flag.blocking)

/** An item aimed at a venue or a recipient, in a few words: "Reply on Indie Hackers", "Pitch to Healthcare Dive". */
function placedName(item: ItemRecord, venues: Map<string, string>): string | null {
  const format = FORMAT[String(item.format)] ?? 'Draft'
  const venue = item.venue_id ? venues.get(String(item.venue_id)) : null
  if (venue) return `${format} on ${venue}`
  if (item.format === 'pitch') { const to = (item.recipient as { name?: string } | null)?.name; return to ? `Pitch to ${to}` : 'Pitch' }
  return null
}

/** A post with no master, named by its opening words: its first sentence, or the words that fit, with "…" where more follows. */
export function openingWords(text: string, max = 48): string {
  const full = text.replace(/\s+/g, ' ').trim()
  const clean = full.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim()
  if (!clean) return 'Untitled draft'
  const sentence = /^.+?[.!?](?=\s|$)/.exec(clean)?.[0]
  let head = sentence && sentence.length <= max + 12 ? sentence : clean.slice(0, max)
  if (head !== sentence && head.length < clean.length) { const space = head.lastIndexOf(' '); if (space > max / 2) head = head.slice(0, space) }
  // Anything after the opening words, a link included, shows as "…".
  return head === full ? head : `${head.replace(/[\s.,;:!?–—-]+$/, '')}…`
}

/** "X variant", "X and Mastodon variants", "Bluesky, X and Mastodon variants", in Compose's order of networks. */
const ORDER = ['Bluesky', 'X', 'LinkedIn', 'Mastodon']
const rank = (network: string) => ORDER.includes(network) ? ORDER.indexOf(network) : ORDER.length
const variantsName = (networks: string[]) => {
  const sorted = [...networks].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
  return sorted.length === 1 ? `${sorted[0]} variant` : `${sorted.slice(0, -1).join(', ')} and ${sorted.at(-1)} variants`
}

/**
 * Everything held from going out, with its reason: items the draft check stops
 * (a blocking flag), items in the held state, and held hand-offs. A master's
 * variants that share one problem are one row; an item that belongs to a
 * hand-off is the hand-off's, so only a held hand-off shows here, with its own
 * hold. The person's own come first, then the most recently changed.
 */
export function heldRows(items: ItemRecord[], queue: Handoff[], personId: string, venues: Map<string, string>, accounts: Map<string, Account>): HeldRow[] {
  const handedOff = new Set(queue.flatMap(handoff => handoff.item_id ? [handoff.item_id] : []))
  const names = new Map(venues)
  for (const handoff of queue) names.set(handoff.venue_id, handoff.venue.name)
  const rows = new Map<string, HeldRow & { networks: string[] }>()
  for (const item of items) {
    const flags = blockingOf(item)
    if (item.state !== 'held' && !(item.state === 'draft' && flags.length)) continue
    if (handedOff.has(item.id)) continue
    const flag = flags[0]
    const over = flag?.code === 'over_limit'
    // A claim reads as the claim itself ("'50% faster' differs from proof (30%)"), as Compose quotes it.
    const reason = over ? `${String(flag!.count)} / ${String(flag!.limit)} characters`
      : flag ? flagLine(flag, spanOf(flag)) : String((item.hold as { reason?: string } | null)?.reason ?? 'Held for a person to look at')
    const network = networkName(String(item.network ?? (item.account_id ? accounts.get(String(item.account_id))?.network ?? '' : '')) || null)
    // Every held row has its one action: the draft opens in Compose (its master post, or the item alone), a claim with its span selected.
    const master = typeof item.master_id === 'string' ? item.master_id : null
    const draft = master ? { master } : { item: item.id }
    const action = flag?.code.startsWith('claim_') ? { label: 'Fix claim', to: { kind: 'compose' as const, ...draft, fix: item.id } }
      : { label: over ? 'Edit variant' : 'Open draft', to: { kind: 'compose' as const, ...draft } }
    const thread = flag && typeof flag.thread_url === 'string' && typeof flag.where === 'string' && reason.includes(flag.where) ? { words: flag.where, url: flag.thread_url } : null
    const mine = item.person_id === personId, changed = at(item.updated_at)
    const placed = placedName(item, names)
    if (master && !placed) {
      // One row per problem the master's variants share; a limit is each variant's own.
      const key = `master:${master}:${over ? `over:${item.id}` : reason}`
      const row = rows.get(key)
      if (row) { row.networks.push(network); row.name = variantsName(row.networks); row.mine ||= mine; row.at = Math.max(row.at, changed); continue }
      rows.set(key, { key, name: variantsName([network]), meta: reason, networks: [network], thread, action, mine, at: changed })
    } else {
      const name = placed ?? openingWords(String(item.text ?? (item.parts as string[] | null)?.[0] ?? ''))
      rows.set(`item:${item.id}`, { key: `item:${item.id}`, name, meta: placed || !item.network && !item.account_id ? reason : `${network} · ${reason}`, networks: [], thread, action, mine, at: changed })
    }
  }
  for (const handoff of queue) {
    if (handoff.state !== 'held') continue
    const hold = handoff.hold as { kind?: string; reason?: string; by_name?: string | null } | null
    const reason = String(hold?.reason ?? 'Held')
    rows.set(`handoff:${handoff.id}`, { key: `handoff:${handoff.id}`, name: rowTitle(handoff), meta: hold?.kind === 'person' ? `Held by ${firstName(hold.by_name ?? null)} · ${reason}` : reason,
      networks: [], thread: null, action: { label: 'Open brief', to: { kind: 'handoff', id: handoff.id } }, mine: handoff.person_id === personId, at: at(handoff.updated_at) })
  }
  return [...rows.values()].map(({ networks: _networks, ...row }) => row).sort((a, b) => Number(b.mine) - Number(a.mine) || b.at - a.at)
}

export interface OutRow { id: string; time: string; network: string; who: string; text: string; paused: boolean; to: Dest }

/** Items scheduled for the rest of today, in time order; a paused one says so. */
export function goingOut(items: ItemRecord[], accounts: Map<string, Account>, day: Day): OutRow[] {
  return items.filter(item => (item.state === 'scheduled' || item.state === 'paused') && item.scheduled_at && at(item.scheduled_at) >= day.start && at(item.scheduled_at) < day.end)
    .sort((a, b) => at(a.scheduled_at) - at(b.scheduled_at))
    .map(item => {
      const account = item.account_id ? accounts.get(String(item.account_id)) : undefined
      const network = String(item.network ?? account?.network ?? '')
      const who = account ? account.network === 'linkedin' ? account.display_name ?? account.handle : account.handle.startsWith('@') ? account.handle : `@${account.handle}` : ''
      const parts = item.parts as string[] | null
      return { id: item.id, time: timeOf(item.scheduled_at!), network: networkName(network || null), who, text: String(item.text ?? parts?.[0] ?? ''),
        paused: item.state === 'paused', to: { kind: 'compose' as const, ...(typeof item.master_id === 'string' ? { master: item.master_id } : { item: item.id }) } }
    })
}

/** The finding most worth a look across every watch, as the plate shows one. */
export function worthAnswering(lists: FindingView[][], limit = 1): FindingView[] {
  return lists.flat().sort((a, b) => b.relevance - a.relevance || at(b.published_at) - at(a.published_at)).slice(0, limit)
}

export function ago(iso: string | null, now: number): string {
  if (!iso) return ''
  const minutes = Math.round((now - Date.parse(iso)) / 60_000)
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`
  return minutes < 60 * 48 ? 'yesterday' : `${Math.round(minutes / 1440)}d ago`
}

/** Why a finding is worth a look: Listening's own chips (a question, the product it fits), then how long ago, as the plate shows them. */
export function findingChips(chips: Array<{ label: string }>, finding: FindingView, now: number): string[] {
  const when = ago(finding.published_at, now)
  return [...chips.map(chip => chip.label).filter(label => label !== 'fresh').slice(0, 2), ...(when ? [when] : [])]
}
