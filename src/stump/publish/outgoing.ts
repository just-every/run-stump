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
