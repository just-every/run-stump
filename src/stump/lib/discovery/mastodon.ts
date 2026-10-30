/**
 * Mastodon hashtag timelines on a named instance. STUMP-WATCH-003.2, .4, .5; STUMP-WATCH-013.1, .6.
 *
 * `GET /api/v1/timelines/tag/:hashtag`: https://docs.joinmastodon.org/methods/timelines/#tag
 * Parameters used: `local`, `max_id`, `min_id`, `limit` (default 20, at most 40). Response: an array of
 * Status (https://docs.joinmastodon.org/entities/Status/): `id`, `uri`, `url`, `created_at`, `content`
 * (HTML), `spoiler_text`, `visibility`, `language`, `reblog`, `replies_count`, `reblogs_count`,
 * `favourites_count`, `account{acct, username, url, followers_count}`, `tags[]`, `card`.
 * Instances may require sign-in for hashtag timelines (`configuration.timelines_access.hashtag_feeds`,
 * https://docs.joinmastodon.org/entities/Instance/): that answers 401 and is reported as
 * `auth_required`. Rate limits (HTTP 429, `X-RateLimit-Reset` ISO 8601):
 * https://docs.joinmastodon.org/api/rate-limits/ .
 *
 * Paging: with a stored cursor the library pages forward with `min_id`, so nothing between two polls is
 * skipped; without one it takes the newest page, or walks back with `max_id` to a `since` time (backfill).
 * Mastodon ids are numeric strings, compared as integers.
 */
import { SourceError } from './errors.ts'
import { assertOk, readJson, send } from './http.ts'
import { compileTerms, matchTerms, type CompiledTerms, type TermLogic } from './terms.ts'
import { excerptTitle, extractLinks, htmlToText, truncateGraphemes } from './text.ts'
import { parseHttpUrl } from './url.ts'
import type { CommonOptions, Finding } from './types.ts'

const PAGE = 40
export const MASTODON_BACKFILL_REQUESTS = 25

export interface MastodonTagOptions extends CommonOptions {
  /** Host name (`mastodon.social`) or origin (`https://mastodon.social`). http is accepted for loopback hosts only. */
  instance: string
  hashtags: string[]
  /** Optional text filter on top of the hashtag. Empty means every post with the tag. */
  terms?: TermLogic | CompiledTerms
  /** Highest status id already seen, per hashtag (lower-case, no `#`). */
  cursors?: Record<string, string>
  /** For a first poll or a backfill: walk back to this time. ISO 8601 or epoch milliseconds. */
  since?: string | number
  /** Only the instance's own posts (`local=true`). */
  local_only?: boolean
  authorization?: string
  /** Requests per hashtag. Default 3; a backfill passes `MASTODON_BACKFILL_REQUESTS`. */
  max_requests?: number
}

export interface MastodonResult {
  findings: Finding[]
  /** Highest id seen per hashtag, to store and pass as `cursors` next time. */
  cursors: Record<string, string>
  requests: number
  candidates: number
  rejected_by_terms: number
  skipped_items: number
  truncated: boolean
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

export function compareIds(a: string, b: string): number {
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    const x = BigInt(a)
    const y = BigInt(b)
    return x < y ? -1 : x > y ? 1 : 0
  }
  return a.length !== b.length ? a.length - b.length : a < b ? -1 : a > b ? 1 : 0
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/** Origin of an instance from a host name or URL. */
export function instanceOrigin(instance: string): { origin: string; host: string } {
  const raw = instance.trim()
  const u = parseHttpUrl(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  if (!u || u.username || u.password) throw new SourceError('invalid_request', 'mastodon', `"${instance}" is not a Mastodon instance address`)
  if (u.protocol === 'http:' && !LOOPBACK.has(u.hostname)) {
    throw new SourceError('invalid_request', 'mastodon', 'A Mastodon instance must be reached over https')
  }
  return { origin: u.origin, host: u.host.toLowerCase() }
}

export function normalizeHashtag(tag: string): string {
  const t = tag.trim().replace(/^#/, '').toLowerCase()
  if (!/^[\p{L}\p{N}_]{1,100}$/u.test(t)) throw new SourceError('invalid_request', 'mastodon', `"${tag}" is not a valid hashtag`)
  return t
}

export function mastodonStatusToFinding(raw: unknown, instanceHost: string): Finding | null {
  const s = obj(raw)
  const id = str(s.id)
  const created = Date.parse(str(s.created_at))
  const account = obj(s.account)
  const url = parseHttpUrl(str(s.url) || str(s.uri))?.href
  if (!id || !Number.isFinite(created) || !url) return null
  if (s.reblog) return null
  const visibility = str(s.visibility)
  if (visibility && visibility !== 'public') return null
  const acct = str(account.acct)
  if (!acct) return null
  const author = (acct.includes('@') ? acct : `${acct}@${instanceHost}`).toLowerCase()
  const html = str(s.content)
  const text = truncateGraphemes(htmlToText(html), 20_000)
  const cw = htmlToText(str(s.spoiler_text))
  const card = obj(s.card)
  const links = [...extractLinks(html)]
  if (/^https?:\/\//i.test(str(card.url)) && !links.includes(str(card.url))) links.push(str(card.url))
  const tags = (Array.isArray(s.tags) ? s.tags : []).map((t) => str(obj(t).name).toLowerCase()).filter(Boolean)
  const f: Finding = {
    source: 'mastodon',
    url,
    title: cw || excerptTitle(text),
    text,
    author,
    points: num(s.favourites_count),
    published_at: new Date(created).toISOString(),
    source_id: `mastodon:${instanceHost}:${id}`,
    source_ref: instanceHost,
    kind: 'post',
    links,
    counts: { replies: num(s.replies_count), reblogs: num(s.reblogs_count), favourites: num(s.favourites_count) },
    hashtags: tags,
  }
  if (str(account.url)) f.author_id = str(account.url)
  if (typeof account.followers_count === 'number') f.author_followers = account.followers_count
  if (str(s.language)) f.language = str(s.language)
  return f
}

export async function pollMastodonTags(options: MastodonTagOptions): Promise<MastodonResult> {
  const terms = compileTerms(options.terms ?? {})
  const { origin, host } = instanceOrigin(options.instance)
  const tags = [...new Set(options.hashtags.map(normalizeHashtag))]
  if (tags.length === 0) throw new SourceError('invalid_request', 'mastodon', 'A Mastodon watch needs at least one hashtag')
  const now = options.now ?? Date.now
  const maxRequests = Math.max(1, options.max_requests ?? 3)
  const sinceMs = options.since === undefined ? undefined : typeof options.since === 'number' ? options.since : Date.parse(options.since)
  if (sinceMs !== undefined && !Number.isFinite(sinceMs)) throw new SourceError('invalid_request', 'mastodon', 'The Mastodon since time is not a valid time')
  const headers: Record<string, string> = { accept: 'application/json' }
  if (options.authorization) headers.authorization = options.authorization
  const seen = new Set<string>()
  const result: MastodonResult = {
    findings: [], cursors: { ...(options.cursors ?? {}) }, requests: 0, candidates: 0, rejected_by_terms: 0,
    skipped_items: 0, truncated: false,
  }

  for (const tag of tags) {
    const stored = options.cursors?.[tag]
    let forwardCursor = stored
    let backCursor: string | undefined
    let highest = stored
    for (let i = 0; i < maxRequests; i++) {
      const params = new URLSearchParams({ limit: String(PAGE) })
      if (options.local_only) params.set('local', 'true')
      if (forwardCursor) params.set('min_id', forwardCursor)
      else if (backCursor) params.set('max_id', backCursor)
      const url = `${origin}/api/v1/timelines/tag/${encodeURIComponent(tag)}?${params.toString()}`
      const response = await send('mastodon', options, url, { headers })
      result.requests += 1
      try {
        assertOk('mastodon', response, url, now())
      } catch (e) {
        if (e instanceof SourceError && e.kind === 'auth_required') {
          throw new SourceError('auth_required', 'mastodon', `${host} requires sign-in to read hashtag timelines`, { status: e.status })
        }
        throw e
      }
      const page = await readJson('mastodon', response, url)
      if (!Array.isArray(page)) throw new SourceError('bad_response', 'mastodon', `${host} answered the hashtag timeline without a list`)
      let oldestId: string | undefined
      let oldestMs = Number.POSITIVE_INFINITY
      for (const raw of page) {
        const id = str(obj(raw).id)
        if (id) {
          if (!highest || compareIds(id, highest) > 0) highest = id
          if (!oldestId || compareIds(id, oldestId) < 0) oldestId = id
          oldestMs = Math.min(oldestMs, Date.parse(str(obj(raw).created_at)))
        }
        const finding = mastodonStatusToFinding(raw, host)
        if (!finding) {
          result.skipped_items += 1
          continue
        }
        if (seen.has(finding.source_id)) continue
        seen.add(finding.source_id)
        result.candidates += 1
        if (sinceMs !== undefined && Date.parse(finding.published_at) < sinceMs) continue
        const m = matchTerms(terms, { title: finding.title, text: finding.text, links: finding.links.join('\n') })
        if (!m.matches) {
          result.rejected_by_terms += 1
          continue
        }
        result.findings.push(finding)
      }
      if (page.length < PAGE) break
      if (forwardCursor) {
        forwardCursor = highest
      } else {
        // First poll: only a backfill (a `since` time) walks further back.
        if (sinceMs === undefined || !oldestId || oldestMs <= sinceMs) break
        backCursor = oldestId
      }
      if (i === maxRequests - 1) result.truncated = true
    }
    if (highest) result.cursors[tag] = highest
  }
  result.findings.sort((a, b) => (a.published_at < b.published_at ? 1 : -1))
  return result
}

/** A new watch's backfill from an instance's hashtag timelines (STUMP-WATCH-013.5, .6): 30 days where the instance keeps them. */
export function backfillMastodonTags(options: Omit<MastodonTagOptions, 'since' | 'cursors'> & { days?: number }): Promise<MastodonResult> {
  const now = options.now ?? Date.now
  return pollMastodonTags({
    ...options,
    since: now() - (options.days ?? 30) * 86_400_000,
    max_requests: options.max_requests ?? MASTODON_BACKFILL_REQUESTS,
  })
}
