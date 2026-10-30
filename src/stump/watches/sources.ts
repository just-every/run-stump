import {
  backfillHackerNews, backfillMastodonTags, hnNextSince, pollFeed, pollMastodonTags, searchBluesky, searchHackerNews, BACKFILL_DAYS,
  type FetchFn, type Finding, type SourceFilters, type SourceWarning, type TermLogic,
} from '../lib/discovery/index.ts'
import type { WatchSource } from './model.ts'
import type { SourceState } from './store.ts'

export interface SourceRun {
  /** Everything the source returned that matched the terms, before the watch's filters. */
  findings: Finding[]
  /** The source's next cursors and validators. */
  state: Record<string, unknown>
  /** When the source asks to be polled again, where it says (feeds' own interval). */
  next_poll_at?: number
  warnings: SourceWarning[]
  /** The source cut its history short (more matches than one run reads). */
  truncated: boolean
  /** The source answered "unchanged" and was not read again. */
  unchanged: boolean
}

export interface SourceInput {
  fetch: FetchFn
  now: () => number
  terms: TermLogic
  interval_ms: number
  /** Canonical URLs already stored for this source (feed transcripts are not fetched twice). */
  known: ReadonlySet<string>
}

const OVERLAP_SECONDS = 30 * 60
const nowSeconds = (now: () => number) => Math.floor(now() / 1000)

/** What a source's filters keep (the library screens each finding against these). */
export function filtersFor(source: WatchSource): SourceFilters {
  if (source.kind === 'hn') return source.story_types?.length ? { hn: { story_types: source.story_types } } : {}
  if (source.kind === 'rss') return { rss: { feeds: [source.url!] } }
  if (source.kind === 'mastodon') return { mastodon: { instances: [source.instance!], hashtags: source.hashtags } }
  return source.lang ? { bluesky: { langs: [source.lang] } } : {}
}

/** One poll of one source: from its cursors, or its whole 30-day history when `backfill` is set. */
export async function runSource(source: WatchSource, previous: SourceState, backfill: boolean, input: SourceInput): Promise<SourceRun> {
  const { fetch, now, terms } = input
  const state = backfill ? {} : previous.state
  if (source.kind === 'hn') {
    const result = backfill
      ? await backfillHackerNews({ fetch, now, terms, story_types: source.story_types })
      : await searchHackerNews({ fetch, now, terms, story_types: source.story_types, since: typeof state.since === 'number' ? state.since : nowSeconds(now) - BACKFILL_DAYS * 86_400 })
    const next = hnNextSince(result, typeof state.since === 'number' ? state.since : undefined) ?? nowSeconds(now) - OVERLAP_SECONDS
    return { findings: result.findings, state: { since: next }, warnings: [], truncated: result.truncated, unchanged: false }
  }
  if (source.kind === 'bluesky') {
    const since = backfill ? now() - BACKFILL_DAYS * 86_400_000 : typeof state.since === 'string' ? state.since : now() - BACKFILL_DAYS * 86_400_000
    const result = await searchBluesky({ fetch, now, terms, since, lang: source.lang, max_requests: backfill ? 30 : 3 })
    return { findings: result.findings, state: { since: result.newest_indexed_at ?? new Date(now() - OVERLAP_SECONDS * 1000).toISOString() }, warnings: [], truncated: result.truncated, unchanged: false }
  }
  if (source.kind === 'mastodon') {
    const options = { fetch, now, terms, instance: source.instance!, hashtags: source.hashtags! }
    const result = backfill
      ? await backfillMastodonTags(options)
      : await pollMastodonTags({ ...options, cursors: (state.cursors as Record<string, string> | undefined) ?? {} })
    return { findings: result.findings, state: { cursors: result.cursors }, warnings: [], truncated: result.truncated, unchanged: false }
  }
  const poll = await pollFeed({
    fetch, now, terms, url: source.url!, min_interval_ms: input.interval_ms,
    etag: backfill ? null : (state.etag as string | null | undefined) ?? null,
    last_modified: backfill ? null : (state.last_modified as string | null | undefined) ?? null,
    content_hash: backfill ? null : (state.content_hash as string | null | undefined) ?? null,
    is_known: key => input.known.has(key),
  })
  const validators = { etag: poll.etag, last_modified: poll.last_modified, content_hash: poll.content_hash }
  if (poll.status === 'not_modified') return { findings: [], state: validators, next_poll_at: poll.next_poll_at, warnings: [], truncated: false, unchanged: true }
  return { findings: poll.findings, state: validators, next_poll_at: poll.next_poll_at, warnings: poll.warnings, truncated: false, unchanged: false }
}
