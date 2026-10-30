/**
 * Bluesky post search. STUMP-WATCH-003.1, .4, .5.
 *
 * `app.bsky.feed.searchPosts`: https://docs.bsky.app/docs/api/app-bsky-feed-search-posts
 * (lexicon: https://github.com/bluesky-social/atproto/tree/main/lexicons/app/bsky/feed).
 * Parameters used: `q`, `sort` (`latest`), `since` (datetime, inclusive), `until`, `lang`, `limit`
 * (1 to 100), `cursor`. Response: `posts[]` (postView: `uri`, `cid`, `author{did, handle, displayName}`,
 * `record{text, createdAt, langs, facets, embed, reply}`, `replyCount`, `repostCount`, `likeCount`,
 * `quoteCount`, `indexedAt`), `cursor`, `hitsTotal`.
 * Rate limits answer HTTP 429 with RateLimit headers: https://docs.bsky.app/docs/advanced-guides/rate-limits
 * (the library reads `Retry-After` and `RateLimit-Reset`).
 *
 * Host: checked on 30 Oct 2026, `https://api.bsky.app` answers searchPosts without sign-in;
 * `https://public.api.bsky.app` answered 403 to a plain client and `https://bsky.social` answers 401.
 * The base URL and an optional Authorization header are options so the spine can use a signed-in
 * request where the host needs one.
 *
 * Search is fuzzy, so every candidate is re-checked against the watch's term logic.
 */
import { SourceError } from './errors.ts'
import { assertOk, readJson, send } from './http.ts'
import { compileTerms, hasPositiveTerms, matchTerms, remoteQueries, type CompiledTerms, type TermLogic } from './terms.ts'
import { excerptTitle, stripControls, tidy } from './text.ts'
import type { CommonOptions, Finding } from './types.ts'

const DEFAULT_BASE = 'https://api.bsky.app'
const PAGE = 100

export interface BlueskySearchOptions extends CommonOptions {
  terms: TermLogic | CompiledTerms
  base_url?: string
  /** Full header value, e.g. `Bearer <access token>`. Never logged or returned. */
  authorization?: string
  /** ISO 8601 datetime or epoch milliseconds; inclusive. */
  since?: string | number
  until?: string | number
  lang?: string
  /** Requests per query string. Default 3. */
  max_requests?: number
}

export interface BlueskyResult {
  findings: Finding[]
  requests: number
  candidates: number
  rejected_by_terms: number
  skipped_items: number
  /** Newest `indexedAt` seen (ISO), for the next poll's `since`. */
  newest_indexed_at: string | null
  truncated: boolean
  queries: string[]
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

function toIso(v: string | number | undefined): string | undefined {
  if (v === undefined) return undefined
  const t = typeof v === 'number' ? v : Date.parse(v)
  if (!Number.isFinite(t)) throw new SourceError('invalid_request', 'bluesky', 'A Bluesky time bound is not a valid time')
  return new Date(t).toISOString()
}

function embedExternal(embed: Record<string, unknown>): Record<string, unknown> | null {
  if (embed.external && typeof embed.external === 'object') return embed.external as Record<string, unknown>
  const media = obj(embed.media)
  if (media.external && typeof media.external === 'object') return media.external as Record<string, unknown>
  return null
}

export function bskyPostUrl(handleOrDid: string, rkey: string): string {
  return `https://bsky.app/profile/${handleOrDid}/post/${rkey}`
}

/** Map a postView to a finding; null when it lacks the fields a finding needs. */
export function bskyPostToFinding(post: unknown): Finding | null {
  const p = obj(post)
  const uri = str(p.uri)
  const author = obj(p.author)
  const record = obj(p.record)
  const m = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/.exec(uri)
  const indexed = Date.parse(str(p.indexedAt))
  if (!m || !str(author.did) || !Number.isFinite(indexed)) return null
  const handle = str(author.handle)
  const profile = handle && handle !== 'handle.invalid' ? handle : m[1]
  const created = Date.parse(str(record.createdAt))
  // A client sets createdAt; the service sets indexedAt. Never trust a time later than the index time.
  const published = Number.isFinite(created) ? Math.min(created, indexed) : indexed
  const text = tidy(stripControls(str(record.text))).normalize('NFC')

  const links: string[] = []
  const facets = Array.isArray(record.facets) ? record.facets : []
  const tags: string[] = []
  for (const f of facets) {
    const features = Array.isArray(obj(f).features) ? (obj(f).features as unknown[]) : []
    for (const feat of features) {
      const ft = obj(feat)
      if (str(ft.$type) === 'app.bsky.richtext.facet#link' && /^https?:\/\//i.test(str(ft.uri))) links.push(str(ft.uri))
      if (str(ft.$type) === 'app.bsky.richtext.facet#tag' && str(ft.tag)) tags.push(str(ft.tag))
    }
  }
  const ext = embedExternal(obj(record.embed))
  if (ext && /^https?:\/\//i.test(str(ext.uri))) links.push(str(ext.uri))

  const reply = obj(record.reply)
  const root = obj(reply.root)
  const rootMatch = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/.exec(str(root.uri))
  const langs = Array.isArray(record.langs) ? record.langs.filter((l): l is string => typeof l === 'string') : []
  const f: Finding = {
    source: 'bluesky',
    url: bskyPostUrl(profile, m[2]),
    title: excerptTitle(text),
    text,
    author: handle || m[1],
    points: num(p.likeCount),
    published_at: new Date(published).toISOString(),
    source_id: `bsky:${uri}`,
    source_ref: 'bluesky',
    kind: 'post',
    author_id: str(author.did),
    links: [...new Set(links)],
    counts: { replies: num(p.replyCount), reposts: num(p.repostCount), likes: num(p.likeCount), quotes: num(p.quoteCount) },
  }
  if (tags.length) f.hashtags = [...new Set(tags)]
  if (langs[0]) f.language = langs[0]
  if (rootMatch && str(root.uri) !== uri) f.thread_url = bskyPostUrl(rootMatch[1], rootMatch[2])
  return f
}

export async function searchBluesky(options: BlueskySearchOptions): Promise<BlueskyResult> {
  const terms = compileTerms(options.terms)
  if (!hasPositiveTerms(terms)) throw new SourceError('invalid_request', 'bluesky', 'A Bluesky watch needs at least one all-of or any-of term')
  const queries = remoteQueries(terms)
  const base = (options.base_url ?? DEFAULT_BASE).replace(/\/+$/, '')
  const now = options.now ?? Date.now
  const since = toIso(options.since)
  const until = toIso(options.until)
  const maxRequests = Math.max(1, options.max_requests ?? 3)
  const seen = new Set<string>()
  const result: BlueskyResult = {
    findings: [], requests: 0, candidates: 0, rejected_by_terms: 0, skipped_items: 0,
    newest_indexed_at: null, truncated: false, queries,
  }
  const headers: Record<string, string> = { accept: 'application/json' }
  if (options.authorization) headers.authorization = options.authorization

  for (const q of queries) {
    let cursor: string | undefined
    for (let i = 0; i < maxRequests; i++) {
      const params = new URLSearchParams({ q, sort: 'latest', limit: String(PAGE) })
      if (since) params.set('since', since)
      if (until) params.set('until', until)
      if (options.lang) params.set('lang', options.lang)
      if (cursor) params.set('cursor', cursor)
      const url = `${base}/xrpc/app.bsky.feed.searchPosts?${params.toString()}`
      const response = await send('bluesky', options, url, { headers })
      result.requests += 1
      assertOk('bluesky', response, url, now())
      const body = obj(await readJson('bluesky', response, url))
      if (!Array.isArray(body.posts)) throw new SourceError('bad_response', 'bluesky', 'The Bluesky search answered without a posts list')
      for (const raw of body.posts) {
        const finding = bskyPostToFinding(raw)
        if (!finding) {
          result.skipped_items += 1
          continue
        }
        if (seen.has(finding.source_id)) continue
        seen.add(finding.source_id)
        result.candidates += 1
        const indexedAt = str(obj(raw).indexedAt)
        if (!result.newest_indexed_at || indexedAt > result.newest_indexed_at) result.newest_indexed_at = indexedAt
        const m = matchTerms(terms, { title: finding.title, text: finding.text, links: finding.links.join('\n') })
        if (!m.matches) {
          result.rejected_by_terms += 1
          continue
        }
        result.findings.push(finding)
      }
      cursor = str(body.cursor) || undefined
      if (!cursor || body.posts.length === 0) break
      if (i === maxRequests - 1) result.truncated = true
    }
  }
  result.findings.sort((a, b) => (a.published_at < b.published_at ? 1 : -1))
  return result
}
