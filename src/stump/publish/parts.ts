import type { DueItem, PublishContext } from './types.ts'

// Each part of an item as it lands at the network, so a thread that stops part
// way resumes with the rest exactly once, and a retry never re-sends a part.

export interface PostedPart { part: number; network_id: string; url: string; ref: Record<string, unknown> | null; text: string | null }

export async function postedParts(ctx: Pick<PublishContext, 'db' | 'account'>, item: Pick<DueItem, 'id'>): Promise<PostedPart[]> {
  const rows = (await ctx.db.prepare('SELECT part,network_id,url,ref,text FROM stump_item_parts WHERE item_id=? AND account_id=? ORDER BY part')
    .bind(item.id, ctx.account.id).all<{ part: number; network_id: string; url: string; ref: string | null; text: string | null }>()).results
  return rows.map(row => ({ ...row, ref: row.ref ? JSON.parse(row.ref) as Record<string, unknown> : null }))
}

export async function savePart(ctx: Pick<PublishContext, 'db' | 'account' | 'now'>, item: Pick<DueItem, 'id'>, part: PostedPart) {
  await ctx.db.prepare(`INSERT INTO stump_item_parts(item_id,account_id,part,network_id,url,ref,text,posted_at) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(item_id,account_id,part) DO UPDATE SET network_id=excluded.network_id,url=excluded.url,ref=excluded.ref,text=excluded.text`)
    .bind(item.id, ctx.account.id, part.part, part.network_id, part.url, part.ref ? JSON.stringify(part.ref) : null, part.text, ctx.now()).run()
}

/** Records one call to a network with its charge from the company's price table. */
export async function recordCall(ctx: Pick<PublishContext, 'db' | 'account' | 'now'>, call: { network: string; item_id: string | null; act: string; units?: number; usd_micro?: number }) {
  await ctx.db.prepare('INSERT INTO stump_network_calls(id,network,account_id,item_id,act,units,usd_micro,at) VALUES(?,?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), call.network, ctx.account.id, call.item_id, call.act, call.units ?? 1, call.usd_micro ?? 0, ctx.now()).run()
}

/** The texts an item sends, one per post: a thread's parts, or the post or reply. */
export const textsOf = (item: Pick<DueItem, 'format' | 'text' | 'parts'>): string[] => item.format === 'thread' ? item.parts ?? [] : [item.text ?? '']

/** One idempotency key per item, account, revision and part, stable across retries and resumes. */
export const partKey = (item: Pick<DueItem, 'id' | 'revision' | 'account_id'>, part: number) => `stump-${item.id}-${item.account_id}-r${item.revision}-p${part}`
