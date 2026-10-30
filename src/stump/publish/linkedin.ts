import { linkedInFor } from '../accounts/clients.ts'
import {
  LINKEDIN_IMAGE_TYPES, LINKEDIN_MEMBER_DAILY_LIMIT, createLinkedInPost, deleteLinkedInPost, estimateLinkedInRequests, evaluateLinkedInDailyQuota, findOwnLinkedInPostByText,
  getLinkedInPost, linkedInDayWindow, uploadLinkedInImage, validateLinkedInPost, type LinkedInError, type LinkedInImageRef, type LinkedInPostInput,
} from '../lib/linkedin/index.ts'
import { credentialsRefused, notReady, removeEach } from './held.ts'
import { postedParts, recordCall, savePart } from './parts.ts'
import type { DueItem, PublishContext, PublishOutcome, Publisher } from './types.ts'

// LinkedIn member posts through the company's app (Share on LinkedIn): text,
// an article link with its preview text, and images with alt text, within
// LinkedIn's per-member day limit. Nothing here likes, comments on or shares
// another member's post (STUMP-PUBLISH-005, D-4).

function input(item: DueItem, urn: string, images: LinkedInImageRef[] = []): LinkedInPostInput {
  const link = item.options.link
  return {
    authorUrn: urn, text: item.text ?? '',
    ...(images.length ? { images } : link ? { article: { source: link.url, title: link.title, ...(link.description ? { description: link.description } : {}) } } : {}),
  }
}

const error = (e: LinkedInError) => ({ code: e.code ?? e.providerCode ?? e.kind, message: e.message })

/** Requests this member made through Stump since 00:00 UTC. */
async function usedToday(ctx: PublishContext): Promise<number> {
  const day = Date.parse(linkedInDayWindow(ctx.now()).startsAt)
  const row = await ctx.db.prepare("SELECT COALESCE(SUM(units),0) AS n FROM stump_network_calls WHERE network='linkedin' AND account_id=? AND at>=?").bind(ctx.account.id, day).first<{ n: number }>()
  return row?.n ?? 0
}

export const linkedinPublisher: Publisher = {
  async check(item, ctx) {
    if (item.format !== 'post') return [{ code: 'format_unsupported', message: 'LinkedIn member posts are single posts. Threads, replies and comments on other members\' posts are not offered.' }]
    const images = item.media.map((media, index) => ({ urn: `urn:li:image:check${index}`, ...(media.alt ? { altText: media.alt } : {}) }))
    const bad = validateLinkedInPost(input(item, 'urn:li:person:check', images))
    const unsupported = item.media.filter(media => !(LINKEDIN_IMAGE_TYPES as readonly string[]).includes(media.type))
      .map(media => ({ code: 'unsupported_media', message: `LinkedIn images are JPG, PNG or GIF, not ${media.type}.` }))
    return [...(bad ? [{ code: bad.code ?? bad.kind, message: bad.message }] : []), ...unsupported]
  },

  async publish(item, ctx) {
    const opened = await linkedInFor(ctx.env, ctx.db, ctx.account, ctx.now)
    if (!opened.ok) return notReady(opened)
    const li = opened.client, urn = opened.credentials.network === 'linkedin' ? opened.credentials.urn : ''
    const already = (await postedParts(ctx, item))[0]
    let ref = already ? { urn: already.network_id, url: already.url } : null
    if (!ref) {
      const quota = evaluateLinkedInDailyQuota({ used: await usedToday(ctx), wanted: estimateLinkedInRequests({ images: item.media.length }), limit: LINKEDIN_MEMBER_DAILY_LIMIT, now: ctx.now() })
      if (!quota.allowed) return { state: 'held', kind: 'day_limit', next_attempt_at: Date.parse(quota.holdUntil!), error: { code: 'daily_limit', message: quota.reason! } }
      const images: LinkedInImageRef[] = []
      for (const media of item.media) {
        const uploaded = await uploadLinkedInImage(li, { ownerUrn: urn, bytes: media.bytes, mediaType: media.type, ...(media.alt ? { altText: media.alt } : {}) })
        await recordCall(ctx, { network: 'linkedin', item_id: item.id, act: 'image_upload', units: 2 })
        if (!uploaded.ok) return fault(ctx, uploaded.error)
        images.push({ urn: uploaded.value.imageUrn, ...(media.alt ? { altText: media.alt } : {}) })
      }
      const post = input(item, urn, images)
      const created = await createLinkedInPost(li, post)
      await recordCall(ctx, { network: 'linkedin', item_id: item.id, act: 'post' })
      if (!created.ok) {
        if (created.error.mayHaveApplied) {
          // A lost answer: look for the member's own post by its text before deciding (D-5).
          const found = await findOwnLinkedInPostByText(li, { authorUrn: urn, text: post.text })
          await recordCall(ctx, { network: 'linkedin', item_id: item.id, act: 'read' })
          if (!found.ok || !found.value.match) return { state: 'uncertain', error: error(created.error) }
          ref = { urn: found.value.match.urn, url: found.value.match.url }
        } else return fault(ctx, created.error)
      } else ref = { urn: created.value.urn, url: created.value.url }
      await savePart(ctx, item, { part: 0, network_id: ref.urn, url: ref.url, ref: null, text: null })
    }
    const back = await getLinkedInPost(li, ref.urn)
    await recordCall(ctx, { network: 'linkedin', item_id: item.id, act: 'read' })
    if (back.ok) return { state: 'posted', url: back.value.url, network_id: back.value.urn, posted_at: ctx.now(), text: back.value.text }
    // Share on LinkedIn grants no read scope (docs/networks.md): LinkedIn's own post URN from its
    // answer stands as the network's id, and the text is the commentary it accepted.
    if (back.error.kind === 'permission_denied') return { state: 'posted', url: ref.url, network_id: ref.urn, posted_at: ctx.now(), text: item.text ?? '' }
    return { state: 'uncertain', error: { code: 'readback_failed', message: back.error.message } }
  },

  async readBack(url, ctx) {
    const urn = /urn:li:(?:share|ugcPost):[A-Za-z0-9_-]+/.exec(decodeURIComponent(url))?.[0]
    if (!urn) return { ok: false, message: `${url} is not a LinkedIn post address.` }
    const opened = await linkedInFor(ctx.env, ctx.db, ctx.account, ctx.now)
    if (!opened.ok) return { ok: false, message: opened.message }
    const back = await getLinkedInPost(opened.client, urn)
    await recordCall(ctx, { network: 'linkedin', item_id: null, act: 'read' })
    if (back.ok) return { ok: true, url: back.value.url, network_id: back.value.urn, text: back.value.text }
    // Without a read scope the URN the owner gives stands, and the text is the one Stump sent.
    if (back.error.kind === 'permission_denied') return { ok: true, url: `https://www.linkedin.com/feed/update/${urn}/`, network_id: urn, text: null }
    return { ok: false, message: back.error.message }
  },

  async remove(entry, ctx) {
    const opened = await linkedInFor(ctx.env, ctx.db, ctx.account, ctx.now)
    if (!opened.ok) return { outcome: 'failed', error: opened.message }
    return removeEach([entry.network_id], async urn => {
      const gone = await deleteLinkedInPost(opened.client, urn)
      await recordCall(ctx, { network: 'linkedin', item_id: null, act: 'delete' })
      if (gone.ok) return { outcome: 'deleted' }
      if (gone.error.kind === 'not_found') return { outcome: 'not_found' }
      if (gone.error.kind === 'auth_expired' || gone.error.kind === 'auth_revoked') await credentialsRefused(ctx, gone.error.kind === 'auth_expired' ? 'expired' : 'revoked', error(gone.error))
      return { outcome: 'failed', error: gone.error.message }
    })
  },
}

async function fault(ctx: PublishContext, e: LinkedInError): Promise<PublishOutcome> {
  // A 401: LinkedIn refused the member's token, as revoked (REVOKED_ACCESS_TOKEN) or expired.
  if (e.kind === 'auth_expired' || e.kind === 'auth_revoked') return credentialsRefused(ctx, e.kind === 'auth_expired' ? 'expired' : 'revoked', error(e))
  // LinkedIn's day throttle names no reset time; its day ends at 00:00 UTC (STUMP-PUBLISH-005.3).
  if (e.kind === 'rate_limited') return { state: 'held', kind: 'day_limit', next_attempt_at: Date.parse(e.resetAt ?? linkedInDayWindow(ctx.now()).resetsAt), error: error(e) }
  if (e.mayHaveApplied) return { state: 'uncertain', error: error(e) }
  return { state: 'failed', error: error(e) }
}
