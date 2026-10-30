import { isMuted, readSourceStates, dueAt, type RecordedError, type WatchRow } from './store.ts'
import type { Channel } from './alerts.ts'

const iso = (ms: number | null) => ms === null ? null : new Date(ms).toISOString()
const shownError = (error: RecordedError | null) => error ? { ...error, at: iso(error.at), ...(error.retry_at ? { retry_at: iso(error.retry_at) } : {}) } : null

interface DeliveryRow { event_id: string; channel: Channel; finding_id: string | null; state: string; attempts: number; last_error: string | null; last_attempt_at: number | null; delivered_at: number | null; created_at: number }

/** A watch as the doors answer it. Alert addresses and secrets are never part of it: only where they point and that they are set. */
export async function presentWatch(db: D1Database, watch: WatchRow, now: number) {
  const states = await readSourceStates(db, watch.id)
  const counts = await db.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(backfill),0) AS backfill FROM stump_findings WHERE watch_id=? AND state<>'dismissed'").bind(watch.id).first<{ total: number; backfill: number }>()
  const deliveries = (await db.prepare('SELECT event_id,channel,finding_id,state,attempts,last_error,last_attempt_at,delivered_at,created_at FROM stump_watch_deliveries WHERE watch_id=? ORDER BY created_at DESC,event_id,channel LIMIT 20').bind(watch.id).all<DeliveryRow>()).results
    .map(row => ({ event_id: row.event_id, channel: row.channel, finding_id: row.finding_id, state: row.state, attempts: row.attempts, last_error: shownError(row.last_error ? JSON.parse(row.last_error) as RecordedError : null),
      last_attempt_at: iso(row.last_attempt_at), delivered_at: iso(row.delivered_at), created_at: iso(row.created_at) }))
  const latest = (channel: Channel) => deliveries.find(row => row.channel === channel)?.last_error ?? null
  const alerts = watch.alerts
  return {
    id: watch.id, name: watch.name, product_ids: watch.product_ids, terms: watch.terms,
    sources: watch.sources.map(source => {
      const state = states.get(source.key)
      return { ...source, backfilled_at: iso(state?.backfilled_at ?? null), last_polled_at: iso(state?.last_polled_at ?? null), next_poll_at: iso(state ? dueAt(state) : null), last_error: shownError(state?.last_error ?? null) }
    }),
    alerts: alerts ? {
      immediate_min_relevance: alerts.immediate_min_relevance,
      slack: alerts.slack ? { configured: true, host: alerts.slack.host, last_error: latest('slack') } : null,
      webhook: alerts.webhook ? { configured: true, host: alerts.webhook.host, secret_set: true, last_error: latest('webhook') } : null,
    } : null,
    interval_minutes: watch.interval_minutes,
    muted: isMuted(watch, now), muted_until: iso(watch.muted_until),
    last_error: shownError(watch.last_error), next_poll_at: iso(watch.next_poll_at),
    findings: { total: counts?.total ?? 0, backfill: counts?.backfill ?? 0 },
    deliveries,
    revision: watch.revision, created_at: iso(watch.created_at), updated_at: iso(watch.updated_at),
  }
}
