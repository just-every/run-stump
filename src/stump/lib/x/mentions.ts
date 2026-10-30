/**
 * The inbox read: posts that mention the connected account.
 *
 * Source: https://docs.x.com/x-api/users/get-mentions.md (read 30 Oct 2026)
 *   GET /2/users/{id}/mentions; max_results 5-100; since_id; pagination_token; expansions
 *   author_id; response data[], includes.users, meta{newest_id, oldest_id, result_count,
 *   next_token}; scopes users.read and tweet.read.
 * Pricing: https://docs.x.com/x-api/getting-started/pricing bills reads per post resource
 *   returned; the charge here is posts returned x the company's read price. Expanded
 *   users are not added (the company's four-row table has no user-read price).
 *
 * Results arrive newest first. Items come back oldest first so a poll can be stored in order.
 * Paging never skips: when the page budget runs out with more still waiting, the cursor
 * does not move past what was not read (see `nextSinceId`).
 */
import { quoteXRead } from './charge'
import { fieldsParam, xCall } from './http'
import { parsePost, postFieldList, type XPostReadback } from './readback'
import type { XChargeQuote, XContext, XPriceTable, XResult } from './types'

export interface XMention extends XPostReadback {
  /** Always true: the author mentioned the account, which is what lets the account reply by API. */
  engagedFirst: true
}

export interface XMentionsInput {
  userId: string
  /** Only mentions newer than this id. */
  sinceId?: string | null
  /** Pages to read per poll; defaults to 5. */
  maxPages?: number
  /** Posts per page, 5 to 100; defaults to 100. */
  pageSize?: number
}

export interface XMentionsPoll {
  /** Oldest first. */
  items: XMention[]
  /** Posts X returned (each is billed as a read). */
  reads: number
  pages: number
  charge: XChargeQuote
  /** True when more mentions were waiting than the page budget read. */
  truncated: boolean
  /** Store this as the next `sinceId`. It does not advance while `truncated`, so nothing is skipped. */
  nextSinceId: string | null
  /** Newest id seen in this poll, for display. */
  newestId: string | null
}

/** Compares two post ids as numbers without losing precision. */
export function compareXIds(a: string, b: string): number {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** Keeps the first copy of each post id and drops ids already seen. */
export function dedupeXPosts<T extends { id: string }>(items: T[], seen: Iterable<string> = []): T[] {
  const ids = new Set(seen)
  const out: T[] = []
  for (const it of items) {
    if (ids.has(it.id)) continue
    ids.add(it.id)
    out.push(it)
  }
  return out
}

export async function fetchXMentions(ctx: XContext, input: XMentionsInput, prices: XPriceTable): Promise<XResult<XMentionsPoll>> {
  const maxPages = Math.max(1, input.maxPages ?? 5)
  const pageSize = Math.min(100, Math.max(5, input.pageSize ?? 100))
  const collected: XMention[] = []
  let token: string | undefined
  let pages = 0
  let reads = 0
  let truncated = false
  let lastStatus = 200
  let rateLimit: Extract<XResult<unknown>, { ok: true }>['rateLimit'] = null

  while (pages < maxPages) {
    const page = await xCall<{ rows: XMention[]; next: string | null; count: number }>(ctx, {
      method: 'GET',
      visible: false,
      path: `/2/users/${encodeURIComponent(input.userId)}/mentions`,
      query: {
        max_results: pageSize,
        since_id: input.sinceId || undefined,
        pagination_token: token,
        [fieldsParam(ctx, 'post')]: postFieldList(ctx),
        expansions: 'author_id',
        [fieldsParam(ctx, 'user')]: 'username,name',
      },
      parse: (body) => {
        const rows: any[] = Array.isArray(body?.data) ? body.data : []
        return {
          rows: rows.map((r) => ({ ...parsePost(r, body?.includes, ctx), engagedFirst: true as const })),
          next: typeof body?.meta?.next_token === 'string' && body.meta.next_token ? body.meta.next_token : null,
          count: rows.length,
        }
      },
    })
    if (!page.ok) {
      // A failed page after earlier pages is still an error: the cursor stays where it was.
      return page
    }
    lastStatus = page.status
    rateLimit = page.rateLimit
    pages++
    reads += page.value.count
    collected.push(...page.value.rows)
    if (!page.value.next) break
    token = page.value.next
    if (pages >= maxPages) truncated = true
  }

  const items = dedupeXPosts(collected).sort((a, b) => compareXIds(a.id, b.id))
  const newestId = items.length ? items[items.length - 1].id : null
  const nextSinceId = truncated ? input.sinceId ?? null : newestId ?? input.sinceId ?? null
  return {
    ok: true,
    status: lastStatus,
    rateLimit,
    value: { items, reads, pages, charge: quoteXRead(reads, prices, false), truncated, nextSinceId, newestId },
  }
}
