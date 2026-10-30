/**
 * Member posts: create (text, article link with preview text, images with alt text),
 * read back by URN, delete, and look up by text.
 *
 * Sources (read 30 Oct 2026):
 *  - https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
 *      POST https://api.linkedin.com/rest/posts with Linkedin-Version (YYYYMM) and
 *      X-Restli-Protocol-Version 2.0.0; body author, commentary, visibility, distribution
 *      {feedDistribution MAIN_FEED, targetEntities [], thirdPartyDistributionChannels []},
 *      lifecycleState PUBLISHED, isReshareDisabledByAuthor; 201 with the post URN in the
 *      x-restli-id header (urn:li:share:... or urn:li:ugcPost:...); article content is
 *      content.article {source, title, description, thumbnail} (the API does not scrape the
 *      URL, so the preview text is sent); GET /rest/posts/{encoded urn}; finder
 *      GET /rest/posts?q=author&author={encoded urn}&count (X-RestLi-Method: FINDER; reading a
 *      member's posts needs r_member_social); DELETE /rest/posts/{encoded urn} with
 *      X-RestLi-Method: DELETE answers 204 and is idempotent.
 *  - https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/post-api-schema
 *      visibility PUBLIC | CONNECTIONS | LOGGED_IN; media {id, title, altText}
 *  - https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/multiimage-post-api
 *      content.multiImage.images[] {id, altText}, 2 to 20 images
 *  - https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api
 *      content.media {id, altText} for one image
 *
 * LinkedIn has no idempotency key. A post that times out or answers 5xx, or answers 201 without
 * its URN, is an unknown outcome. Reading it back needs r_member_social, which Share on LinkedIn
 * does not grant: expect permission_denied, and fall back to the person confirming the link.
 */
import { localLinkedInError } from './errors'
import { linkedInCall } from './http'
import { escapeLinkedInText, checkLinkedInText, LINKEDIN_COMMENTARY_MAX, unescapeLinkedInText } from './text'
import { LINKEDIN_ALT_TEXT_MAX } from './images'
import type { LinkedInContext, LinkedInError, LinkedInOutcome } from './types'

export interface LinkedInArticleInput {
  /** The link. */
  source: string
  /** The preview title (required by LinkedIn). */
  title: string
  /** The preview text under the title. */
  description?: string
  /** An image URN from uploadLinkedInImage for the preview picture. */
  thumbnailUrn?: string
}

export interface LinkedInImageRef {
  urn: string
  altText?: string
}

export interface LinkedInPostInput {
  /** urn:li:person:{sub} for a member profile. */
  authorUrn: string
  /** The person's text, before escaping. */
  text: string
  article?: LinkedInArticleInput
  /** One image, or 2 to 20 as a multi-image post. Not with an article. */
  images?: LinkedInImageRef[]
  visibility?: 'PUBLIC' | 'CONNECTIONS' | 'LOGGED_IN'
  /** Keep a `#word` as a hashtag (default true). */
  hashtags?: boolean
  /** Text is already in `little` format (mentions built with linkedInMention); skip escaping. */
  littleText?: boolean
  /** Override the text limit from the network table. */
  textLimit?: number
}

const URN_AUTHOR = /^urn:li:(person|organization):[A-Za-z0-9_-]+$/
const URN_POST = /^urn:li:(share|ugcPost):[A-Za-z0-9_-]+$/

export function linkedInPostUrl(urn: string): string {
  return `https://www.linkedin.com/feed/update/${urn}/`
}

/** Checks a post before anything is sent or scheduled. Returns null when it is fine. */
export function validateLinkedInPost(input: LinkedInPostInput): LinkedInError | null {
  if (!URN_AUTHOR.test(input.authorUrn)) return localLinkedInError('bad_urn', 'The author must be a LinkedIn person or organization URN.')
  const hasContent = !!input.article || (input.images?.length ?? 0) > 0
  if (input.text.trim() === '' && !hasContent) return localLinkedInError('empty', 'A post needs text, a link or an image.')
  const len = checkLinkedInText(input.text, input.textLimit ?? LINKEDIN_COMMENTARY_MAX)
  if (!len.valid) return localLinkedInError('too_long', `The post is ${len.length} characters against LinkedIn's limit of ${len.limit} (${len.over} over).`)
  if (input.article && (input.images?.length ?? 0) > 0) return localLinkedInError('article_with_images', 'A post carries either an article link or images, not both.')
  if (input.article) {
    try {
      const u = new URL(input.article.source)
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('scheme')
    } catch {
      return localLinkedInError('bad_link', 'The article link must be an http or https address.')
    }
    if (input.article.title.trim() === '') return localLinkedInError('article_title', 'A link post needs a preview title.')
    if (input.article.thumbnailUrn && !/^urn:li:image:[A-Za-z0-9_-]+$/.test(input.article.thumbnailUrn)) return localLinkedInError('bad_urn', 'The thumbnail must be a LinkedIn image URN.')
  }
  const images = input.images ?? []
  if (images.length > 20) return localLinkedInError('too_many_images', 'LinkedIn allows up to 20 images on one post.')
  for (const img of images) {
    if (!/^urn:li:image:[A-Za-z0-9_-]+$/.test(img.urn)) return localLinkedInError('bad_urn', 'Each image must be a LinkedIn image URN.')
    if (img.altText !== undefined && img.altText.length > LINKEDIN_ALT_TEXT_MAX) return localLinkedInError('alt_too_long', `Alt text is over LinkedIn's ${LINKEDIN_ALT_TEXT_MAX}-character limit.`)
  }
  return null
}

/** The `commentary` string sent to LinkedIn for this input. */
export function linkedInCommentary(input: Pick<LinkedInPostInput, 'text' | 'hashtags' | 'littleText'>): string {
  return input.littleText ? input.text : escapeLinkedInText(input.text, { hashtags: input.hashtags })
}

function postBody(input: LinkedInPostInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    author: input.authorUrn,
    commentary: linkedInCommentary(input),
    visibility: input.visibility ?? 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  }
  if (input.article) {
    const a: Record<string, string> = { source: input.article.source, title: input.article.title }
    if (input.article.description) a.description = input.article.description
    if (input.article.thumbnailUrn) a.thumbnail = input.article.thumbnailUrn
    body.content = { article: a }
  } else if (input.images && input.images.length === 1) {
    const [img] = input.images
    body.content = { media: { id: img.urn, ...(img.altText ? { altText: img.altText } : {}) } }
  } else if (input.images && input.images.length >= 2) {
    body.content = { multiImage: { images: input.images.map((i) => ({ id: i.urn, ...(i.altText ? { altText: i.altText } : {}) })) } }
  }
  return body
}

export interface LinkedInPostRef {
  urn: string
  url: string
  /** The commentary exactly as sent. */
  commentary: string
}

/** POST /rest/posts. */
export async function createLinkedInPost(ctx: LinkedInContext, input: LinkedInPostInput): Promise<LinkedInOutcome<LinkedInPostRef>> {
  const bad = validateLinkedInPost(input)
  if (bad) return { ok: false, error: bad }
  const body = postBody(input)
  return linkedInCall<LinkedInPostRef>(ctx, {
    method: 'POST',
    visible: true,
    path: '/rest/posts',
    json: body,
    okStatuses: [201],
    parse: (_b, status, headers) => {
      const urn = headers.get('x-restli-id')
      if (!urn || !URN_POST.test(urn)) {
        return {
          kind: 'unknown_outcome', status, message: 'LinkedIn accepted the post but sent no post URN.', providerCode: null,
          serviceErrorCode: null, code: 'no_post_urn', limitScope: null, resetAt: null, retry: 'read_back_first', mayHaveApplied: true,
        }
      }
      return { urn, url: linkedInPostUrl(urn), commentary: body.commentary as string }
    },
  })
}

export interface LinkedInPostReadback {
  urn: string
  url: string
  authorUrn: string | null
  /** The commentary as stored (`little` format). */
  commentary: string
  /** The commentary as plain text. */
  text: string
  lifecycleState: string | null
  visibility: string | null
  publishedAt: string | null
  article: { source: string; title: string | null; description: string | null; thumbnailUrn: string | null } | null
  images: { urn: string; altText: string | null }[]
}

function iso(ms: unknown): string | null {
  return typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

function parseReadback(b: any): LinkedInPostReadback {
  const content = b?.content ?? {}
  const media = content.media
  const multi = content.multiImage?.images
  const images: { urn: string; altText: string | null }[] = []
  if (media && typeof media.id === 'string' && media.id.startsWith('urn:li:image:')) images.push({ urn: media.id, altText: typeof media.altText === 'string' ? media.altText : null })
  if (Array.isArray(multi)) for (const i of multi) if (typeof i?.id === 'string') images.push({ urn: i.id, altText: typeof i.altText === 'string' ? i.altText : null })
  const art = content.article
  const commentary = typeof b?.commentary === 'string' ? b.commentary : ''
  const urn = String(b?.id ?? '')
  return {
    urn,
    url: linkedInPostUrl(urn),
    authorUrn: typeof b?.author === 'string' ? b.author : null,
    commentary,
    text: unescapeLinkedInText(commentary),
    lifecycleState: typeof b?.lifecycleState === 'string' ? b.lifecycleState : null,
    visibility: typeof b?.visibility === 'string' ? b.visibility : null,
    publishedAt: iso(b?.publishedAt),
    article: art && typeof art.source === 'string'
      ? { source: art.source, title: typeof art.title === 'string' ? art.title : null, description: typeof art.description === 'string' ? art.description : null, thumbnailUrn: typeof art.thumbnail === 'string' ? art.thumbnail : null }
      : null,
    images,
  }
}

/**
 * GET /rest/posts/{urn}: the post as LinkedIn holds it, with each image's alt text. A token
 * with only w_member_social is refused (permission_denied); the caller then keeps the post as
 * posted on LinkedIn's 201 answer and asks the person to confirm the link.
 */
export function getLinkedInPost(ctx: LinkedInContext, urn: string): Promise<LinkedInOutcome<LinkedInPostReadback>> {
  if (!URN_POST.test(urn)) return Promise.resolve({ ok: false, error: localLinkedInError('bad_urn', 'A post URN looks like urn:li:share:123 or urn:li:ugcPost:123.') })
  return linkedInCall<LinkedInPostReadback>(ctx, {
    method: 'GET',
    visible: false,
    path: `/rest/posts/${encodeURIComponent(urn)}`,
    parse: (b, status) => {
      if (!b || typeof b.id !== 'string') {
        return { kind: 'server_error', status, message: 'LinkedIn answered the read without a post.', providerCode: null, serviceErrorCode: null, code: 'no_post', limitScope: null, resetAt: null, retry: 'safe', mayHaveApplied: false }
      }
      return parseReadback(b)
    },
  })
}

/** DELETE /rest/posts/{urn}. LinkedIn answers 204 even when the post is already gone. */
export function deleteLinkedInPost(ctx: LinkedInContext, urn: string): Promise<LinkedInOutcome<{ deleted: true }>> {
  if (!URN_POST.test(urn)) return Promise.resolve({ ok: false, error: localLinkedInError('bad_urn', 'A post URN looks like urn:li:share:123 or urn:li:ugcPost:123.') })
  return linkedInCall<{ deleted: true }>(ctx, {
    method: 'DELETE',
    visible: true,
    path: `/rest/posts/${encodeURIComponent(urn)}`,
    headers: { 'x-restli-method': 'DELETE' },
    okStatuses: [204, 200],
    parse: () => ({ deleted: true as const }),
  })
}

/**
 * Looks for the member's own recent post with this exact commentary (finder by author), for the
 * read-back after a lost answer. Needs r_member_social: without it expect permission_denied and
 * treat the item as uncertain until the person confirms.
 */
export function findOwnLinkedInPostByText(
  ctx: LinkedInContext,
  input: { authorUrn: string; text: string; hashtags?: boolean; littleText?: boolean; count?: number },
): Promise<LinkedInOutcome<{ match: LinkedInPostReadback | null; scanned: number }>> {
  if (!URN_AUTHOR.test(input.authorUrn)) return Promise.resolve({ ok: false, error: localLinkedInError('bad_urn', 'The author must be a LinkedIn person or organization URN.') })
  const want = linkedInCommentary(input).normalize('NFC').trim()
  return linkedInCall(ctx, {
    method: 'GET',
    visible: false,
    path: '/rest/posts',
    query: { author: input.authorUrn, q: 'author', count: Math.min(100, Math.max(1, input.count ?? 10)), sortBy: 'CREATED' },
    headers: { 'x-restli-method': 'FINDER' },
    parse: (b) => {
      const rows: any[] = Array.isArray(b?.elements) ? b.elements : []
      const posts = rows.filter((r) => typeof r?.id === 'string').map(parseReadback)
      return { match: posts.find((p) => p.commentary.normalize('NFC').trim() === want) ?? null, scanned: posts.length }
    },
  })
}
