import type { TermLogic } from '../lib/discovery/index.ts'
import type { WatchSource } from './model.ts'

/** What a failed poll or delivery leaves on the record, with its time. */
export interface RecordedError { at: number; kind: string; message: string; source?: string; status?: number; retry_at?: number; code?: string }

/** Alert settings as stored: addresses and the secret are sealed (seal.ts). */
export interface StoredAlerts {
  immediate_min_relevance: number
  /** `host` is shown; the address (which carries Slack's credential) and the secret are sealed. */
  slack: { url: string; host: string } | null
  webhook: { url: string; secret: string; host: string } | null
}

export interface WatchRow {
  id: string
  name: string
  product_ids: string[]
  terms: TermLogic
  sources: WatchSource[]
  alerts: StoredAlerts | null
  blocked_authors: string[]
  muted: boolean
  muted_until: number | null
  last_error: RecordedError | null
  next_poll_at: number | null
  interval_minutes: number
  lease_until: number | null
  revision: number
  created_by: string
  created_at: number
  updated_at: number
}

interface Raw {
  id: string; name: string; product_ids: string; terms: string; sources: string; alerts: string | null; blocked_authors: string
  muted: number; muted_until: number | null; last_error: string | null; next_poll_at: number | null; interval_minutes: number; lease_until: number | null
  revision: number; created_by: string; created_at: number; updated_at: number
}

const parse = <T>(value: string | null): T | null => value === null ? null : JSON.parse(value) as T
const toWatch = (row: Raw): WatchRow => ({
  id: row.id, name: row.name, product_ids: parse<string[]>(row.product_ids) ?? [], terms: parse<TermLogic>(row.terms) ?? {}, sources: parse<WatchSource[]>(row.sources) ?? [],
  alerts: parse<StoredAlerts>(row.alerts), blocked_authors: parse<string[]>(row.blocked_authors) ?? [], muted: row.muted === 1, muted_until: row.muted_until,
  last_error: parse<RecordedError>(row.last_error), next_poll_at: row.next_poll_at, interval_minutes: row.interval_minutes, lease_until: row.lease_until,
  revision: row.revision, created_by: row.created_by, created_at: row.created_at, updated_at: row.updated_at,
})

export async function readWatch(db: D1Database, id: string): Promise<WatchRow | null> {
  const row = await db.prepare('SELECT * FROM stump_watches WHERE id=?').bind(id).first<Raw>()
  return row ? toWatch(row) : null
}

export async function listWatchRows(db: D1Database): Promise<WatchRow[]> {
  return (await db.prepare('SELECT * FROM stump_watches ORDER BY created_at,id').all<Raw>()).results.map(toWatch)
}

/** A watch is muted while its mute has no end, or its end is still ahead. */
export const isMuted = (watch: Pick<WatchRow, 'muted' | 'muted_until'>, now: number) => watch.muted && (watch.muted_until === null || watch.muted_until > now)

/** Per-source polling state: cursors and HTTP validators, when to poll next, and the last error. */
export interface SourceState {
  watch_id: string
  source_key: string
  state: Record<string, unknown>
  next_poll_at: number | null
  blocked_until: number | null
  last_polled_at: number | null
  backfilled_at: number | null
  failures: number
  last_error: RecordedError | null
}

interface RawState { watch_id: string; source_key: string; state: string; next_poll_at: number | null; blocked_until: number | null; last_polled_at: number | null; backfilled_at: number | null; failures: number; last_error: string | null }
const toState = (row: RawState): SourceState => ({ ...row, state: parse<Record<string, unknown>>(row.state) ?? {}, last_error: parse<RecordedError>(row.last_error) })

export async function readSourceStates(db: D1Database, watchId: string): Promise<Map<string, SourceState>> {
  const rows = (await db.prepare('SELECT * FROM stump_watch_sources WHERE watch_id=?').bind(watchId).all<RawState>()).results
  return new Map(rows.map(row => [row.source_key, toState(row)]))
}

export const blankState = (watchId: string, key: string): SourceState => ({ watch_id: watchId, source_key: key, state: {}, next_poll_at: null, blocked_until: null, last_polled_at: null, backfilled_at: null, failures: 0, last_error: null })

export function writeSourceState(db: D1Database, state: SourceState): D1PreparedStatement {
  return db.prepare(`INSERT INTO stump_watch_sources(watch_id,source_key,state,next_poll_at,blocked_until,last_polled_at,backfilled_at,failures,last_error) VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(watch_id,source_key) DO UPDATE SET state=excluded.state,next_poll_at=excluded.next_poll_at,blocked_until=excluded.blocked_until,last_polled_at=excluded.last_polled_at,
      backfilled_at=excluded.backfilled_at,failures=excluded.failures,last_error=excluded.last_error`)
    .bind(state.watch_id, state.source_key, JSON.stringify(state.state), state.next_poll_at, state.blocked_until, state.last_polled_at, state.backfilled_at, state.failures,
      state.last_error ? JSON.stringify(state.last_error) : null)
}

/** The next time any source of this watch is due: its own cadence, or the time its source asked it to wait for. */
export const dueAt = (state: Pick<SourceState, 'next_poll_at' | 'blocked_until'>): number | null =>
  state.next_poll_at === null && state.blocked_until === null ? null : Math.max(state.next_poll_at ?? 0, state.blocked_until ?? 0)
