import { mastodonFor } from '../accounts/clients.ts'
import { needsReconnect } from '../accounts/store.ts'
import type { MastodonClient, NetworkError as MastodonError, StatusDraft, ThreadItem, ThreadPosted, Visibility } from '../lib/mastodon/index.ts'
import { stumpFetch } from '../net/fetch.ts'
import { partKey, postedParts, recordCall, savePart, textsOf } from './parts.ts'
import type { DueItem, Problem, PublishContext, PublishOutcome, Publisher } from './types.ts'

// Mastodon: statuses on the account's own instance at that instance's limits,
// with content warnings, visibility, polls, media with alt text and threads
// as reply chains, each sent with an Idempotency-Key (STUMP-PUBLISH-003).

const visibility = (item: DueItem): Visibility | undefined => {
  const value = item.options.visibility
  return value === 'followers' ? 'private' : value
}

function drafts(item: DueItem): Array<Omit<StatusDraft, 'inReplyToId'>> {
  const poll = item.options.poll
  return textsOf(item).map((text, index) => ({
    text,
    ...(index === 0 && item.options.content_warning ? { spoilerText: item.options.content_warning } : {}),
    ...(visibility(item) ? { visibility: visibility(item) } : {}),
    ...(index === 0 && poll ? { poll: { options: poll.options, expiresInSeconds: poll.expires_in ?? (poll.duration_minutes ?? 1440) * 60, ...(poll.multiple ? { multiple: true } : {}) } } : {}),
    ...(index === 0 && item.media.length ? { mediaIds: item.media.map(media => media.id), mediaDescriptions: item.media.map(media => media.alt) } : {}),
  }))
}

/** The status a reply answers: on this instance by its id, elsewhere through the instance's search. */
async function replyTarget(ctx: PublishContext, client: MastodonClient, token: string, url: string): Promise<string | null> {
  const target = new URL(url)
  if (target.origin === client.origin) return /(\d+)\/?$/.exec(target.pathname)?.[1] ?? null
  const query = new URLSearchParams({ q: url, resolve: 'true', type: 'statuses', limit: '1' })
  const response = await stumpFetch(ctx.env)(`${client.origin}/api/v2/search?${query}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } })
  if (!response.ok) return null
  const found = await response.json() as { statuses?: Array<{ id?: string }> }
  return found.statuses?.[0]?.id ?? null
}

const error = (e: MastodonError) => ({ code: e.code ?? e.kind, message: e.message })

export const mastodonPublisher: Publisher = {
  async check(item, ctx) {
    if (item.format === 'pitch') return [{ code: 'format_unsupported', message: 'A pitch goes to its recipient, not to Mastodon.' }]
    const opened = await mastodonFor(ctx.env, ctx.account)
    if (!opened.ok) return [{ code: 'account_not_ready', message: opened.message }]
    const problems: Problem[] = []
    for (const [index, draft] of drafts(item).entries()) {
      const checked = await opened.client.check(draft)
      if (!checked.ok) problems.push(...(checked.error.problems ?? [error(checked.error)]).map(problem => ({ ...problem, ...(item.format === 'thread' ? { path: `parts[${index}]` } : {}) })))
    }
    return problems
  },

  async publish(item, ctx) {
    const opened = await mastodonFor(ctx.env, ctx.account)
    if (!opened.ok) return { state: 'held', kind: 'reconnect', next_attempt_at: null, error: { code: opened.code, message: opened.message } }
    const { client } = opened, token = opened.credentials.network === 'mastodon' ? opened.credentials.access_token : ''
    const account = await client.account()
    if (!account.ok) return fault(ctx, account.error, 0)
    const sent = drafts(item)
    if (item.media.length) {
      const ids: string[] = []
      for (const media of item.media) {
        const uploaded = await client.uploadMedia({ bytes: media.bytes, mimeType: media.type, filename: media.name, ...(media.alt ? { description: media.alt } : {}) })
        await recordCall(ctx, { network: 'mastodon', item_id: item.id, act: 'media_upload' })
        if (!uploaded.ok) return fault(ctx, uploaded.error, 0)
        ids.push(uploaded.value.id)
      }
      sent[0] = { ...sent[0]!, mediaIds: ids, mediaDescriptions: item.media.map(media => media.alt) }
    }
    let parent: string | null = null
    if (item.reply_to) {
      parent = await replyTarget(ctx, client, token, item.reply_to.url)
      if (!parent) return { state: 'failed', error: { code: 'reply_target_not_found', message: `${client.origin} could not find ${item.reply_to.url}.` } }
    }
    const threadItems: ThreadItem[] = sent.map((draft, index) => ({ key: partKey(item, index), draft: index === 0 && parent ? { ...draft, inReplyToId: parent } as StatusDraft : draft }))
    const prior = await postedParts(ctx, item)
    let done: ThreadPosted[] = prior.map(part => ({ key: partKey(item, part.part), status: { id: part.network_id, url: part.url, uri: String(part.ref?.uri ?? part.url) } }))
    for (;;) {
      const outcome = await client.publishThread(threadItems, done)
      for (const posted of outcome.posted.slice(done.length)) {
        await recordCall(ctx, { network: 'mastodon', item_id: item.id, act: 'post' })
        await savePart(ctx, item, { part: outcome.posted.indexOf(posted), network_id: posted.status.id, url: posted.status.url, ref: { uri: posted.status.uri }, text: null })
      }
      done = outcome.posted
      if (!outcome.failure) break
      const failure = outcome.failure
      if (failure.error.outcomeUnknown) {
        // The answer was lost: look for the status by its exact text before deciding anything (D-5).
        const draft = sent[failure.index]!, inReplyTo = failure.index === 0 ? parent : done[failure.index - 1]?.status.id ?? null
        const found = await client.findPostedStatus({ accountId: account.value.id, text: draft.text, spoilerText: draft.spoilerText ?? '', inReplyToId: inReplyTo, sinceMs: item.scheduled_at - 60_000 })
        if (found.ok && found.value) {
          await savePart(ctx, item, { part: failure.index, network_id: found.value.id, url: found.value.url, ref: { uri: found.value.uri }, text: null })
          done = [...done, { key: failure.key, status: found.value }]
          continue
        }
        return { state: 'uncertain', error: error(failure.error) }
      }
      return fault(ctx, failure.error, done.length, done[0] ? { url: done[0].status.url, network_id: done[0].status.id } : null)
    }
    // Posted only once every part reads back from the instance with its own id and URL.
    const texts: string[] = []
    for (const posted of done) {
      const back = await client.readBack(posted.status.id)
      await recordCall(ctx, { network: 'mastodon', item_id: item.id, act: 'read' })
      if (!back.ok) return { state: 'uncertain', error: { code: 'readback_failed', message: back.error.message } }
      texts.push(back.value.sourceText ?? back.value.plainText)
    }
    const first = done[0]!
    return { state: 'posted', url: first.status.url, network_id: first.status.id, posted_at: ctx.now(), text: texts.join('\n\n') }
  },

  readBack: (url, ctx) => mastodonReadBack(url, ctx),
}

export async function mastodonReadBack(url: string, ctx: PublishContext) {
  const opened = await mastodonFor(ctx.env, ctx.account)
  if (!opened.ok) return { ok: false as const, message: opened.message }
  const token = opened.credentials.network === 'mastodon' ? opened.credentials.access_token : ''
  const id = await replyTarget(ctx, opened.client, token, url)
  if (!id) return { ok: false as const, message: `${opened.client.origin} could not find ${url}.` }
  const back = await opened.client.readBack(id)
  if (!back.ok) return { ok: false as const, message: back.error.message }
  if (back.value.accountId && opened.credentials.network === 'mastodon') {
    const me = await opened.client.account()
    if (me.ok && me.value.id !== back.value.accountId) return { ok: false as const, message: `${url} is not a post of ${ctx.account.handle}.` }
  }
  return { ok: true as const, url: back.value.url, network_id: back.value.id, text: back.value.sourceText ?? back.value.plainText }
}

async function fault(ctx: PublishContext, e: MastodonError, postedCount: number, first: { url: string; network_id: string } | null = null): Promise<PublishOutcome> {
  if (e.kind === 'auth_revoked' || e.kind === 'client_invalid') {
    await needsReconnect(ctx.db, ctx.env, ctx.account, 'revoked', ctx.now())
    return { state: 'held', kind: 'reconnect', next_attempt_at: null, error: error(e) }
  }
  if (e.kind === 'rate_limited') return { state: 'held', kind: 'rate_limit', next_attempt_at: e.retryAtMs ?? null, error: error(e) }
  if (e.outcomeUnknown) return { state: 'uncertain', error: error(e) }
  if (postedCount > 0 && first) return { state: 'partly_posted', ...first, posted_parts: postedCount, error: error(e) }
  return { state: 'failed', error: error(e) }
}
