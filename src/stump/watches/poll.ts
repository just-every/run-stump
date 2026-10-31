import { refuse } from '../actions/refusals.ts'
import type { StumpEnv } from '../env.ts'
import { publicFetch } from '../net/fetch.ts'
import { canonicalUrl, describeError, scoreFinding, screenFindings, type Finding, type DropReason } from '../lib/discovery/index.ts'
import { erasedAmong } from '../data/tombstones.ts'
import { sendImmediateAlerts } from './alerts.ts'
import { blockedAuthors, blockRefs } from './blocks.ts'
import { loadProducts, mentionsOf, rankContext, teamHandles } from './context.ts'
import { filtersFor, runSource } from './sources.ts'
import {
  blankState, dueAt, isMuted, readSourceStates, readWatch, writeSourceState, type RecordedError, type SourceState, type WatchRow,
} from './store.ts'

export interface PollContext {
  db: D1Database
  env: StumpEnv
  now: () => number
}

export type SourceStatus = 'ok' | 'unchanged' | 'error' | 'waiting'
export interface SourceOutcome {
  source: string
  status: SourceStatus
  mode: 'poll' | 'backfill'
  /** Findings this run stored. */
  added: number
  /** Matches that were already findings, or were screened out. */
  dropped: Partial<Record<DropReason, number>>
  next_poll_at: number | null
  error?: RecordedError
  warnings?: string[]
}
export interface PollOutcome { watch_id: string; added: number; alerts: number; sources: SourceOutcome[]; next_poll_at: number | null }

const LEASE_MS = 5 * 60_000
const MAX_BACKOFF_MS = 6 * 3_600_000
const KEY_CHUNK = 80

/** Takes the watch's poll lease; false when another poll holds it. */
export async function claimLease(db: D1Database, id: string, now: number): Promise<boolean> {
  return !!await db.prepare('UPDATE stump_watches SET lease_until=? WHERE id=? AND (lease_until IS NULL OR lease_until<?) RETURNING id').bind(now + LEASE_MS, id, now).first()
}

async function storedKeys(db: D1Database, watchId: string, keys: string[]): Promise<Set<string>> {
  const found = new Set<string>()
  for (let index = 0; index < keys.length; index += KEY_CHUNK) {
    const chunk = keys.slice(index, index + KEY_CHUNK)
    const rows = (await db.prepare(`SELECT url_key FROM stump_findings WHERE watch_id=? AND url_key IN (${chunk.map(() => '?').join(',')})`).bind(watchId, ...chunk).all<{ url_key: string }>()).results
    for (const row of rows) found.add(row.url_key)
  }
  return found
}

interface Stored { id: string; finding: Finding; relevance: number; reasons: string[]; backfill: boolean }

/**
 * Polls a watch's sources and stores what is new. A source in its own interval or told to wait is
 * skipped (a manual poll ignores the interval, never a source's rate limit); a source that has no
 * backfill yet, or whose history a filter change cleared, is read from its 30-day history and its
 * findings are marked backfill, so they raise no immediate alert (STUMP-WATCH-013.5).
 */
export async function pollWatch(ctx: PollContext, watch: WatchRow, options: { manual: boolean; only?: string; backfill?: boolean }): Promise<PollOutcome> {
  const { db } = ctx, now = ctx.now()
  const states = await readSourceStates(db, watch.id)
  const products = await loadProducts(db)
  const team = await teamHandles(db)
  const blocked = blockRefs(await blockedAuthors(db))
  const rank = rankContext(watch, products, now)
  // Sources, and the transcripts a feed names, are read from the public web only.
  const fetch = publicFetch(ctx.env)
  const outcome: PollOutcome = { watch_id: watch.id, added: 0, alerts: 0, sources: [], next_poll_at: null }
  const fresh: Stored[] = []
  let error: RecordedError | null = null
  const nextStates: SourceState[] = []

  for (const source of watch.sources) {
    if (options.only && options.only !== source.key) continue
    const previous = states.get(source.key) ?? blankState(watch.id, source.key)
    const backfill = options.backfill === true || previous.backfilled_at === null
    const mode = backfill ? 'backfill' as const : 'poll' as const
    const waitUntil = options.manual ? previous.blocked_until : dueAt(previous)
    if (waitUntil !== null && waitUntil > now) {
      outcome.sources.push({ source: source.key, status: 'waiting', mode, added: 0, dropped: {}, next_poll_at: dueAt(previous) })
      nextStates.push(previous)
      continue
    }
    const known = new Set<string>()
    if (source.kind === 'rss') for (const row of (await db.prepare('SELECT url_key FROM stump_findings WHERE watch_id=? AND source_key=? LIMIT 5000').bind(watch.id, source.key).all<{ url_key: string }>()).results) known.add(row.url_key)
    const interval = watch.interval_minutes * 60_000
    const next: SourceState = { ...previous, last_polled_at: now }
    let run: Awaited<ReturnType<typeof runSource>>
    try {
      run = await runSource(source, previous, backfill, { fetch: (url, init) => fetch(url, init), now: ctx.now, terms: watch.terms, interval_ms: interval, known })
    } catch (cause) {
      const described = describeError(cause)
      const recorded: RecordedError = { at: now, kind: described.kind, message: described.message, source: source.key, ...(described.status ? { status: described.status } : {}), ...(described.retry_at ? { retry_at: described.retry_at } : {}), ...(described.code ? { code: described.code } : {}) }
      next.failures = previous.failures + 1
      next.last_error = recorded
      // A source that says when to come back (a rate limit, Retry-After) is polled then; any other failure backs off from the watch's own interval.
      next.blocked_until = described.retry_at ?? null
      next.next_poll_at = described.retry_at ?? now + Math.min(MAX_BACKOFF_MS, interval * 2 ** Math.min(next.failures - 1, 6))
      error = recorded
      outcome.sources.push({ source: source.key, status: 'error', mode, added: 0, dropped: {}, next_poll_at: dueAt(next), error: recorded })
      nextStates.push(next)
      continue
    }
    const stored = await storedKeys(db, watch.id, run.findings.map(item => canonicalUrl(item.url)))
    // An erased person's post, or anything they wrote on this source, is never stored again (STUMP-DATA-002).
    const erased = await erasedAmong(db, run.findings)
    const screened = screenFindings(run.findings, { terms: watch.terms, filters: filtersFor(source), team_handles: team, blocked_authors: blocked, known_urls: stored, erased })
    const dropped: Partial<Record<DropReason, number>> = {}
    for (const item of screened.dropped) dropped[item.reason] = (dropped[item.reason] ?? 0) + 1
    const added = await store(ctx, watch, source.key, screened.kept, { products, rank, backfill }, fresh)
    outcome.added += added
    next.state = run.state
    next.failures = 0; next.last_error = null; next.blocked_until = null
    next.next_poll_at = Math.max(now + interval, run.next_poll_at ?? 0)
    if (backfill) next.backfilled_at = now
    const notes = [...run.warnings.map(item => item.message), ...(run.truncated ? ['The source held more matches than one run reads; the oldest were left out.'] : [])]
    outcome.sources.push({ source: source.key, status: run.unchanged ? 'unchanged' : 'ok', mode, added, dropped, next_poll_at: next.next_poll_at, ...(notes.length ? { warnings: notes } : {}) })
    nextStates.push(next)
  }

  await db.batch(nextStates.map(state => writeSourceState(db, state)))
  const due = nextStates.map(dueAt).filter((value): value is number => value !== null)
  outcome.next_poll_at = due.length ? Math.min(...due) : null
  // A watch shows its newest source error with the time; a poll with no error clears it. A source skipped
  // while it waits keeps showing the error that made it wait.
  const waiting = nextStates.map(state => state.last_error).filter((item): item is RecordedError => item !== null)
  const shown = error ?? waiting.sort((a, b) => b.at - a.at)[0] ?? null
  await db.prepare('UPDATE stump_watches SET last_error=?,next_poll_at=?,lease_until=NULL,updated_at=? WHERE id=?')
    .bind(shown ? JSON.stringify(shown) : null, outcome.next_poll_at, now, watch.id).run()

  const alerting = fresh.filter(item => !item.backfill)
  if (alerting.length) {
    const current = await readWatch(db, watch.id)
    if (current) outcome.alerts = await sendImmediateAlerts(ctx, current, alerting.map(item => ({ id: item.id, finding: item.finding, relevance: item.relevance, reasons: item.reasons })))
  }
  return outcome
}

interface Basis { products: Awaited<ReturnType<typeof loadProducts>>; rank: ReturnType<typeof rankContext>; backfill: boolean }

/** Stores what is new (a finding already stored under its canonical URL is left as it is) and lists it in `fresh`. */
async function store(ctx: PollContext, watch: WatchRow, sourceKey: string, kept: Finding[], basis: Basis, fresh: Stored[]): Promise<number> {
  if (!kept.length) return 0
  const { db } = ctx, now = ctx.now()
  const statements = kept.map(finding => {
    const ranked = scoreFinding(finding, basis.rank)
    const row: Stored = { id: crypto.randomUUID(), finding, relevance: ranked.relevance, reasons: ranked.reasons.filter(reason => reason.points > 0).map(reason => reason.label), backfill: basis.backfill }
    return { row, statement: db.prepare(`INSERT INTO stump_findings(id,watch_id,source,url,url_key,title,text,author,points,published_at,relevance,reasons,routes,backfill,mentions,state,created_at,raw,source_key)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'[]',?,?,'new',?,?,?) ON CONFLICT(watch_id,url_key) DO NOTHING RETURNING id`)
      .bind(row.id, watch.id, finding.source, finding.url, canonicalUrl(finding.url), finding.title, finding.text, finding.author, finding.points, Date.parse(finding.published_at), ranked.relevance,
        JSON.stringify(ranked.reasons), basis.backfill ? 1 : 0, JSON.stringify(mentionsOf(finding, basis.products)), now, JSON.stringify(finding), sourceKey) }
  })
  const results = await db.batch(statements.map(item => item.statement))
  let added = 0
  results.forEach((result, index) => { if (result.results.length) { added += 1; fresh.push(statements[index]!.row) } })
  return added
}

/** A manual poll or backfill of one watch (the action's own door). */
export async function pollNow(ctx: PollContext, id: string, options: { only?: string; backfill?: boolean } = {}): Promise<PollOutcome> {
  const watch = await readWatch(ctx.db, id)
  if (!watch) refuse('not_found', { watch_id: id })
  if (!await claimLease(ctx.db, id, ctx.now())) refuse('poll_in_progress', { watch_id: id })
  try { return await pollWatch(ctx, watch, { manual: true, ...options }) }
  catch (cause) { await ctx.db.prepare('UPDATE stump_watches SET lease_until=NULL WHERE id=?').bind(id).run(); throw cause }
}
