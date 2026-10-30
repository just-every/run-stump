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
 * GET /2/users/{id}/mentions also takes until_id (1-19 digits; since_id must be less than
 * until_id when both are sent), which is how a backlog bigger than one poll's page budget
 * is drained: each later poll continues downward below the oldest post already read.
 *
 * The caller stores one value, `nextSinceId`, and passes it back as `sinceId`. Normally it is
 * the newest post id read. While a backlog is draining it is a drain cursor
 * (`drain:<since>:<until>:<newest>`) holding the floor (since_id), the point to continue
 * below (until_id) and the newest id already read; once a poll finishes the backlog it
 * collapses to that newest id. Nothing is skipped and no post is read (or billed) twice.
 * A page that fails after earlier pages succeeded ends the poll the same way a spent page
 * budget does: the posts already read come back with their charge and a drain cursor, and the
 * page's error rides along as `stoppedBy`.
 */
import { quoteXRead } from './charge'
import { localXError } from './errors'
import { fieldsParam, xCall } from './http'
import { parsePost, postFieldList, type XPostReadback } from './readback'
import type { XChargeQuote, XContext, XError, XPriceTable, XResult } from './types'

export interface XMention extends XPostReadback {
  /** Always true: the author mentioned the account, which is what lets the account reply by API. */
  engagedFirst: true
}

export interface XMentionsInput {
  userId: string
  /** The stored cursor: the `nextSinceId` of the previous poll (a post id or a drain cursor). */
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
  /** True when more mentions may be waiting than this poll read: the page budget ran out, or a later page failed. */
  truncated: boolean
  /**
   * The error of a page that failed after earlier pages succeeded, or null. The items, reads
   * and charge above are what X already billed; store them and the cursor, and wait out the
   * error's resetAt / retry before the next poll. When the first page fails, the poll itself
   * returns the error instead.
   */
  stoppedBy: XError | null
  /**
   * Store this and pass it back as `sinceId`. While `truncated` it is a drain cursor, so the
   * next poll reads the older mentions this poll had no budget for; after that it is the
   * newest id read.
   */
  nextSinceId: string | null
  /** When `truncated`, the oldest id read: the next poll is sent with until_id set to it. Otherwise null. */
  resumeUntilId: string | null
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

const ID = /^[0-9]{1,19}$/

interface MentionsCursor {
  sinceId: string | null
  untilId: string | null
  /** Newest id already read while draining; becomes the cursor once the drain finishes. */
  highId: string | null
}

function parseMentionsCursor(value: string | null | undefined): MentionsCursor | null {
  if (!value) return { sinceId: null, untilId: null, highId: null }
  if (ID.test(value)) return { sinceId: value, untilId: null, highId: null }
  const m = /^drain:([0-9]{0,19}):([0-9]{1,19}):([0-9]{1,19})$/.exec(value)
  if (!m) return null
  const sinceId = m[1] || null
  if (sinceId && compareXIds(sinceId, m[2]) >= 0) return null
  return { sinceId, untilId: m[2], highId: m[3] }
}

function drainCursor(sinceId: string | null, untilId: string, highId: string): string {
  return `drain:${sinceId ?? ''}:${untilId}:${highId}`
}

export async function fetchXMentions(ctx: XContext, input: XMentionsInput, prices: XPriceTable): Promise<XResult<XMentionsPoll>> {
  const cursor = parseMentionsCursor(input.sinceId)
  if (!cursor) return { ok: false, error: localXError('bad_cursor', 'The stored X mentions cursor is not a post id or a drain cursor.') }
  const maxPages = Math.max(1, input.maxPages ?? 5)
  const pageSize = Math.min(100, Math.max(5, input.pageSize ?? 100))
  const collected: XMention[] = []
  let token: string | undefined
  let pages = 0
  let reads = 0
  let truncated = false
  let lastStatus = 200
  let rateLimit: Extract<XResult<unknown>, { ok: true }>['rateLimit'] = null
  let stoppedBy: XError | null = null

  while (pages < maxPages) {
    const page = await xCall<{ rows: XMention[]; next: string | null; count: number }>(ctx, {
      method: 'GET',
      visible: false,
      path: `/2/users/${encodeURIComponent(input.userId)}/mentions`,
      query: {
        max_results: pageSize,
        since_id: cursor.sinceId ?? undefined,
        until_id: cursor.untilId ?? undefined,
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
      // Nothing read yet: the poll is the error and the cursor stays where it was.
      if (pages === 0) return page
      // X already billed the earlier pages. Keep them, and continue below them next time.
      stoppedBy = page.error
      truncated = true
      break
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
  const oldestId = items.length ? items[0].id : null
  // The newest id read so far, across this poll and any drain it continues.
  const highId = cursor.highId ?? newestId ?? cursor.sinceId
  let nextSinceId: string | null
  let resumeUntilId: string | null = null
  if (truncated && oldestId && highId) {
    // Continue below the oldest post read; the floor stays where it was.
    resumeUntilId = oldestId
    nextSinceId = drainCursor(cursor.sinceId, oldestId, highId)
  } else if (truncated) {
    // Nothing was read before the budget ran out or a page failed: keep the cursor exactly as it was.
    nextSinceId = input.sinceId ?? null
  } else {
    nextSinceId = highId
  }
  return {
    ok: true,
    status: lastStatus,
    rateLimit,
    value: { items, reads, pages, charge: quoteXRead(reads, prices, false), truncated, stoppedBy, nextSinceId, resumeUntilId, newestId },
  }
}
