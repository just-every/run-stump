// What Today shows, shaped from the records the person door answers: hand-offs
// due today (the person's own first), what is held and why, what goes out today,
// threads worth answering and recent results. Times are the viewer's own day.
import type { Account, Flag } from '../drafting/view.ts'
import { flagLine, networkName } from '../drafting/view.ts'
import type { ItemRecord } from '../drafting/records.ts'
import type { Handoff } from '../handoffs/ui/words.ts'
import { rowTitle } from '../handoffs/ui/words.ts'
import type { LedgerEntry } from '../ledger/entry.ts'
import type { FindingView } from '../watches/ui-types.ts'

/** Where a row opens: the screen that owns the record. */
export type Dest =
  | { kind: 'handoff'; id: string }
  | { kind: 'compose'; master: string }
  | { kind: 'brand' }
  | { kind: 'listening'; watch: string; finding: string }

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

export interface HeldRow { key: string; name: string; reason: string; action: { label: string; to: Dest } | null; mine: boolean; at: number }

const FORMAT: Record<string, string> = { post: 'Post', thread: 'Thread', reply: 'Reply', pitch: 'Pitch' }
const blockingOf = (item: ItemRecord) => (item.flags as Flag[]).filter(flag => flag.blocking)

/** What an item is, in a few words: "Reply on Indie Hackers", "Post on Bluesky". */
function itemName(item: ItemRecord, venues: Map<string, string>, accounts: Map<string, Account>): string {
  const format = FORMAT[String(item.format)] ?? 'Draft'
  const venue = item.venue_id ? venues.get(String(item.venue_id)) : null
  if (venue) return `${format} on ${venue}`
  if (item.format === 'pitch') { const to = (item.recipient as { name?: string } | null)?.name; return to ? `Pitch to ${to}` : 'Pitch' }
  const network = item.network ?? (item.account_id ? accounts.get(String(item.account_id))?.network : null)
  return network ? `${format} on ${networkName(String(network))}` : format
}

/**
 * Everything held from going out, with its reason: items the draft check stops
 * (a blocking flag), items in the held state, and held hand-offs. The person's
 * own come first, then the most recently changed.
 */
export function heldRows(items: ItemRecord[], queue: Handoff[], personId: string, venues: Map<string, string>, accounts: Map<string, Account>): HeldRow[] {
  const handoffOfItem = new Map(queue.filter(handoff => handoff.item_id).map(handoff => [handoff.item_id!, handoff]))
  const names = new Map(venues)
  for (const handoff of queue) names.set(handoff.venue_id, handoff.venue.name)
  const rows: HeldRow[] = []
  for (const item of items) {
    const flags = blockingOf(item)
    if (item.state !== 'held' && !(item.state === 'draft' && flags.length)) continue
    const handoff = handoffOfItem.get(item.id)
    if (handoff && !ACTIVE.includes(handoff.state) && handoff.state !== 'held') continue
    const flag = flags[0]
    const name = itemName(item, names, accounts)
    const reason = flag ? flagLine(flag) : String((item.hold as { reason?: string } | null)?.reason ?? 'Held for a person to look at')
    const master = typeof item.master_id === 'string' ? item.master_id : null
    const action = handoff ? { label: 'Open hand-off', to: { kind: 'handoff' as const, id: handoff.id } }
      : flag?.code.startsWith('claim_') ? { label: 'Fix claim', to: { kind: 'brand' as const } }
      : master ? { label: flag?.code === 'over_limit' ? 'Edit variant' : 'Open draft', to: { kind: 'compose' as const, master } }
      : null
    rows.push({ key: `item:${item.id}`, name: flag?.code === 'over_limit' ? `${reason} characters` : name, reason: flag?.code === 'over_limit' ? '' : reason,
      action, mine: item.person_id === personId, at: at(item.updated_at) })
  }
  for (const handoff of queue) {
    if (handoff.state !== 'held' || (handoff.item_id && rows.some(row => row.key === `item:${handoff.item_id}`))) continue
    rows.push({ key: `handoff:${handoff.id}`, name: rowTitle(handoff), reason: String((handoff.hold as { reason?: string } | null)?.reason ?? 'Held'),
      action: { label: 'Open hand-off', to: { kind: 'handoff', id: handoff.id } }, mine: handoff.person_id === personId, at: at(handoff.updated_at) })
  }
  return rows.sort((a, b) => Number(b.mine) - Number(a.mine) || b.at - a.at)
}

export interface OutRow { id: string; time: string; network: string; who: string; text: string; paused: boolean; to: Dest | null }

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
        paused: item.state === 'paused', to: typeof item.master_id === 'string' ? { kind: 'compose' as const, master: item.master_id } : null }
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

/** Why a finding is worth a look, as the short chips Listening uses. */
export function findingChips(finding: FindingView, now: number): string[] {
  const chips: string[] = []
  if (finding.answerable || finding.reason_details.some(reason => reason.factor === 'question' && reason.points > 0)) chips.push('asks a question')
  if (finding.venue) chips.push(`fits ${finding.venue.name}`)
  const product = finding.mentions.find(mention => mention.kind === 'product')
  if (product) chips.push(`names ${product.product}`)
  const when = ago(finding.published_at, now)
  if (when) chips.push(when)
  return chips
}

export interface ResultRow { id: string; title: string; meta: string; url: string | null }

/** Recent posts on the ledger, each with the results it carries. */
export function resultRows(entries: LedgerEntry[], accounts: Map<string, Account>): ResultRow[] {
  return entries.map(entry => {
    const account = entry.account_id ? accounts.get(entry.account_id) : undefined
    const handle = account ? account.network === 'linkedin' ? account.display_name ?? account.handle : account.handle.startsWith('@') ? account.handle : `@${account.handle}` : null
    const where = entry.route === 'handed_off' ? `${entry.venue_name ?? 'A venue'} · ${entry.by}` : `${networkName(entry.network)} · ${handle ?? entry.by}`
    const results = entry.results ? Object.entries(entry.results.values).slice(0, 3).map(([name, value]) => `${value.toLocaleString()} ${name.replace(/_/g, ' ')}`) : []
    const posted = entry.posted_at ? `${entry.route === 'handed_off' ? 'Posted by hand' : 'Posted'} ${dateOf(entry.posted_at)}` : 'Posted'
    return { id: entry.id, title: `${where}${entry.text ? ` · ${entry.text}` : ''}`, meta: [posted, ...results].join(' · '), url: entry.url }
  })
}
