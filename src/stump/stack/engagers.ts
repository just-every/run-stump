import { offerEngager, type OfferRow } from './offers.ts'

// The inbox as a source of engagers for Orbit (STUMP-STACK-002). A person who
// engaged first with substance (asked a question, replied with more than a
// reaction, or mentioned the product with intent) is offered once per post. Only
// what is public goes: the handle, the network's id for them, the post link, and an
// email only when the person shows one on their own profile (never guessed or looked
// up). The post's text decides nothing but the kind of engagement; nothing in it can
// add anyone to the CRM.

export interface InboxEngager {
  id: string; network: string; url: string; author_id: string | null; author_handle: string | null; author_name: string | null; author_public_email: string | null
  engaged_first: number; engagement: string | null; occurred_at: number | null; received_at: number
}

/** Offers the author of one inbox item to Orbit, when they engaged first with substance. Answers the offer, or null. */
export async function offerInboxEngager(db: D1Database, item: InboxEngager, now: number): Promise<OfferRow | null> {
  if (item.engaged_first !== 1 || !item.engagement || !item.author_handle) return null
  const offer = await offerEngager(db, {
    network: item.network, handle: item.author_handle, display_name: item.author_name, post_url: item.url, engagement: item.engagement,
    network_user_id: item.author_id, public_email: item.author_public_email, occurred_at: item.occurred_at ?? item.received_at,
  }, null, now)
  await db.prepare('UPDATE stump_inbox_items SET offer_id=? WHERE id=?').bind(offer.id, item.id).run()
  return offer
}
