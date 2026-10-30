/**
 * Hacker News through the HN Search API (Algolia). STUMP-WATCH-001, STUMP-WATCH-013.2, .5.
 *
 * Docs: https://hn.algolia.com/api (endpoints `search_by_date`, tags `story`, `comment`, `show_hn`,
 * `ask_hn`, `numericFilters` on `created_at_i`, `hitsPerPage` up to 1000, a query reaches at most
 * 1000 results). Item pages: https://news.ycombinator.com/item?id=<objectID>.
 * Response shape checked against the live API on 30 Oct 2026: `hits[]` with `objectID`, `author`,
 * `title`, `url`, `points`, `num_comments`, `story_text`, `comment_text`, `story_id`, `story_title`,
 * `story_url`, `parent_id`, `created_at`, `created_at_i`, `_tags`; `story_text` and `comment_text`
 * are HTML.
 *
 * The request turns off Algolia's typo tolerance, prefix matching and plural folding (ordinary Algolia
 * search parameters, accepted by this endpoint), and every candidate is still re-checked against the watch's term logic.
 * Results are walked newest first in windows of `created_at_i` so a 30-day backfill is not cut off by
 * the 1000-result reach of one query. HN has no write door here: this library only reads.
 */
import { SourceError } from './errors.ts'
import { assertOk, readJson, send } from './http.ts'
import { compileTerms, hasPositiveTerms, matchTerms, remoteQueries, type TermLogic, type CompiledTerms } from './terms.ts'
import { extractLinks, htmlToText, truncateGraphemes } from './text.ts'
import type { CommonOptions, Finding } from './types.ts'

export type HnStoryType = 'story' | 'show_hn' | 'ask_hn' | 'comment' | 'poll'
const HN_TYPES: HnStoryType[] = ['story', 'show_hn', 'ask_hn', 'comment', 'poll']
const PAGE_SIZE = 1000
export const BACKFILL_DAYS = 30
export const DEFAULT_HN_OVERLAP_SECONDS = 30 * 60
const DEFAULT_BASE = 'https://hn.algolia.com/api/v1'

export interface HnSearchOptions extends CommonOptions {
  terms: TermLogic | CompiledTerms
  /** Default `['story', 'comment']`. `story` covers Show HN and Ask HN too. */
  story_types?: HnStoryType[]
  /** Unix seconds, inclusive. */
  since?: number
  /** Unix seconds, inclusive. */
  until?: number
  /** Requests per query string. Default 5; a backfill raises it. */
  max_requests?: number
  base_url?: string
}

export interface HnResult {
  findings: Finding[]
  requests: number
  /** Hits Algolia returned that were not seen before in this run. */
  candidates: number
  /** Candidates dropped because the term logic did not hold (typo-tolerant matches). */
  rejected_by_terms: number
  /** Hits missing an id or a time. */
  skipped_items: number
  /** Highest `created_at_i` seen, for the next poll's `since`. */
  newest_created_at_i: number | null
  /** True when the request cap stopped the walk before it reached `since`. */
  truncated: boolean
  queries: string[]
}

export function backfillSince(nowMs: number, days = BACKFILL_DAYS): number {
  return Math.floor(nowMs / 1000) - days * 86_400
}

/** `since` for the next poll: the newest time seen minus an overlap, because Algolia indexes items some minutes after they are created. */
export function hnNextSince(result: HnResult, previousSince: number | undefined, overlapSeconds = DEFAULT_HN_OVERLAP_SECONDS): number | undefined {
  if (result.newest_created_at_i === null) return previousSince
  return Math.max(previousSince ?? 0, result.newest_created_at_i - overlapSeconds)
}

function tagsFor(types: HnStoryType[]): string {
  const set = new Set(types)
  if (set.has('story')) {
    set.delete('show_hn')
    set.delete('ask_hn')
  }
  const list = [...set]
  return list.length === 1 ? list[0] : `(${list.join(',')})`
}

interface HnHit {
  objectID?: unknown
  author?: unknown
  title?: unknown
  url?: unknown
  points?: unknown
  num_comments?: unknown
  story_text?: unknown
  comment_text?: unknown
  story_id?: unknown
  story_title?: unknown
  story_url?: unknown
  created_at_i?: unknown
  _tags?: unknown
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function hnItemUrl(id: string | number): string {
  return `https://news.ycombinator.com/item?id=${id}`
}

function kindOf(tags: string[]): string {
  if (tags.includes('comment')) return 'comment'
  if (tags.includes('show_hn')) return 'show_hn'
  if (tags.includes('ask_hn')) return 'ask_hn'
  if (tags.includes('poll')) return 'poll'
  return 'story'
}

/** Map one Algolia hit to a finding; null when it lacks an id or a time. */
export function hnHitToFinding(hit: HnHit): Finding | null {
  const id = typeof hit.objectID === 'string' || typeof hit.objectID === 'number' ? String(hit.objectID) : ''
  const createdAt = num(hit.created_at_i)
  if (!id || createdAt === null) return null
  const tags = Array.isArray(hit._tags) ? hit._tags.filter((t): t is string => typeof t === 'string') : []
  const kind = kindOf(tags)
  const html = kind === 'comment' ? str(hit.comment_text) : str(hit.story_text)
  const links = [str(hit.url), str(hit.story_url), ...extractLinks(html)].filter((u) => /^https?:\/\//i.test(u))
  const storyId = hit.story_id !== undefined && hit.story_id !== null ? String(hit.story_id) : ''
  const title = htmlToText(kind === 'comment' ? str(hit.story_title) : str(hit.title))
  const counts: Record<string, number> = {}
  const comments = num(hit.num_comments)
  if (comments !== null) counts.comments = comments
  const finding: Finding = {
    source: 'hn',
    url: hnItemUrl(id),
    title: truncateGraphemes(title, 300),
    text: truncateGraphemes(htmlToText(html), 20_000),
    author: htmlToText(str(hit.author)),
    points: kind === 'comment' ? null : (num(hit.points) ?? 0),
    published_at: new Date(createdAt * 1000).toISOString(),
    source_id: `hn:${id}`,
    source_ref: kind,
    kind,
    links: [...new Set(links)],
    counts,
  }
  if (kind === 'comment' && storyId) finding.thread_url = hnItemUrl(storyId)
  return finding
}

export async function searchHackerNews(options: HnSearchOptions): Promise<HnResult> {
  const terms = compileTerms(options.terms)
  const types = options.story_types?.length ? options.story_types : (['story', 'comment'] as HnStoryType[])
  for (const t of types) {
    if (!HN_TYPES.includes(t)) throw new SourceError('invalid_request', 'hn', `"${String(t)}" is not a Hacker News story type`)
  }
  if (!hasPositiveTerms(terms)) {
    throw new SourceError('invalid_request', 'hn', 'A Hacker News watch needs at least one all-of or any-of term')
  }
  const queries = remoteQueries(terms)
  const base = options.base_url ?? DEFAULT_BASE
  const now = options.now ?? Date.now
  const maxRequests = Math.max(1, options.max_requests ?? 5)
  const tags = tagsFor(types)
  const seen = new Set<string>()
  const result: HnResult = {
    findings: [], requests: 0, candidates: 0, rejected_by_terms: 0, skipped_items: 0,
    newest_created_at_i: null, truncated: false, queries,
  }

  for (const query of queries) {
    let upper = options.until
    for (let i = 0; i < maxRequests; i++) {
      const params = new URLSearchParams({
        query, tags, hitsPerPage: String(PAGE_SIZE), page: '0', attributesToHighlight: 'none',
        // Exact whole-word candidates only: with typo tolerance and prefix matching on, "crm" over 30 days
        // matched 114,694 items, 70 without (checked live 30 Oct 2026), and the 1000-result reach hid real hits.
        typoTolerance: 'false', queryType: 'prefixNone', ignorePlurals: 'false',
      })
      const filters: string[] = []
      if (options.since !== undefined) filters.push(`created_at_i>=${Math.floor(options.since)}`)
      if (upper !== undefined) filters.push(`created_at_i<=${Math.floor(upper)}`)
      if (filters.length) params.set('numericFilters', filters.join(','))
      const url = `${base}/search_by_date?${params.toString()}`
      const response = await send('hn', options, url, { headers: { accept: 'application/json' } })
      result.requests += 1
      assertOk('hn', response, url, now())
      const body = (await readJson('hn', response, url)) as { hits?: unknown }
      if (!body || typeof body !== 'object' || !Array.isArray(body.hits)) {
        throw new SourceError('bad_response', 'hn', 'The Hacker News search answered without a hits list')
      }
      const hits = body.hits as HnHit[]
      let fresh = 0
      let oldest = Number.POSITIVE_INFINITY
      for (const hit of hits) {
        const finding = hit && typeof hit === 'object' ? hnHitToFinding(hit) : null
        if (!finding) {
          result.skipped_items += 1
          continue
        }
        const created = Date.parse(finding.published_at) / 1000
        oldest = Math.min(oldest, created)
        if (seen.has(finding.source_id)) continue
        seen.add(finding.source_id)
        fresh += 1
        result.candidates += 1
        result.newest_created_at_i = Math.max(result.newest_created_at_i ?? 0, created)
        const m = matchTerms(terms, { title: finding.title, text: finding.text, links: finding.links.join('\n') })
        if (!m.matches) {
          result.rejected_by_terms += 1
          continue
        }
        result.findings.push(finding)
      }
      if (hits.length < PAGE_SIZE) break
      if (fresh === 0) {
        result.truncated = true
        break
      }
      if (options.since !== undefined && oldest <= options.since) break
      upper = oldest
      if (i === maxRequests - 1) result.truncated = true
    }
  }
  result.findings.sort((a, b) => (a.published_at < b.published_at ? 1 : -1))
  return result
}

/** A new watch's 30-day backfill (STUMP-WATCH-013.5): the same walk with a wider request budget. */
export function backfillHackerNews(options: Omit<HnSearchOptions, 'since' | 'until'> & { days?: number }): Promise<HnResult> {
  const now = options.now ?? Date.now
  return searchHackerNews({ ...options, since: backfillSince(now(), options.days), max_requests: options.max_requests ?? 30 })
}
