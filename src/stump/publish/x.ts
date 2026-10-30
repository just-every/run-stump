import { xFor } from '../accounts/clients.ts'
import { shownHandle } from '../accounts/handle.ts'
import { needsReconnect } from '../accounts/store.ts'
import { findOwnXPostByText, getXPost, publishXThread, quoteXThread, uploadXMedia, validateXPost, type XError, type XPostInput } from '../lib/x/index.ts'
import { partKey, postedParts, recordCall, savePart, textsOf } from './parts.ts'
import type { DueItem, PublishContext, PublishOutcome, Publisher } from './types.ts'

// X: posts, threads as reply chains, replies, polls and media with alt text
// through the company's own X app, each call charged from the company's price
// table. X takes no idempotency key, so a lost answer is looked up by text
// before anything else happens (STUMP-PUBLISH-004, STUMP-SURFACE-004).

const replyId = (url: string) => /\/status(?:es)?\/(\d{1,19})/.exec(url)?.[1] ?? null

function inputs(item: DueItem, limit: number, mediaIds: string[] = []): XPostInput[] {
  const poll = item.options.poll
  return textsOf(item).map((text, index) => ({
    text, weightedLimit: limit,
    ...(index === 0 && mediaIds.length ? { mediaIds } : {}),
    ...(index === 0 && poll ? { poll: { options: poll.options, durationMinutes: poll.duration_minutes ?? Math.round((poll.expires_in ?? 86_400) / 60) } } : {}),
  }))
}

const error = (e: XError) => ({ code: e.code ?? e.kind, message: e.message })

export const xPublisher: Publisher = {
  async check(item, ctx) {
    if (item.format === 'pitch') return [{ code: 'format_unsupported', message: 'A pitch goes to its recipient, not to X.' }]
    if (item.reply_to && !replyId(item.reply_to.url)) return [{ code: 'reply_target_invalid', message: `${item.reply_to.url} is not an X post address.` }]
    const placeholderMedia = item.media.map((_media, index) => String(index + 1))
    return inputs(item, ctx.account.post_limit ?? 280, placeholderMedia).flatMap((input, index) => {
      const bad = validateXPost(input)
      return bad ? [{ code: bad.code ?? bad.kind, message: bad.message, ...(item.format === 'thread' ? { path: `parts[${index}]` } : {}) }] : []
    })
  },

  quote(item, prices) { return quoteXThread(textsOf(item), prices).usd_micro },

  async publish(item, ctx) {
    const opened = await xFor(ctx.env, ctx.db, ctx.account, ctx.now)
    if (!opened.ok) return { state: 'held', kind: opened.code === 'app_not_set' ? 'rule' : 'reconnect', next_attempt_at: null, error: { code: opened.code, message: opened.message } }
    const x = opened.client, userId = opened.credentials.network === 'x' ? opened.credentials.user_id : ''
    const mediaIds: string[] = []
    for (const media of item.media) {
      const uploaded = await uploadXMedia(x, { bytes: media.bytes, mediaType: media.type, ...(media.alt ? { altText: media.alt } : {}) })
      await recordCall(ctx, { network: 'x', item_id: item.id, act: 'media_upload' })
      if (!uploaded.ok) return fault(ctx, uploaded.error, 0, null)
      mediaIds.push(uploaded.value.mediaId)
    }
    const parts = inputs(item, ctx.account.post_limit ?? 280, mediaIds)
    const replyTo = item.reply_to ? replyId(item.reply_to.url) ?? undefined : undefined
    let posted = (await postedParts(ctx, item)).map(part => ({ id: part.network_id, url: part.url }))
    /** The account's own post holding part index's text, read from X's timeline (D-5). */
    const lookUp = async (index: number) => {
      const found = await findOwnXPostByText(x, { userId, text: parts[index]!.text, since: new Date(item.scheduled_at - 60_000).toISOString() }, ctx.prices)
      if (found.ok) await recordCall(ctx, { network: 'x', item_id: item.id, act: found.value.charge.act, units: found.value.charge.units, usd_micro: found.value.charge.usd_micro })
      if (!found.ok || !found.value.match) return null
      // A post another item already holds is not this one: X refused this one as its duplicate.
      const elsewhere = await ctx.db.prepare('SELECT 1 FROM stump_item_parts WHERE network_id=? AND item_id<>? LIMIT 1').bind(found.value.match.id, item.id).first()
      if (elsewhere) return null
      await savePart(ctx, item, { part: index, network_id: found.value.match.id, url: found.value.match.url, ref: null, text: found.value.match.text })
      return { id: found.value.match.id, url: found.value.match.url }
    }
    // Resuming: the part that stopped may have landed after all, so X is read before it is sent again.
    while (posted.length && posted.length < parts.length) {
      const landed = await lookUp(posted.length)
      if (!landed) break
      posted = [...posted, landed]
    }
    while (posted.length < parts.length) {
      const result = await publishXThread(x, {
        parts, ...(replyTo ? { replyToId: replyTo } : {}), posted,
        onPosted: async (part, charge) => {
          await recordCall(ctx, { network: 'x', item_id: item.id, act: charge.act, units: charge.units, usd_micro: charge.usd_micro })
          await savePart(ctx, item, { part: part.index, network_id: part.id, url: part.url, ref: null, text: part.text })
        },
      }, ctx.prices)
      posted = result.posts.map(part => ({ id: part.id, url: part.url }))
      if (result.status === 'complete') break
      const e = result.error!, index = result.failedIndex ?? posted.length
      if (e.kind === 'unknown_outcome' || e.kind === 'duplicate_content') {
        // A lost answer, or X calling it a duplicate, may hide this very post: read the timeline first (D-5).
        const landed = await lookUp(index)
        if (landed) { posted = [...posted, landed]; continue }
        // A lost first post is uncertain; a lost later part leaves the earlier ones up, partly posted,
        // and resuming reads X again before it sends that part (STUMP-PUBLISH-004.4).
        if (e.kind === 'unknown_outcome' && !posted.length) return { state: 'uncertain', error: error(e) }
      }
      return fault(ctx, e, posted.length, posted[0] ? { url: posted[0].url, network_id: posted[0].id } : null)
    }
    // Posted only once every part reads back from X with its id and URL (D-5); each read is an owned read.
    const texts: string[] = []
    for (const part of posted) {
      const back = await getXPost(x, part.id, ctx.prices, { owned: true })
      if (back.ok) await recordCall(ctx, { network: 'x', item_id: item.id, act: back.value.charge.act, units: back.value.charge.units, usd_micro: back.value.charge.usd_micro })
      if (!back.ok) return { state: 'uncertain', error: { code: 'readback_failed', message: back.error.message } }
      texts.push(back.value.text)
    }
    return { state: 'posted', url: posted[0]!.url, network_id: posted[0]!.id, posted_at: ctx.now(), text: texts.join('\n\n') }
  },

  async readBack(url, ctx) {
    const id = replyId(url)
    if (!id) return { ok: false, message: `${url} is not an X post address.` }
    const opened = await xFor(ctx.env, ctx.db, ctx.account, ctx.now)
    if (!opened.ok) return { ok: false, message: opened.message }
    const back = await getXPost(opened.client, id, ctx.prices, { owned: true })
    if (!back.ok) return { ok: false, message: back.error.message }
    await recordCall(ctx, { network: 'x', item_id: null, act: back.value.charge.act, units: back.value.charge.units, usd_micro: back.value.charge.usd_micro })
    if (opened.credentials.network === 'x' && back.value.authorId && back.value.authorId !== opened.credentials.user_id) return { ok: false, message: `${url} is not a post of ${shownHandle(ctx.account)}.` }
    return { ok: true, url: back.value.url, network_id: back.value.id, text: back.value.text }
  },
}

async function fault(ctx: PublishContext, e: XError, postedCount: number, first: { url: string; network_id: string } | null): Promise<PublishOutcome> {
  if (e.kind === 'auth_revoked') {
    await needsReconnect(ctx.db, ctx.env, ctx.account, 'revoked', ctx.now())
    return { state: 'held', kind: 'reconnect', next_attempt_at: null, error: error(e) }
  }
  // Exhausted credits wait for a person to add them; a rate limit waits for its window, never a blind retry.
  if (e.kind === 'credits_exhausted') return { state: 'held', kind: 'credits', next_attempt_at: null, error: { code: 'credits_exhausted', message: e.message } }
  if (e.kind === 'rate_limited') return { state: 'held', kind: 'rate_limit', next_attempt_at: e.resetAt ? Date.parse(e.resetAt) : null, error: error(e) }
  if (e.kind === 'duplicate_content') return { state: 'failed', error: { code: 'duplicate_content', message: e.message } }
  if (postedCount > 0 && first) return { state: 'partly_posted', ...first, posted_parts: postedCount, error: error(e) }
  return { state: 'failed', error: error(e) }
}
