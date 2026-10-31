// Inbox records (STUMP-INBOX-001) as both doors answer them: each post with its
// author, link and text, whether its author engaged first, the company post it
// answered, the thread post it answered (the company's own or someone else's), the
// reply that answers it with its ledger entry, and its author's offer to Orbit.

export interface InboxRow {
  id: string; account_id: string; network: string; network_id: string; kind: 'mention' | 'reply' | 'quote' | 'thread'; url: string; text: string
  author_id: string | null; author_handle: string | null; author_name: string | null; author_bio: string | null; author_public_email: string | null; conversation_id: string | null
  parent_network_id: string | null; parent_url: string | null; parent_own: number; engaged_first: number; engagement: string | null
  occurred_at: number | null; received_at: number; reply_item_id: string | null; offer_id: string | null
}

/** Reply states that mean the interaction has its answer: out, on its way, waiting out a Pause, or maybe out (an unconfirmed post is never sent twice, D-5). */
export const ANSWERED = ['scheduled', 'paused', 'posting', 'posted', 'partly_posted', 'uncertain'] as const

const iso = (at: number | null) => at === null ? null : new Date(at).toISOString()
const json = <T>(value: string | null): T | null => value ? JSON.parse(value) as T : null

export const readInboxItem = (db: D1Database, id: string) => db.prepare('SELECT * FROM stump_inbox_items WHERE id=?').bind(id).first<InboxRow>()

interface ReplyRow { id: string; state: string; text: string | null; url: string | null; network_id: string | null; flags: string; hold: string | null; error: string | null; ai: string | null; revision: number; ledger_id: string | null; charge_usd: number | null }
interface OfferRow { id: string; state: string; outcome: string | null; sent_at: number | null; attempts: number }
interface OwnPost { network_id: string; url: string | null; text: string | null; ledger_id: string | null }

/**
 * The company's own posts among these ids, from what Stump posted (its parts and its ledger). A ledger entry
 * counts by the network id it was recorded with: a correction that changed that id says what the entry
 * refers to, not which post the account wrote.
 */
async function ownPosts(db: D1Database, accountId: string, ids: string[]): Promise<Map<string, OwnPost>> {
  const found = new Map<string, OwnPost>()
  if (!ids.length) return found
  const marks = ids.map(() => '?').join(',')
  const [parts, ledger] = await db.batch([
    db.prepare(`SELECT p.network_id,p.url,COALESCE(p.text,i.text) AS text,(SELECT l.id FROM stump_ledger l WHERE l.item_id=p.item_id AND l.account_id=p.account_id AND l.route='published') AS ledger_id
      FROM stump_item_parts p JOIN stump_items i ON i.id=p.item_id WHERE p.account_id=? AND p.network_id IN (${marks})`).bind(accountId, ...ids),
    db.prepare(`SELECT l.network_id,l.url,l.text,l.id AS ledger_id FROM stump_ledger l WHERE l.account_id=? AND l.network_id IN (${marks})
      AND NOT EXISTS(SELECT 1 FROM stump_ledger_versions v WHERE v.entry_id=l.id AND v.kind='correction' AND json_extract(v.fields,'$.network_id') IS NOT NULL)`).bind(accountId, ...ids),
  ])
  for (const row of [...(ledger!.results as unknown as OwnPost[]), ...(parts!.results as unknown as OwnPost[])]) found.set(row.network_id, { ...found.get(row.network_id), ...row, ledger_id: row.ledger_id ?? found.get(row.network_id)?.ledger_id ?? null })
  return found
}

/** The ids among these that are the company's own posts. */
export async function ownPostIds(db: D1Database, accountId: string, ids: string[]): Promise<Set<string>> {
  return new Set((await ownPosts(db, accountId, [...new Set(ids)])).keys())
}

export type InboxView = Awaited<ReturnType<typeof inboxViews>>[number]

/** Each row as the doors answer it. */
export async function inboxViews(db: D1Database, rows: InboxRow[]) {
  if (!rows.length) return []
  const accountId = rows[0]!.account_id
  const own = await ownPosts(db, accountId, [...new Set(rows.filter(row => row.parent_own === 1 && row.parent_network_id).map(row => row.parent_network_id!))])
  const parentIds = [...new Set(rows.filter(row => row.parent_network_id).map(row => row.parent_network_id!))]
  const replyIds = rows.map(row => row.reply_item_id).filter((id): id is string => !!id), offerIds = rows.map(row => row.offer_id).filter((id): id is string => !!id)
  const marks = (list: unknown[]) => list.length ? list.map(() => '?').join(',') : "''"
  const [account, parents, replies, offers] = await db.batch([
    db.prepare('SELECT handle,display_name FROM stump_accounts WHERE id=?').bind(accountId),
    db.prepare(`SELECT * FROM stump_inbox_items WHERE account_id=? AND network_id IN (${marks(parentIds)})`).bind(accountId, ...parentIds),
    db.prepare(`SELECT i.id,i.state,i.text,i.url,i.network_id,i.flags,i.hold,i.error,i.ai,i.revision,l.id AS ledger_id,l.charge_usd
      FROM stump_items i LEFT JOIN stump_ledger l ON l.item_id=i.id AND l.account_id=i.account_id AND l.route='published' WHERE i.id IN (${marks(replyIds)})`).bind(...replyIds),
    db.prepare(`SELECT id,state,outcome,sent_at,attempts FROM stump_stack_offers WHERE id IN (${marks(offerIds)})`).bind(...offerIds),
  ])
  const company = (account!.results as unknown as Array<{ handle: string; display_name: string | null }>)[0] ?? null
  const parentBy = new Map((parents!.results as unknown as InboxRow[]).map(row => [row.network_id, row]))
  const replyBy = new Map((replies!.results as unknown as ReplyRow[]).map(row => [row.id, row]))
  const offerBy = new Map((offers!.results as unknown as OfferRow[]).map(row => [row.id, row]))
  return rows.map(row => {
    const reply = row.reply_item_id ? replyBy.get(row.reply_item_id) ?? null : null
    const offer = row.offer_id ? offerBy.get(row.offer_id) ?? null : null
    const parent = row.parent_own === 0 && row.parent_network_id ? parentBy.get(row.parent_network_id) ?? null : null
    const read = row.parent_own === 1 && row.parent_network_id ? parentBy.get(row.parent_network_id) : undefined
    const ownPost = row.parent_own === 1 && row.parent_network_id
      ? own.get(row.parent_network_id) ?? { network_id: row.parent_network_id, url: read?.url ?? row.parent_url, text: read?.text ?? null, ledger_id: null } : null
    const answered = !!reply && (ANSWERED as readonly string[]).includes(reply.state)
    return {
      id: row.id, account_id: row.account_id, network: row.network, kind: row.kind, network_id: row.network_id, url: row.url, text: row.text,
      author: row.author_handle, author_name: row.author_name, author_id: row.author_id, author_bio: row.author_bio, author_email: row.author_public_email, engaged_first: row.engaged_first === 1, engagement: row.engagement,
      occurred_at: iso(row.occurred_at), received_at: iso(row.received_at), conversation_id: row.conversation_id,
      company_post: ownPost ? { network_id: ownPost.network_id, url: ownPost.url ?? row.parent_url, text: ownPost.text, ledger_id: ownPost.ledger_id } : null,
      // The post this one answers, for every item that answers one: the company's own post (with its ledger entry) or someone else's thread post.
      thread: ownPost ? { inbox_item_id: read?.id ?? null, network_id: ownPost.network_id, url: ownPost.url ?? row.parent_url, author: company?.handle ?? null, author_name: company?.display_name ?? null,
          text: ownPost.text, engaged_first: false, own: true, ledger_id: ownPost.ledger_id }
        : parent ? { inbox_item_id: parent.id, network_id: parent.network_id, url: parent.url, author: parent.author_handle, author_name: parent.author_name, text: parent.text, engaged_first: parent.engaged_first === 1, own: false, ledger_id: null }
        : row.parent_network_id ? { inbox_item_id: null, network_id: row.parent_network_id, url: row.parent_url, author: null, author_name: null, text: null, engaged_first: false, own: false, ledger_id: null } : null,
      reply: reply ? {
        item_id: reply.id, state: reply.state, text: reply.text, url: reply.url, network_id: reply.network_id, revision: reply.revision, ai_drafted: !!reply.ai,
        flags: json<Array<{ code: string; blocking: boolean }>>(reply.flags) ?? [], hold: json(reply.hold), error: json(reply.error), ledger_id: reply.ledger_id, charge_usd: reply.charge_usd,
      } : null,
      // The account may answer it only when its author engaged first, and only once (D-4).
      may_reply: row.engaged_first === 1 && !answered,
      offer: offer ? { id: offer.id, state: offer.state, attempts: offer.attempts, sent_at: iso(offer.sent_at), outcome: json(offer.outcome) } : null,
    }
  })
}

/** An account's inbox, newest first. */
export async function listInbox(db: D1Database, accountId: string, limit = 200) {
  const rows = (await db.prepare('SELECT * FROM stump_inbox_items WHERE account_id=? ORDER BY COALESCE(occurred_at,received_at) DESC,network_id DESC LIMIT ?').bind(accountId, limit).all<InboxRow>()).results
  const total = await db.prepare('SELECT COUNT(*) AS n FROM stump_inbox_items WHERE account_id=?').bind(accountId).first<{ n: number }>()
  const cursor = await db.prepare('SELECT polled_at,reads,charge_micro,last_error FROM stump_inbox_cursors WHERE account_id=?').bind(accountId)
    .first<{ polled_at: number; reads: number; charge_micro: number; last_error: string | null }>()
  return {
    items: await inboxViews(db, rows), total: total?.n ?? 0,
    last_poll: cursor ? { at: iso(cursor.polled_at), reads: cursor.reads, charge_usd: cursor.charge_micro / 1e6, error: json(cursor.last_error) } : null,
  }
}

export const countInbox = async (db: D1Database, accountId: string) =>
  (await db.prepare('SELECT COUNT(*) AS n FROM stump_inbox_items WHERE account_id=?').bind(accountId).first<{ n: number }>())?.n ?? 0
