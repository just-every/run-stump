import { isListedAuthor, scoreFinding, type Finding, type SourceKind } from '../lib/discovery/index.ts'
import { blockedAuthors, blockRefs } from './blocks.ts'
import { loadProducts, mentionsOf, rankContext } from './context.ts'
import { loadVenues, routesFor } from './routes.ts'
import type { WatchRow } from './store.ts'

interface Row {
  id: string; watch_id: string; source: string; url: string; title: string | null; text: string | null; author: string | null; points: number | null
  published_at: number | null; relevance: number | null; backfill: number; state: string; created_at: number; raw: string | null; source_key: string | null
}

const CANDIDATES = 500

/**
 * A watch's findings, ranked now: from the finding as its source gave it, the watch's current terms, the
 * company's products and the clock, so freshness and mentions are true on every read and a finding's own
 * text never changes its rank by instruction (D-7, STUMP-WATCH-005.5). Routes come from the venue's rules.
 * A dismissed finding and a finding by an author on the company's block list are not listed.
 */
export async function rankedFindings(db: D1Database, watch: WatchRow, now: number, limit: number) {
  const blocked = blockRefs(await blockedAuthors(db))
  const listed = (finding: Finding | null) => !finding || !isListedAuthor(finding, blocked)
  const rows = (await db.prepare("SELECT id,watch_id,source,url,title,text,author,points,published_at,relevance,backfill,state,created_at,raw,source_key FROM stump_findings WHERE watch_id=? AND state<>'dismissed' ORDER BY relevance DESC,published_at DESC,id LIMIT ?").bind(watch.id, CANDIDATES).all<Row>()).results
  const authors = (await db.prepare("SELECT source,author,json_extract(raw,'$.source_ref') AS source_ref,json_extract(raw,'$.author_id') AS author_id FROM stump_findings WHERE watch_id=? AND state<>'dismissed'").bind(watch.id)
    .all<{ source: SourceKind; author: string | null; source_ref: string | null; author_id: string | null }>()).results
  const total = blocked.length ? authors.filter(row => !isListedAuthor({ source: row.source, author: row.author ?? '', source_ref: row.source_ref ?? '', ...(row.author_id ? { author_id: row.author_id } : {}) } as Finding, blocked)).length : authors.length
  const products = await loadProducts(db), venues = await loadVenues(db), context = rankContext(watch, products, now)
  const scored = rows.map(row => {
    const finding = row.raw ? JSON.parse(row.raw) as Finding : null
    const ranked = finding ? scoreFinding(finding, context) : null
    return { row, finding, ranked }
  }).filter(item => listed(item.finding)).sort((a, b) => (b.ranked?.relevance ?? b.row.relevance ?? 0) - (a.ranked?.relevance ?? a.row.relevance ?? 0) || (b.row.published_at ?? 0) - (a.row.published_at ?? 0) || (a.row.id < b.row.id ? -1 : 1))
  const items = []
  for (const { row, finding, ranked } of scored.slice(0, limit)) {
    const where = finding ? routesFor(venues, finding) : { routes: [], venue: null }
    const details = ranked?.reasons ?? []
    items.push({
      id: row.id, watch_id: row.watch_id, source: row.source, source_ref: finding?.source_ref ?? null, kind: finding?.kind ?? null, url: row.url, title: row.title ?? '', text: row.text ?? '', author: row.author ?? '', points: row.points,
      published_at: row.published_at === null ? null : new Date(row.published_at).toISOString(),
      relevance: ranked?.relevance ?? row.relevance ?? 0,
      reasons: details.filter(reason => reason.points > 0).map(reason => reason.label),
      reason_details: details.map(reason => ({ factor: reason.factor, label: reason.label, points: reason.points, max: reason.max })),
      answerable: ranked?.answerable_question ?? false,
      routes: where.routes, venue: where.venue,
      backfill: row.backfill === 1,
      mentions: finding ? mentionsOf(finding, products) : [],
      transcript_url: finding?.transcript_url ?? null, transcript_match: finding?.transcript_match ?? null, thread_url: finding?.thread_url ?? null,
      counts: finding?.counts ?? {},
      found_at: new Date(row.created_at).toISOString(),
    })
  }
  return { items, total }
}
