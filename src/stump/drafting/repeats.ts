// The earlier posts a near-duplicate hold names (STUMP-TRUTH-004), as Compose links them under the hold: each one's network,
// when it went out or is due, and its opening words, opening on the network (a posted one) or in Compose (one still queued).
// Read through the person door's existing reads.
import { runAction } from '../ui/api.ts'
import type { LedgerEntry } from '../ledger/entry.ts'
import type { ItemRecord } from './records.ts'
import { networkName, type Flag } from './view.ts'

type Match = { id: string; kind: string; url?: string | null }
export interface EarlierPost { key: string; network: string; at: string | null; words: string; to: { href: string } | { compose: { master: string } | { item: string } } | null }

const cut = (text: string) => { const clean = text.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim(); return clean.length > 60 ? `${clean.slice(0, 57).replace(/\s+\S*$/, '')}…` : clean }

/** The matches of every near-duplicate flag on these variants, each read once. */
export async function earlierPosts(flags: Flag[]): Promise<Map<string, EarlierPost>> {
  const matches = new Map<string, Match>()
  for (const flag of flags) if (flag.code === 'near_duplicate') for (const match of (flag.matches ?? []) as Match[]) matches.set(`${match.kind}:${match.id}`, match)
  const read = await Promise.all([...matches.values()].map(async match => match.kind === 'ledger'
    ? { match, entry: await runAction<LedgerEntry>('stump.ledger.search', { action: 'get', entry_id: match.id }) }
    : { match, item: await runAction<ItemRecord>('stump.drafts.revise', { action: 'get', item_id: match.id }) }))
  const out = new Map<string, EarlierPost>()
  for (const found of read) {
    const key = `${found.match.kind}:${found.match.id}`
    if (found.entry) {
      const entry = found.entry
      out.set(key, { key, network: networkName(entry.network), at: entry.posted_at, words: cut(entry.text ?? ''), to: entry.url ? { href: entry.url } : null })
    } else if (found.item) {
      const item = found.item, master = typeof item.master_id === 'string' ? item.master_id : null
      out.set(key, { key, network: networkName(String(item.network ?? '') || null), at: item.scheduled_at ?? item.updated_at,
        words: cut(String(item.text ?? (item.parts as string[] | null)?.[0] ?? '')), to: { compose: master ? { master } : { item: item.id } } })
    }
  }
  return out
}

/** The posts one near-duplicate flag names, in the order the check found them. */
export const postsOf = (flag: Flag, posts: Map<string, EarlierPost>) => ((flag.matches ?? []) as Match[]).flatMap(match => posts.get(`${match.kind}:${match.id}`) ?? [])
