import { tagOwnLinks } from '../links/index.ts'
import type { DueItem } from './types.ts'

/**
 * An item as it leaves for its network: every part of its text, and its link
 * card, passed through the company's link tagging with route published and the
 * network as source, so only links to the company's own domains carry UTM tags
 * (STUMP-LINK-001). Checks and the send both use this text, so a limit is
 * measured on what actually goes out.
 */
export async function outgoing(db: D1Database, item: DueItem, campaign: string | null): Promise<DueItem> {
  const tag = (text: string) => tagOwnLinks(db, { text, route: 'published', source: item.network, campaign, content: item.id })
  const link = item.options.link
  return {
    ...item,
    text: item.text === null ? null : await tag(item.text),
    parts: item.parts ? await Promise.all(item.parts.map(tag)) : null,
    options: link ? { ...item.options, link: { ...link, url: await tag(link.url) } } : item.options,
  }
}

/** States in which an item has left Compose for its network. */
const SENDING = new Set(['scheduled', 'posting', 'posted', 'partly_posted', 'uncertain'])

/**
 * The text an item goes out with, as Compose shows it once scheduled: the text its network
 * read back once posted (on the ledger), else its text with the company's links tagged as
 * they will leave. `null` while it is still a draft, or once cancelled.
 */
export async function sentText(db: D1Database, item: { id: string; state: string; network: string | null; campaign: string | null; text: string }): Promise<string | null> {
  if (!SENDING.has(item.state)) return null
  const posted = await db.prepare("SELECT text FROM stump_ledger WHERE item_id=? AND route='published' AND text IS NOT NULL ORDER BY posted_at DESC LIMIT 1").bind(item.id).first<{ text: string }>()
  if (posted) return posted.text
  return tagOwnLinks(db, { text: item.text, route: 'published', source: item.network ?? '', campaign: item.campaign, content: item.id })
}
