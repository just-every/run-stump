/**
 * Posts: create (text, replies, polls, media), read back, delete, look up by text, threads.
 *
 * Sources (read 30 Oct 2026):
 *  - https://docs.x.com/x-api/posts/creation-of-a-post  POST /2/tweets, 201 {data:{id,text}}
 *      body: text, reply.in_reply_to_tweet_id, poll{options 2-4 of 1-25 chars, duration_minutes 5-10080},
 *      media.media_ids (1-4), quote_tweet_id (Enterprise only), reply_settings, made_with_ai;
 *      scopes tweet.read users.read tweet.write
 *  - https://docs.x.com/x-api/posts/get-post-by-id  GET /2/tweets/{id}
 *  - https://docs.x.com/x-api/posts/delete-post  DELETE /2/tweets/{id} -> {data:{deleted}}
 *  - https://docs.x.com/x-api/getting-started/pricing  per-request post price, owned reads per resource
 *
 * X has no idempotency key. A write that times out or answers 5xx is an unknown outcome:
 * look the post up with findOwnXPostByText before anything is sent again.
 */
import { quoteXPost, quoteXRead, sumCharges } from './charge'
import { localXError } from './errors'
import { checkXLength, X_DEFAULT_POST_LIMIT } from './length'
import { fieldsParam, resourceError, xCall } from './http'
import { normalizeXText, parsePost, postFieldList, type XPostReadback } from './readback'
import type { XChargeQuote, XContext, XError, XPriceTable, XResult } from './types'

export interface XPollInput {
  options: string[]
  durationMinutes: number
}

export interface XPostInput {
  text: string
  /** Reply to this post id. The API only allows it where the author mentioned or quoted the account. */
  replyToId?: string
  /** Media ids from uploadXMedia; 1 to 4. Cannot be combined with a poll. */
  mediaIds?: string[]
  poll?: XPollInput
  /** Needs X's Enterprise plan; pay-per-use answers with a refusal. */
  quotePostId?: string
  /** The account's weighted limit when longer than 280. */
  weightedLimit?: number
  /** Marks the post as made with AI where X offers the flag. */
  madeWithAi?: boolean
}

export const X_POLL_LIMITS = { optionsMin: 2, optionsMax: 4, optionChars: 25, minutesMin: 5, minutesMax: 10_080 } as const

/** Checks a post before anything is sent or scheduled. Returns null when it is fine. */
export function validateXPost(input: XPostInput): XError | null {
  const hasMedia = (input.mediaIds?.length ?? 0) > 0
  if (input.text.trim() === '' && !hasMedia && !input.poll) return localXError('empty', 'A post needs text, media or a poll.')
  const len = checkXLength(input.text, input.weightedLimit ?? X_DEFAULT_POST_LIMIT)
  if (!len.valid) {
    return localXError('too_long', `The post weighs ${len.weightedLength} against the account's limit of ${len.limit} (${len.over} over).`)
  }
  if (hasMedia) {
    const n = input.mediaIds!.length
    if (n > 4) return localXError('too_many_media', 'X allows up to 4 images, or one GIF or video, on a post.')
    if (input.mediaIds!.some((m) => !/^\d{1,19}$/.test(m))) return localXError('bad_media_id', 'A media id must be 1 to 19 digits.')
  }
  if (input.poll) {
    const { options, durationMinutes } = input.poll
    if (hasMedia) return localXError('poll_with_media', 'A post cannot carry both a poll and media.')
    if (options.length < X_POLL_LIMITS.optionsMin || options.length > X_POLL_LIMITS.optionsMax) return localXError('bad_poll', 'A poll needs 2 to 4 options.')
    if (options.some((o) => o.length < 1 || [...o].length > X_POLL_LIMITS.optionChars)) return localXError('bad_poll', 'Each poll option is 1 to 25 characters.')
    if (!Number.isInteger(durationMinutes) || durationMinutes < X_POLL_LIMITS.minutesMin || durationMinutes > X_POLL_LIMITS.minutesMax) {
      return localXError('bad_poll', 'A poll lasts 5 to 10080 minutes.')
    }
  }
  if (input.replyToId !== undefined && !/^\d{1,19}$/.test(input.replyToId)) return localXError('bad_reply_id', 'A post id is 1 to 19 digits.')
  return null
}

export interface XPosted {
  id: string
  url: string
  text: string
  /** The charge for this post from the company's price table. */
  charge: XChargeQuote
}

/** POST /2/tweets. The charge is the one quoted for the exact text sent. */
export async function createXPost(ctx: XContext, input: XPostInput, prices: XPriceTable): Promise<XResult<XPosted>> {
  const bad = validateXPost(input)
  if (bad) return { ok: false, error: bad }
  const body: Record<string, unknown> = { text: input.text }
  if (input.replyToId) body.reply = { in_reply_to_tweet_id: input.replyToId }
  if (input.mediaIds?.length) body.media = { media_ids: input.mediaIds }
  if (input.poll) body.poll = { options: input.poll.options, duration_minutes: input.poll.durationMinutes }
  if (input.quotePostId) body.quote_tweet_id = input.quotePostId
  if (input.madeWithAi) body.made_with_ai = true
  const charge = quoteXPost(input.text, prices)
  return xCall<XPosted>(ctx, {
    method: 'POST',
    visible: true,
    isReply: !!input.replyToId,
    path: '/2/tweets',
    json: body,
    parse: (b, status) => {
      const id = b?.data?.id
      if (typeof id !== 'string' || !/^\d+$/.test(id)) {
        // X accepted the request but the answer carries no id: the post may exist.
        return { kind: 'unknown_outcome', status, message: 'X answered the post without an id.', type: null, code: 'no_id', resetAt: null, retry: 'read_back_first', mayHaveApplied: true }
      }
      return { id, url: `https://x.com/${ctx.username || 'i'}/status/${id}`, text: input.text, charge }
    },
  })
}

export interface XReadOptions {
  /** True (the default) for the account's own post: priced as an owned read. */
  owned?: boolean
}

/** GET /2/tweets/{id}: the post as X shows it, with media alt text and poll. */
export async function getXPost(
  ctx: XContext,
  id: string,
  prices: XPriceTable,
  opts: XReadOptions = {},
): Promise<XResult<XPostReadback & { charge: XChargeQuote }>> {
  const owned = opts.owned ?? true
  return xCall(ctx, {
    method: 'GET',
    visible: false,
    path: `/2/tweets/${encodeURIComponent(id)}`,
    query: {
      [fieldsParam(ctx, 'post')]: postFieldList(ctx),
      expansions: 'author_id,attachments.media_keys,attachments.poll_ids',
      [fieldsParam(ctx, 'media')]: 'media_key,type,url,alt_text',
      [fieldsParam(ctx, 'poll')]: 'options,duration_minutes,end_datetime,voting_status',
      [fieldsParam(ctx, 'user')]: 'username,name,public_metrics',
    },
    parse: (body, status) => {
      const missing = resourceError(body, status)
      if (missing) return missing
      if (!body?.data?.id) {
        return { kind: 'server_error', status, message: 'X answered the read without a post.', type: null, code: 'no_post', resetAt: null, retry: 'safe', mayHaveApplied: false }
      }
      return { ...parsePost(body.data, body.includes, ctx), charge: quoteXRead(1, prices, owned) }
    },
  })
}

/** DELETE /2/tweets/{id}. A post that is already gone answers not_found. */
export async function deleteXPost(ctx: XContext, id: string): Promise<XResult<{ deleted: boolean }>> {
  return xCall<{ deleted: boolean }>(ctx, {
    method: 'DELETE',
    visible: true,
    path: `/2/tweets/${encodeURIComponent(id)}`,
    parse: (b, status) => {
      if (b?.data?.deleted === true) return { deleted: true }
      if (b?.data?.deleted === false) {
        return { kind: 'forbidden', status, message: 'X reported the post was not deleted.', type: null, code: 'not_deleted', resetAt: null, retry: 'never', mayHaveApplied: false }
      }
      return { kind: 'unknown_outcome', status, message: 'X answered the delete without saying whether it happened.', type: null, code: 'no_result', resetAt: null, retry: 'read_back_first', mayHaveApplied: true }
    },
  })
}

export interface XFindInput {
  userId: string
  /** The text that was sent. */
  text: string
  /** Only posts at or after this ISO time are looked at. */
  since?: string
  /** Posts to read from the account's recent timeline, 5 to 100. Defaults to 20. */
  maxResults?: number
}

/**
 * Looks for the account's own post with this exact text on its recent timeline
 * (GET /2/users/{id}/tweets), for the read-back after a lost answer. Each post read is an
 * owned read. Returns null when nothing matches, which with a lost answer means the
 * outcome is still unknown only if the timeline window may have missed it.
 */
export async function findOwnXPostByText(
  ctx: XContext,
  input: XFindInput,
  prices: XPriceTable,
): Promise<XResult<{ match: XPostReadback | null; scanned: number; charge: XChargeQuote }>> {
  const want = normalizeXText(input.text)
  return xCall(ctx, {
    method: 'GET',
    visible: false,
    path: `/2/users/${encodeURIComponent(input.userId)}/tweets`,
    query: {
      max_results: Math.min(100, Math.max(5, input.maxResults ?? 20)),
      start_time: input.since,
      [fieldsParam(ctx, 'post')]: postFieldList(ctx),
      expansions: 'author_id',
      [fieldsParam(ctx, 'user')]: 'username,name',
    },
    parse: (body) => {
      const rows: any[] = Array.isArray(body?.data) ? body.data : []
      const posts = rows.map((r) => parsePost(r, body?.includes, ctx))
      const match = posts.find((p) => normalizeXText(p.text) === want) ?? null
      return { match, scanned: posts.length, charge: quoteXRead(posts.length, prices, true) }
    },
  })
}

export interface XThreadPosted {
  index: number
  id: string
  url: string
  text: string
}

export interface XThreadInput {
  parts: XPostInput[]
  /** Reply the first part to this post; later parts reply to the part before. */
  replyToId?: string
  /** Parts already posted, in order (a resume). Their ids anchor the rest. */
  posted?: { id: string; url?: string; text?: string }[]
  /** Called as each part lands, before the next is sent, so the caller can save progress. */
  onPosted?: (part: XThreadPosted, charge: XChargeQuote) => void | Promise<void>
}

export interface XThreadResult {
  /** complete: every part is up. partial: some are, the rest are not. failed: none are. */
  status: 'complete' | 'partial' | 'failed'
  /** All parts up so far, earlier ones from `posted` included. */
  posts: XThreadPosted[]
  /** Index of the part that failed, or null. */
  failedIndex: number | null
  error: XError | null
  /** True when the failure was an unknown outcome: read back before resuming. */
  needsReadBack: boolean
  /** Charges for the parts this call posted. */
  charges: XChargeQuote[]
  usd: number
  usd_micro: number
}

/**
 * Posts a thread as a reply chain, one part at a time. Every part is checked first, so a
 * part that is too long refuses the whole thread before anything is sent. On a failure it
 * stops and reports which part; call again with `posted` set to the parts that are up and
 * the rest is posted once.
 */
export async function publishXThread(ctx: XContext, input: XThreadInput, prices: XPriceTable): Promise<XThreadResult> {
  const prior = input.posted ?? []
  const posts: XThreadPosted[] = prior.map((p, index) => ({ index, id: p.id, url: p.url ?? `https://x.com/${ctx.username || 'i'}/status/${p.id}`, text: p.text ?? input.parts[index]?.text ?? '' }))
  const result = (status: XThreadResult['status'], failedIndex: number | null, error: XError | null, charges: XChargeQuote[]): XThreadResult => ({
    status, posts, failedIndex, error, needsReadBack: error?.retry === 'read_back_first', charges, ...sumCharges(charges),
  })
  if (input.parts.length === 0) return result('failed', null, localXError('empty_thread', 'A thread needs at least one part.'), [])
  if (prior.length > input.parts.length) return result('failed', null, localXError('bad_resume', 'More parts are recorded as posted than the thread has.'), [])
  for (let i = prior.length; i < input.parts.length; i++) {
    const bad = validateXPost({ ...input.parts[i], replyToId: undefined })
    if (bad) return result(posts.length ? 'partial' : 'failed', i, { ...bad, message: `Part ${i + 1}: ${bad.message}` }, [])
  }
  const charges: XChargeQuote[] = []
  for (let i = prior.length; i < input.parts.length; i++) {
    const replyToId = i === 0 ? input.replyToId : posts[i - 1].id
    const r = await createXPost(ctx, { ...input.parts[i], replyToId }, prices)
    if (!r.ok) return result(posts.length ? 'partial' : 'failed', i, r.error, charges)
    const landed: XThreadPosted = { index: i, id: r.value.id, url: r.value.url, text: r.value.text }
    posts.push(landed)
    charges.push(r.value.charge)
    await input.onPosted?.(landed, r.value.charge)
  }
  return result('complete', null, null, charges)
}
