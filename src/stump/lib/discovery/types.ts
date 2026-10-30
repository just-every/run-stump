/**
 * Shared types for the discovery library (STUMP-WATCH-001, -002, -003, -004, -005, -013).
 *
 * The library is pure TypeScript for the Cloudflare Workers runtime. It holds no state, opens no
 * database and imports nothing from outside this folder. Every network call goes through an
 * injected `FetchFn`.
 */

/** The fetch the caller supplies (the spine's edge fetch). Same shape as the global `fetch`. */
export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

/** Source kinds a watch can use in this library (V1 interface names). */
export type SourceKind = 'hn' | 'rss' | 'bluesky' | 'mastodon'

/** A normalised finding. The first seven fields are the contract's shape; the rest carry provenance. */
export interface Finding {
  source: SourceKind
  /** Canonical-able link to the thing found: the HN item, the feed item's link, the post's page. */
  url: string
  title: string
  /** Sanitised plain text. Never HTML. */
  text: string
  /** The author's handle or name as the source gives it (Mastodon: `user@instance`). */
  author: string
  points: number | null
  /** ISO 8601 UTC. */
  published_at: string

  /** Stable id within the source, e.g. `hn:50292905`, `bsky:at://did/app.bsky.feed.post/rkey`. */
  source_id: string
  /** Which configured source produced it: HN kind, feed URL, Mastodon instance, `bluesky`. */
  source_ref: string
  /** `story`, `show_hn`, `ask_hn`, `poll`, `comment`, `item`, `post`. */
  kind: string
  /** A stable author identifier where the source has one (Bluesky DID, Mastodon account URL). */
  author_id?: string
  /** URLs the finding refers to (link posts, embeds, feed links); matched against term logic. */
  links: string[]
  counts: Record<string, number>
  /** The thread a comment or reply belongs to, when it is not the finding itself. */
  thread_url?: string
  /** Followers where the source returns them (Mastodon). Used by ranking. */
  author_followers?: number
  hashtags?: string[]
  language?: string
  /** Set when the match came from a podcast transcript: the transcript's URL. */
  transcript_url?: string
  /** What matched in that transcript: the watch terms found there and the passages around them. */
  transcript_match?: TranscriptMatch
  /** True when the date was missing in the source and the fetch time stands in. */
  date_estimated?: boolean
}

/** Where a podcast transcript matched a watch's terms. The excerpts are sanitised spoken text, a few per finding. */
export interface TranscriptMatch {
  terms: string[]
  excerpts: string[]
}

export type SourceErrorKind =
  | 'network'
  | 'timeout'
  | 'http'
  | 'rate_limited'
  | 'auth_required'
  | 'parse'
  | 'bad_response'
  | 'invalid_request'
  | 'refused'

/** A non-fatal problem a poll reports next to its findings (a transcript that would not load, a bad item). */
export interface SourceWarning {
  code: string
  message: string
  url?: string
}

/** A handle reference for team exclusion and the author block list. */
export type HandleRef = string | { source?: SourceKind; handle: string }

/** Outcome of one outbound alert delivery. `unknown` means the request may have arrived. */
export interface DeliveryResult {
  outcome: 'delivered' | 'rejected' | 'retry' | 'unknown'
  status?: number
  /** Provider code when it gives one (Slack: `invalid_payload`, `channel_not_found`, ...). */
  code?: string
  /** Milliseconds since epoch before which the delivery should not be retried. */
  retry_at?: number
  detail: string
}

export interface CommonOptions {
  fetch: FetchFn
  /** Milliseconds; per request. Default 15000. */
  timeout_ms?: number
  /** Clock for tests and for the spine. Milliseconds since epoch. Default `Date.now`. */
  now?: () => number
}
