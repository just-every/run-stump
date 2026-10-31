// Reading the company's X account (STUMP-INBOX-001 on X): the posts that mention
// it or reply to its posts, read through its X app at the company's read price,
// and the post each one answers or quotes (the account's own, or someone else's
// thread post), read once, so the person sees what was answered. Each post arrives once however often the inbox is read;
// a cursor carries each read on from the last, and a backlog bigger than one read
// drains over the next ones without reading (or paying for) a post twice.
import { refuse } from '../actions/refusals.ts'
import type { ActionContext } from '../actions/types.ts'
import { xPrices } from '../accounts/apps.ts'
import { xFor } from '../accounts/clients.ts'
import { needsReconnect, type AccountRow } from '../accounts/store.ts'
import { fetchXMentions, getXPost, quoteXRead, type XError, type XMention, type XPostReadback, type XPriceTable } from '../lib/x/index.ts'
import { recordCall } from '../publish/parts.ts'
import { erasedAuthors } from '../data/tombstones.ts'
import { offerInboxEngager } from '../stack/index.ts'
import { engagedFirst, engagementOf, kindOf, publicEmailOf } from './engagement.ts'
import { ownPostIds, type InboxRow } from './store.ts'

/** One page of up to 100 mentions per read, and at most one thread post for each. */
export const PAGE_SIZE = 100
const PAGES = 1

/** The most one read can cost from the company's price table: what policy weighs before it runs. */
export const pollCeiling = (prices: XPriceTable) => quoteXRead(PAGE_SIZE * PAGES * 2, prices).usd_micro

function stopped(error: XError) {
  return { kind: error.kind, status: error.status, message: error.message, reset_at: error.resetAt }
}

/** Reads the account's new mentions and replies, stores each once, and offers engagers to Orbit. */
export async function pollInbox(ctx: ActionContext, account: AccountRow) {
  if (account.network !== 'x') refuse('network_unsupported', { network: account.network, reason: 'The inbox reads X accounts in this release.' })
  if (account.state !== 'connected') refuse('account_not_connected', { account_id: account.id, state: account.state, reconnect_url: account.reconnect_url })
  const db = ctx.db, now = ctx.now()
  const opened = await xFor(ctx.env, db, account, ctx.now)
  if (!opened.ok) refuse(opened.code === 'app_not_set' ? 'app_not_set' : 'account_not_connected', { account_id: account.id, reason: opened.message })
  if (opened.credentials.network !== 'x') refuse('network_unsupported', { network: account.network })
  const x = opened.client, userId = opened.credentials.user_id, handle = opened.credentials.username || account.handle
  const prices = await xPrices(db)
  const cursor = await db.prepare('SELECT cursor FROM stump_inbox_cursors WHERE account_id=?').bind(account.id).first<{ cursor: string | null }>()

  const read = await fetchXMentions(x, { userId, sinceId: cursor?.cursor ?? null, maxPages: PAGES, pageSize: PAGE_SIZE }, prices)
  if (!read.ok) {
    await db.prepare(`INSERT INTO stump_inbox_cursors(account_id,cursor,polled_at,polled_by,reads,charge_micro,last_error) VALUES(?,?,?,?,0,0,?)
      ON CONFLICT(account_id) DO UPDATE SET polled_at=excluded.polled_at,polled_by=excluded.polled_by,reads=0,charge_micro=0,last_error=excluded.last_error`)
      .bind(account.id, cursor?.cursor ?? null, now, ctx.person.id, JSON.stringify(stopped(read.error))).run()
    if (read.error.kind === 'auth_revoked') { await needsReconnect(db, ctx.env, account, 'revoked', now); refuse('account_not_connected', { account_id: account.id, reason: read.error.message }) }
    refuse(read.error.kind === 'rate_limited' || read.error.kind === 'credits_exhausted' ? read.error.kind : 'network_error', { network: 'x', ...stopped(read.error) })
  }
  const mentions = read.value.items
  let reads = read.value.reads, micro = read.value.charge.usd_micro, stoppedBy: XError | null = read.value.stoppedBy

  // The post each one answers or quotes: the company's own (from what Stump posted, or read back from X once) or
  // someone else's thread post, read once and kept beside it as context.
  const parentOf = (post: XPostReadback) => post.inReplyToPostId ?? post.referenced.find(ref => ref.type === 'quoted')?.id ?? null
  const parents = [...new Set(mentions.map(parentOf).filter((id): id is string => !!id))]
  const own = await ownPostIds(db, account.id, parents)
  const stored = parents.length ? new Map((await db.prepare(`SELECT network_id,author_id FROM stump_inbox_items WHERE account_id=? AND network_id IN (${parents.map(() => '?').join(',')})`)
    .bind(account.id, ...parents).all<{ network_id: string; author_id: string | null }>()).results.map(row => [row.network_id, row.author_id])) : new Map<string, string | null>()
  for (const [id, author] of stored) if (author === userId) own.add(id)
  const mentionIds = new Set(mentions.map(post => post.id))
  // A person erased from Stump stays erased: a post of theirs that someone else answers is never read or stored as
  // the thread's context; the mention that answers it is kept, without that context (STUMP-DATA-002).
  const erased = await erasedAuthors(db, 'x', mentions.map(post => post.inReplyToUserId))
  const threads: XPostReadback[] = []
  for (const id of parents) {
    if (own.has(id) || stored.has(id) || mentionIds.has(id) || stoppedBy) continue
    // A reply to the account's own post reads that post at the owned-read price; anything else at the post-read price.
    const answered = mentions.find(post => post.inReplyToPostId === id)
    if (answered?.inReplyToUserId && erased.has(answered.inReplyToUserId)) continue
    const parent = await getXPost(x, id, prices, { owned: !!answered && answered.inReplyToUserId === userId })
    if (!parent.ok) {
      // A post that is gone or private is left out; a limit or exhausted credits stops further reads.
      if (['rate_limited', 'credits_exhausted', 'auth_revoked'].includes(parent.error.kind)) stoppedBy = parent.error
      continue
    }
    reads += parent.value.charge.units; micro += parent.value.charge.usd_micro
    if (parent.value.authorId === userId) own.add(parent.value.id)
    threads.push(parent.value)
  }
  // A quoted post names its author only once read: one by an erased author is paid for and dropped, never stored.
  const erasedParents = await erasedAuthors(db, 'x', threads.flatMap(post => [post.authorId, post.authorUsername]))
  const kept = threads.filter(post => !erasedParents.has(post.authorId ?? '') && !erasedParents.has(post.authorUsername ?? ''))
  const isOwnParent = (post: XPostReadback) => {
    const parent = parentOf(post)
    return !!parent && (own.has(parent) || (post.inReplyToPostId === parent && post.inReplyToUserId === userId))
  }

  const rowOf = (post: XPostReadback | XMention, kind: InboxRow['kind']): InboxRow => {
    // What the author shows on their own profile, read with the mention: their name, bio and any email written there.
    const profile = 'author' in post ? post.author : null
    const engaged = engagedFirst(post, { userId, handle }, own), parent = kind === 'thread' ? post.inReplyToPostId : parentOf(post)
    const parentOwn = kind !== 'thread' && isOwnParent(post)
    return {
      id: crypto.randomUUID(), account_id: account.id, network: 'x', network_id: post.id, kind: kind === 'thread' ? 'thread' : kindOf(post, parentOwn), url: post.url, text: post.text,
      author_id: post.authorId, author_handle: post.authorUsername, author_name: profile?.name ?? null, author_bio: profile?.description ?? null, author_public_email: publicEmailOf(profile), conversation_id: post.conversationId,
      parent_network_id: parent, parent_url: parent ? `https://x.com/${parentOwn ? handle : 'i'}/status/${parent}` : null, parent_own: parentOwn ? 1 : 0,
      engaged_first: engaged ? 1 : 0, engagement: engaged ? engagementOf(post.text) : null,
      occurred_at: post.createdAt ? Date.parse(post.createdAt) || now : now, received_at: now, reply_item_id: null, offer_id: null,
    }
  }
  const rows = [...kept.map(post => rowOf(post, 'thread')), ...mentions.map(post => rowOf(post, 'mention'))]
  const inserts = rows.map(row => db.prepare(`INSERT INTO stump_inbox_items(id,account_id,network,network_id,kind,url,text,author_id,author_handle,author_name,author_bio,author_public_email,conversation_id,
      parent_network_id,parent_url,parent_own,engaged_first,engagement,occurred_at,received_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,network_id) DO NOTHING`)
    .bind(row.id, row.account_id, row.network, row.network_id, row.kind, row.url, row.text, row.author_id, row.author_handle, row.author_name, row.author_bio, row.author_public_email, row.conversation_id,
      row.parent_network_id, row.parent_url, row.parent_own, row.engaged_first, row.engagement, row.occurred_at, row.received_at))
  const results = inserts.length ? await db.batch(inserts) : []
  const added = rows.filter((_row, index) => results[index]!.meta.changes > 0)

  // What X billed for this read goes on record with the account, and the cursor moves on.
  if (reads > 0) await recordCall({ db, account, now: ctx.now }, { network: 'x', item_id: null, act: 'read', units: reads, usd_micro: micro })
  await db.prepare(`INSERT INTO stump_inbox_cursors(account_id,cursor,polled_at,polled_by,reads,charge_micro,last_error) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(account_id) DO UPDATE SET cursor=excluded.cursor,polled_at=excluded.polled_at,polled_by=excluded.polled_by,reads=excluded.reads,charge_micro=excluded.charge_micro,last_error=excluded.last_error`)
    .bind(account.id, read.value.nextSinceId, now, ctx.person.id, reads, micro, stoppedBy ? JSON.stringify(stopped(stoppedBy)) : null).run()

  const offered: string[] = []
  for (const row of added) { const offer = await offerInboxEngager(db, row, now); if (offer) offered.push(offer.id) }
  if (added.length) ctx.emit('inbox.received', `stump://inbox/${account.id}`, { added: added.length })
  return {
    account_id: account.id, reads, charge_usd: micro / 1e6, added: added.length, offered: offered.length,
    truncated: read.value.truncated || !!stoppedBy, stopped_by: stoppedBy ? stopped(stoppedBy) : null,
  }
}
