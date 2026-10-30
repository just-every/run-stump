/**
 * Turns X post objects into the plain records Stump stores.
 *
 * Sources (read 30 Oct 2026):
 *  - https://docs.x.com/x-api/posts/get-post-by-id (fields, expansions, includes.media with
 *    alt_text, includes.polls, referenced posts as `referenced_posts`; older docs say
 *    `referenced_tweets`, so both are read)
 *  - https://docs.x.com/x-api/posts/creation-of-a-post (`edit_history_post_ids`)
 *
 * X returns `&amp;`, `&lt;` and `&gt;` HTML-escaped inside post text. Stump keeps plain
 * text and escapes only when it draws, so the three entities are undone here and
 * t.co links are replaced by the address they stand for.
 */
import type { XContext } from './types'

export interface XMediaReadback {
  mediaKey: string
  type: string
  altText: string | null
  url: string | null
}

export interface XPollReadback {
  id: string
  options: { position: number; label: string; votes: number | null }[]
  durationMinutes: number | null
  endsAt: string | null
  votingStatus: string | null
}

export interface XPostReadback {
  id: string
  url: string
  /** Plain text: unescaped, long posts in full, t.co links expanded. */
  text: string
  authorId: string | null
  authorUsername: string | null
  /** The author's follower count, where X expanded the author with public_metrics. */
  authorFollowers: number | null
  createdAt: string | null
  conversationId: string | null
  inReplyToUserId: string | null
  inReplyToPostId: string | null
  referenced: { id: string; type: string }[]
  media: XMediaReadback[]
  poll: XPollReadback | null
  metrics: Record<string, number> | null
}

export function unescapeXText(text: string): string {
  return text.replace(/&(amp|lt|gt);/g, (_, n: string) => (n === 'amp' ? '&' : n === 'lt' ? '<' : '>'))
}

/** Comparison form of a post's text: NFC, LF line ends, trimmed. */
export function normalizeXText(text: string): string {
  return text.normalize('NFC').replace(/\r\n?/g, '\n').trim()
}

export function xPostUrl(id: string, username?: string | null): string {
  return `https://x.com/${username || 'i'}/status/${id}`
}

/** The comma list of post fields every read-back asks for. */
export function postFieldList(ctx: XContext): string {
  const ref = ctx.fieldsStyle === 'tweet' ? 'referenced_tweets' : 'referenced_posts'
  return ['created_at', 'author_id', 'conversation_id', 'in_reply_to_user_id', ref, 'attachments', 'entities', 'public_metrics', 'note_tweet'].join(',')
}

export function plainPostText(p: any): string {
  const raw: string = typeof p?.note_tweet?.text === 'string' ? p.note_tweet.text : typeof p?.text === 'string' ? p.text : ''
  const entities = typeof p?.note_tweet?.text === 'string' ? p.note_tweet.entities : p?.entities
  let text = unescapeXText(raw)
  for (const u of entities?.urls ?? []) {
    if (typeof u?.url !== 'string') continue
    const display = typeof u.display_url === 'string' ? u.display_url : ''
    const replacement = /^pic\.(x|twitter)\.com\//.test(display) ? '' : typeof u.expanded_url === 'string' ? u.expanded_url : u.url
    text = text.split(u.url).join(replacement)
  }
  return text.trim()
}

export function parsePost(p: any, includes: any, ctx: XContext): XPostReadback {
  const id = String(p.id)
  const author = (includes?.users ?? []).find((u: any) => u?.id === p.author_id)
  const keys: string[] = p?.attachments?.media_keys ?? []
  const pollIds: string[] = p?.attachments?.poll_ids ?? []
  const media: XMediaReadback[] = (includes?.media ?? [])
    .filter((m: any) => keys.includes(m?.media_key))
    .map((m: any) => ({
      mediaKey: String(m.media_key),
      type: String(m.type ?? ''),
      altText: typeof m.alt_text === 'string' ? m.alt_text : null,
      url: typeof m.url === 'string' ? m.url : null,
    }))
  const rawPoll = (includes?.polls ?? []).find((q: any) => pollIds.includes(q?.id))
  const poll: XPollReadback | null = rawPoll
    ? {
        id: String(rawPoll.id),
        options: (rawPoll.options ?? []).map((o: any) => ({ position: Number(o.position), label: String(o.label), votes: typeof o.votes === 'number' ? o.votes : null })),
        durationMinutes: typeof rawPoll.duration_minutes === 'number' ? rawPoll.duration_minutes : null,
        endsAt: typeof rawPoll.end_datetime === 'string' ? rawPoll.end_datetime : null,
        votingStatus: typeof rawPoll.voting_status === 'string' ? rawPoll.voting_status : null,
      }
    : null
  const referenced: { id: string; type: string }[] = (p.referenced_posts ?? p.referenced_tweets ?? []).map((r: any) => ({ id: String(r.id), type: String(r.type) }))
  const username = typeof author?.username === 'string' ? author.username : ctx.username ?? null
  return {
    id,
    url: xPostUrl(id, username),
    text: plainPostText(p),
    authorId: typeof p.author_id === 'string' ? p.author_id : null,
    authorUsername: typeof author?.username === 'string' ? author.username : null,
    authorFollowers: typeof author?.public_metrics?.followers_count === 'number' ? author.public_metrics.followers_count : null,
    createdAt: typeof p.created_at === 'string' ? p.created_at : null,
    conversationId: typeof p.conversation_id === 'string' ? p.conversation_id : null,
    inReplyToUserId: typeof p.in_reply_to_user_id === 'string' ? p.in_reply_to_user_id : null,
    inReplyToPostId: referenced.find((r) => r.type === 'replied_to')?.id ?? null,
    referenced,
    media,
    poll,
    metrics: p.public_metrics && typeof p.public_metrics === 'object' ? (p.public_metrics as Record<string, number>) : null,
  }
}
