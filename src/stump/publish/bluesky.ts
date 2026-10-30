import { blueskyFor } from '../accounts/clients.ts'
import { shownHandle } from '../accounts/handle.ts'
import { needsReconnect } from '../accounts/store.ts'
import { parseAtUri, type BlobRef, type BlueskyClient, type ImageDraft, type NetworkError as BlueskyError, type PostDraft, type StrongRef, type ThreadItem, type ThreadPosted } from '../lib/bluesky/index.ts'
import { postedParts, partKey, recordCall, savePart, textsOf } from './parts.ts'
import type { DueItem, PublishContext, PublishOutcome, Publisher } from './types.ts'

// Bluesky: posts and threads as reply chains on the account's own PDS, with
// mentions, links and tags as facets, images with alt text and link cards. The
// record key comes from the item's key, so a retry after a lost answer reads
// the same record back instead of posting twice (STUMP-PUBLISH-002).

const placeholder = (type: string, size: number): BlobRef => ({ $type: 'blob', ref: { $link: 'bafkreipending' }, mimeType: type, size })

function drafts(item: DueItem, images: ImageDraft[]): Array<Omit<PostDraft, 'reply'>> {
  const link = item.options.link
  return textsOf(item).map((text, index) => ({
    text,
    ...(index === 0 && images.length ? { images } : {}),
    ...(index === 0 && !images.length && link ? { external: { uri: link.url, title: link.title, description: link.description ?? '' } } : {}),
  }))
}

/** The post a reply answers: its strong ref and its thread's root. */
async function replyTarget(client: BlueskyClient, url: string): Promise<{ root: StrongRef; parent: StrongRef } | null> {
  let uri = url
  const web = /^https:\/\/bsky\.app\/profile\/([^/]+)\/post\/([A-Za-z0-9._:~-]+)/.exec(url)
  if (web) {
    let repo = decodeURIComponent(web[1]!)
    if (!repo.startsWith('did:')) {
      const did = await client.resolveHandle(repo)
      if (!did.ok || !did.value) return null
      repo = did.value
    }
    uri = `at://${repo}/app.bsky.feed.post/${web[2]}`
  }
  if (!parseAtUri(uri)) return null
  const post = await client.getPost(uri)
  if (!post.ok) return null
  const parent = { uri: post.value.uri, cid: post.value.cid }
  return { root: post.value.reply?.root ?? parent, parent }
}

const error = (e: BlueskyError) => ({ code: e.code ?? e.kind, message: e.message })

export const blueskyPublisher: Publisher = {
  async check(item, ctx) {
    if (item.format === 'pitch') return [{ code: 'format_unsupported', message: 'A pitch goes to its recipient, not to Bluesky.' }]
    const opened = await blueskyFor(ctx.env, ctx.db, ctx.account, ctx.now)
    if (!opened.ok) return [{ code: 'account_not_ready', message: opened.message }]
    const images = item.media.map(media => ({ blob: placeholder(media.type, media.size), alt: media.alt ?? '' }))
    return drafts(item, images).flatMap((draft, index) => opened.client.check(draft).map(problem => ({ ...problem, path: item.format === 'thread' ? `parts[${index}]` : problem.path })))
  },

  async publish(item, ctx) {
    const opened = await blueskyFor(ctx.env, ctx.db, ctx.account, ctx.now)
    if (!opened.ok) return { state: 'held', kind: 'reconnect', next_attempt_at: null, error: { code: opened.code, message: opened.message } }
    const { client } = opened
    const images: ImageDraft[] = []
    for (const media of item.media) {
      const blob = await client.uploadBlob(media.bytes, media.type)
      await recordCall(ctx, { network: 'bluesky', item_id: item.id, act: 'media_upload' })
      if (!blob.ok) return fault(ctx, blob.error, 0, null)
      images.push({ blob: blob.value, alt: media.alt ?? '' })
    }
    let reply: { root: StrongRef; parent: StrongRef } | null = null
    if (item.reply_to) {
      reply = await replyTarget(client, item.reply_to.url)
      if (!reply) return { state: 'failed', error: { code: 'reply_target_not_found', message: `Bluesky could not find ${item.reply_to.url}.` } }
    }
    const threadItems: ThreadItem[] = drafts(item, images).map((draft, index) => ({
      key: partKey(item, index), atMs: item.scheduled_at + index, draft: index === 0 && reply ? { ...draft, reply } as PostDraft : draft,
    }))
    const prior = await postedParts(ctx, item)
    const done: ThreadPosted[] = prior.map(part => ({ key: partKey(item, part.part), uri: part.network_id, cid: String(part.ref?.cid ?? '') }))
    const outcome = await client.publishThread(threadItems, done)
    for (const [index, posted] of outcome.posted.entries()) {
      if (index < done.length) continue
      await recordCall(ctx, { network: 'bluesky', item_id: item.id, act: 'post' })
      const at = parseAtUri(posted.uri)!
      await savePart(ctx, item, { part: index, network_id: posted.uri, url: `https://bsky.app/profile/${at.repo}/post/${at.rkey}`, ref: { cid: posted.cid }, text: null })
    }
    if (outcome.failure) {
      const first = outcome.posted[0]
      return fault(ctx, outcome.failure.error, outcome.posted.length, first ? { network_id: first.uri, url: (await postedParts(ctx, item))[0]!.url } : null)
    }
    // Posted only once every part reads back from the PDS (D-5).
    const texts: string[] = []
    let firstUrl = ''
    for (const posted of outcome.posted) {
      const back = await client.getPost(posted.uri)
      await recordCall(ctx, { network: 'bluesky', item_id: item.id, act: 'read' })
      if (!back.ok) return { state: 'uncertain', error: { code: 'readback_failed', message: back.error.message } }
      texts.push(back.value.text)
      firstUrl ||= back.value.webUrl
    }
    return { state: 'posted', url: firstUrl, network_id: outcome.posted[0]!.uri, posted_at: ctx.now(), text: texts.join('\n\n') }
  },

  async readBack(url, ctx) {
    const opened = await blueskyFor(ctx.env, ctx.db, ctx.account, ctx.now)
    if (!opened.ok) return { ok: false, message: opened.message }
    const target = await replyTarget(opened.client, url)
    if (!target) return { ok: false, message: `Bluesky could not find ${url}.` }
    const back = await opened.client.getPost(target.parent.uri)
    if (!back.ok) return { ok: false, message: back.error.message }
    if (back.value.repo !== opened.client.auth().did) return { ok: false, message: `${url} is not a post of ${shownHandle(ctx.account)}.` }
    return { ok: true, url: back.value.webUrl, network_id: back.value.uri, text: back.value.text }
  },
}

async function fault(ctx: PublishContext, e: BlueskyError, postedCount: number, first: { url: string; network_id: string } | null): Promise<PublishOutcome> {
  if (e.kind === 'auth_revoked' || e.kind === 'credentials_invalid') {
    await needsReconnect(ctx.db, ctx.env, ctx.account, 'revoked', ctx.now())
    return { state: 'held', kind: 'reconnect', next_attempt_at: null, error: error(e) }
  }
  if (e.kind === 'rate_limited') return { state: 'held', kind: 'rate_limit', next_attempt_at: e.retryAtMs ?? null, error: error(e) }
  // Earlier parts that are up make the item partly posted; resuming writes the rest under the same
  // record keys, so a part that did land is read back, never posted twice (STUMP-PUBLISH-004.4).
  if (postedCount > 0 && first) return { state: 'partly_posted', ...first, posted_parts: postedCount, error: error(e) }
  // The library already looked under the post's record key; an outcome it still cannot tell stays unknown.
  if (e.outcomeUnknown) return { state: 'uncertain', error: error(e) }
  return { state: 'failed', error: error(e) }
}
