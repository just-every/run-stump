/**
 * Fetching and polling feeds with HTTP caching (STUMP-WATCH-002.2, .3, .4, .8).
 *
 * Conditional requests: If-None-Match with the stored ETag and If-Modified-Since with the stored
 * Last-Modified (RFC 9110 sections 13.1.1 to 13.1.3, https://www.rfc-editor.org/rfc/rfc9110#name-conditional-requests);
 * a 304 answer adds nothing. A server that ignores the validators and sends the same bytes is
 * caught by a content hash. The next poll waits for the longest of the caller's minimum, the feed's
 * `ttl` / `sy:updatePeriod`, `Cache-Control: max-age` and any `Retry-After`.
 */
import { SourceError } from './errors.ts'
import { parseFeed, type FeedItem, type ParsedFeed } from './feeds.ts'
import { assertOk, rateLimitRetryAt, readText, redactUrl, send, sha256Hex } from './http.ts'
import { compileTerms, hasPositiveTerms, matchTerms, type CompiledTerms, type TermLogic } from './terms.ts'
import { fetchTranscript } from './transcripts.ts'
import { truncateGraphemes } from './text.ts'
import { canonicalUrl, isRedditHost, parseHttpUrl } from './url.ts'
import type { CommonOptions, Finding, SourceWarning } from './types.ts'

const DEFAULT_MAX_BYTES = 5_000_000
export const DEFAULT_MIN_INTERVAL_MS = 15 * 60_000
const MAX_INTERVAL_MS = 24 * 3_600_000
const USER_AGENT = 'Stump/0.1 (+https://github.com/just-every/run-stump)'

export const REDDIT_REFUSAL =
  'Reddit feeds are not a source. Watch Reddit through a licensed data supplier or through the alerts your company already receives.'

/** Refuse reddit.com feeds (STUMP-WATCH-002.8) and anything that is not an http(s) URL. */
export function assertFeedUrlAllowed(url: string): URL {
  const u = parseHttpUrl(url)
  if (!u) throw new SourceError('invalid_request', 'rss', 'A feed address must be an http or https URL')
  if (u.username || u.password) throw new SourceError('invalid_request', 'rss', 'A feed address must not carry a user name or password')
  if (isRedditHost(u.hostname)) throw new SourceError('refused', 'rss', REDDIT_REFUSAL, { code: 'reddit_not_a_source' })
  return u
}

export interface FeedValidators {
  etag?: string | null
  last_modified?: string | null
  content_hash?: string | null
}

export interface FeedFetchOptions extends CommonOptions, FeedValidators {
  url: string
  max_bytes?: number
  /** Floor for `next_poll_at`. Default 15 minutes. */
  min_interval_ms?: number
}

interface Validators {
  etag: string | null
  last_modified: string | null
  content_hash: string | null
}

export type FeedFetch =
  | ({ status: 'not_modified'; reason: 'http_304' | 'same_content'; next_poll_at: number } & Validators)
  | ({ status: 'ok'; feed: ParsedFeed; next_poll_at: number; final_url: string } & Validators)

function cacheControlMaxAgeMs(headers: Headers): number {
  const cc = headers.get('cache-control') ?? ''
  const m = /(?:^|,)\s*s-maxage\s*=\s*(\d+)/i.exec(cc) ?? /(?:^|,)\s*max-age\s*=\s*(\d+)/i.exec(cc)
  return m ? Number(m[1]) * 1000 : 0
}

function nextPollAt(now: number, minMs: number, headers: Headers, hintMs?: number): number {
  const wait = Math.min(MAX_INTERVAL_MS, Math.max(minMs, hintMs ?? 0, cacheControlMaxAgeMs(headers)))
  const retry = rateLimitRetryAt(headers, now)
  return Math.max(now + wait, headers.has('retry-after') && retry ? retry : 0)
}

export async function fetchFeed(options: FeedFetchOptions): Promise<FeedFetch> {
  assertFeedUrlAllowed(options.url)
  const now = options.now ?? Date.now
  const minMs = options.min_interval_ms ?? DEFAULT_MIN_INTERVAL_MS
  const headers: Record<string, string> = {
    accept: 'application/atom+xml, application/rss+xml, application/rdf+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
    'user-agent': USER_AGENT,
  }
  if (options.etag) headers['if-none-match'] = options.etag
  if (options.last_modified) headers['if-modified-since'] = options.last_modified

  const response = await send('rss', options, options.url, { headers })
  const keep = {
    etag: response.headers.get('etag') ?? options.etag ?? null,
    last_modified: response.headers.get('last-modified') ?? options.last_modified ?? null,
    content_hash: options.content_hash ?? null,
  }
  if (response.status === 304) {
    return { status: 'not_modified', reason: 'http_304', ...keep, next_poll_at: nextPollAt(now(), minMs, response.headers) }
  }
  assertOk('rss', response, options.url, now())
  if (response.url) {
    const landed = parseHttpUrl(response.url)
    if (landed && isRedditHost(landed.hostname)) {
      throw new SourceError('refused', 'rss', REDDIT_REFUSAL, { code: 'reddit_not_a_source' })
    }
  }
  const body = await readText('rss', response, options.url, options.max_bytes ?? DEFAULT_MAX_BYTES, { xml: true })
  const hash = await sha256Hex(body)
  const fresh = { ...keep, content_hash: hash }
  if (options.content_hash && options.content_hash === hash) {
    return { status: 'not_modified', reason: 'same_content', ...fresh, next_poll_at: nextPollAt(now(), minMs, response.headers) }
  }
  let feed: ParsedFeed
  try {
    feed = parseFeed(body, response.url || options.url, now())
  } catch (e) {
    if (e instanceof SourceError) throw new SourceError(e.kind, 'rss', `${redactUrl(options.url)}: ${e.message}`, { code: e.code })
    throw e
  }
  return {
    status: 'ok', feed, ...fresh, final_url: response.url || options.url,
    next_poll_at: nextPollAt(now(), minMs, response.headers, feed.interval_hint_ms),
  }
}

export interface FeedPollOptions extends FeedFetchOptions {
  /** Empty or missing terms mean every item becomes a finding. */
  terms?: TermLogic | CompiledTerms
  /** Items already known (by canonical URL): their transcripts are not fetched again. */
  is_known?: (canonicalUrl: string) => boolean
  /** Transcripts fetched per poll. Default 5. */
  max_transcripts?: number
  /** Items read per poll, newest first. Default 200. */
  max_items?: number
}

export type FeedPoll =
  | { status: 'not_modified'; reason: 'http_304' | 'same_content'; etag: string | null; last_modified: string | null; content_hash: string | null; next_poll_at: number }
  | {
      status: 'ok'
      findings: Finding[]
      warnings: SourceWarning[]
      items_seen: number
      etag: string | null
      last_modified: string | null
      content_hash: string | null
      next_poll_at: number
      feed_title: string
    }

function itemToFinding(item: FeedItem, feedUrl: string, nowMs: number): Finding {
  return {
    source: 'rss',
    url: item.url,
    title: truncateGraphemes(item.title, 300),
    text: truncateGraphemes(item.text, 20_000),
    author: item.author,
    points: null,
    published_at: item.published_at ?? new Date(nowMs).toISOString(),
    source_id: `rss:${feedUrl}#${item.guid}`,
    source_ref: feedUrl,
    kind: 'item',
    links: item.links,
    counts: {},
    hashtags: item.categories.length ? item.categories : undefined,
    ...(item.published_at ? {} : { date_estimated: true }),
  }
}

/** Fetch one feed and turn its matching items into findings. */
export async function pollFeed(options: FeedPollOptions): Promise<FeedPoll> {
  const terms = compileTerms(options.terms ?? {})
  const fetched = await fetchFeed(options)
  if (fetched.status === 'not_modified') {
    const { status, reason, etag, last_modified, content_hash, next_poll_at } = fetched
    return { status, reason, etag, last_modified, content_hash, next_poll_at }
  }
  const nowMs = (options.now ?? Date.now)()
  const warnings: SourceWarning[] = [...fetched.feed.warnings]
  const items = [...fetched.feed.items]
    .sort((a, b) => ((b.published_at ?? '') < (a.published_at ?? '') ? -1 : 1))
    .slice(0, options.max_items ?? 200)
  const constrained = hasPositiveTerms(terms)
  let transcriptBudget = options.max_transcripts ?? 5
  const findings: Finding[] = []

  for (const item of items) {
    const finding = itemToFinding(item, options.url, nowMs)
    const hay = { title: finding.title, text: finding.text, links: finding.links.join('\n') }
    if (!constrained && terms.none.length === 0) {
      findings.push(finding)
      continue
    }
    let m = matchTerms(terms, hay)
    const known = options.is_known?.(canonicalUrl(item.url)) ?? false
    const needsTranscript = item.transcripts.length > 0 && !known && (!m.matches || terms.none.length > 0) && transcriptBudget > 0
    if (needsTranscript) {
      transcriptBudget -= 1
      const t = await fetchTranscript(options, item.transcripts)
      warnings.push(...t.warnings)
      if (t.text) {
        m = matchTerms(terms, { ...hay, transcript: t.text })
        if (m.matched_in.includes('transcript')) finding.transcript_url = t.url ?? undefined
      }
    }
    if (m.matches) findings.push(finding)
  }
  return {
    status: 'ok', findings, warnings, items_seen: fetched.feed.items.length,
    etag: fetched.etag, last_modified: fetched.last_modified, content_hash: fetched.content_hash,
    next_poll_at: fetched.next_poll_at, feed_title: fetched.feed.title,
  }
}
