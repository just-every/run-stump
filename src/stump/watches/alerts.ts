import { refuse } from '../actions/refusals.ts'
import type { StumpEnv } from '../env.ts'
import { stumpFetch } from '../net/fetch.ts'
import {
  buildAlertEvent, deliverWebhook, deriveEventId, describeError, excerptTitle, postSlackAlert,
  type AlertFinding, type AlertMessage, type DeliveryResult, type Finding,
} from '../lib/discovery/index.ts'
import { open } from './seal.ts'
import { isMuted, readWatch, type RecordedError, type WatchRow } from './store.ts'

interface AlertContext { db: D1Database; env: StumpEnv; now: () => number }
export type Channel = 'slack' | 'webhook'
export interface AlertSubject { id: string; finding: Finding; relevance: number; reasons: string[] }

/** Immediate alerts one poll may send; the rest stay findings and show on the screen. */
const MAX_PER_POLL = 10
const MAX_ATTEMPTS = 5
const RETRY_MS = [5, 15, 60, 240].map(minutes => minutes * 60_000)

/** The page of the app a person lands on from an alert. */
export const watchPage = (env: Pick<StumpEnv, 'AUTH_ORIGIN'>, watchId: string, findingId?: string) =>
  `${env.AUTH_ORIGIN.replace(/\/+$/, '')}/app/listening?watch=${encodeURIComponent(watchId)}${findingId ? `&finding=${encodeURIComponent(findingId)}` : ''}`

const iso = (ms: number) => new Date(ms).toISOString()
const channelsOf = (watch: WatchRow): Channel[] => [...(watch.alerts?.slack ? ['slack' as const] : []), ...(watch.alerts?.webhook ? ['webhook' as const] : [])]

function messageFor(ctx: AlertContext, watch: WatchRow, subject: AlertSubject): AlertMessage {
  const f = subject.finding
  const item: AlertFinding = {
    id: subject.id, title: f.title || excerptTitle(f.text), url: watchPage(ctx.env, watch.id, subject.id), source_url: f.url, source: f.source, author: f.author,
    published_at: f.published_at, relevance: subject.relevance, reasons: subject.reasons, ...(f.text ? { excerpt: f.text.slice(0, 280) } : {}),
  }
  return { kind: 'immediate', watch_name: watch.name, watch_url: watchPage(ctx.env, watch.id), findings: [item], generated_at: iso(ctx.now()) }
}

interface DeliveryRow { event_id: string; channel: Channel; watch_id: string; finding_id: string | null; message: string; state: string; attempts: number }

/** Sends one stored event on one channel, and records the outcome on its row (the failure with its time, never the address). */
async function attempt(ctx: AlertContext, watch: WatchRow, row: DeliveryRow): Promise<DeliveryResult> {
  const now = ctx.now(), message = JSON.parse(row.message) as AlertMessage
  const fetch = stumpFetch(ctx.env), send = (url: string, init?: RequestInit) => fetch(url, init)
  let result: DeliveryResult
  try {
    if (row.channel === 'slack' && watch.alerts?.slack) {
      result = await postSlackAlert({ webhook_url: await open(ctx.env, `${watch.id}:slack.url`, watch.alerts.slack.url), message, fetch: send, now: ctx.now })
    } else if (row.channel === 'webhook' && watch.alerts?.webhook) {
      const secret = await open(ctx.env, `${watch.id}:webhook.secret`, watch.alerts.webhook.secret)
      const url = await open(ctx.env, `${watch.id}:webhook.url`, watch.alerts.webhook.url)
      result = await deliverWebhook({ url, secret, event_id: row.event_id, body: JSON.stringify(buildAlertEvent(row.event_id, message)), fetch: send, now: ctx.now })
    } else {
      result = { outcome: 'rejected', detail: `The ${row.channel} alert is no longer set on this watch.` }
    }
  } catch (cause) {
    // Addresses and secrets never reach the record: only the kind of failure does.
    const described = describeError(cause)
    result = { outcome: 'rejected', detail: described.kind === 'unexpected' ? 'The alert could not be sent.' : described.message }
  }
  const attempts = row.attempts + 1
  const error: RecordedError | null = result.outcome === 'delivered' ? null : { at: now, kind: result.outcome, message: result.detail, ...(result.status ? { status: result.status } : {}), ...(result.code ? { code: result.code } : {}) }
  const next = result.outcome === 'retry' && attempts < MAX_ATTEMPTS ? result.retry_at ?? now + RETRY_MS[Math.min(attempts - 1, RETRY_MS.length - 1)]! : null
  await ctx.db.prepare('UPDATE stump_watch_deliveries SET state=?,attempts=?,last_error=?,last_attempt_at=?,next_attempt_at=?,delivered_at=? WHERE event_id=? AND channel=?')
    .bind(result.outcome, attempts, error ? JSON.stringify(error) : null, now, next, result.outcome === 'delivered' ? now : null, row.event_id, row.channel).run()
  return result
}

/**
 * Immediate alerts for what a poll found (STUMP-WATCH-004): each finding at or above the watch's relevance
 * goes at once to its Slack incoming webhook and its signed webhook, one event per finding. A muted
 * watch sends nothing and keeps collecting. Returns how many events were sent.
 */
export async function sendImmediateAlerts(ctx: AlertContext, watch: WatchRow, subjects: AlertSubject[]): Promise<number> {
  const channels = channelsOf(watch)
  if (!watch.alerts || !channels.length || isMuted(watch, ctx.now())) return 0
  const eligible = subjects.filter(subject => subject.relevance >= watch.alerts!.immediate_min_relevance).sort((a, b) => b.relevance - a.relevance).slice(0, MAX_PER_POLL)
  for (const subject of eligible) {
    const eventId = await deriveEventId(['watch.alert', watch.id, subject.id]), message = JSON.stringify(messageFor(ctx, watch, subject))
    for (const channel of channels) {
      const created = await ctx.db.prepare("INSERT INTO stump_watch_deliveries(event_id,channel,watch_id,finding_id,message,state,attempts,created_at) VALUES(?,?,?,?,?,'pending',0,?) ON CONFLICT(event_id,channel) DO NOTHING RETURNING event_id")
        .bind(eventId, channel, watch.id, subject.id, message, ctx.now()).first()
      if (created) await attempt(ctx, watch, { event_id: eventId, channel, watch_id: watch.id, finding_id: subject.id, message, state: 'pending', attempts: 0 })
    }
  }
  return eligible.length
}

export interface Replayed { channel: Channel; outcome: DeliveryResult['outcome']; status: number | null; detail: string }

/**
 * Sends an event again with the same event id and body: a receiver that handled the id has no second
 * effect (STUMP-WATCH-004.5). Only the signed webhook carries an event id, so a replay resends that
 * delivery; a Slack incoming webhook cannot recognise a repeat, so Slack is posted again only when the
 * call names `channel: 'slack'`.
 */
export async function replayEvent(ctx: AlertContext, eventId: string, channel: Channel = 'webhook'): Promise<{ event_id: string; watch_id: string; deliveries: Replayed[] }> {
  const all = (await ctx.db.prepare('SELECT event_id,channel,watch_id,finding_id,message,state,attempts FROM stump_watch_deliveries WHERE event_id=?').bind(eventId).all<DeliveryRow>()).results
  if (!all.length) refuse('not_found', { event_id: eventId })
  const rows = all.filter(row => row.channel === channel)
  if (!rows.length) refuse('not_found', { event_id: eventId, channel, reason: channel === 'webhook' ? 'This alert went to Slack only. Name channel "slack" to post it to Slack again.' : 'This alert did not go to Slack.' })
  const watch = await readWatch(ctx.db, rows[0]!.watch_id)
  if (!watch) refuse('not_found', { watch_id: rows[0]!.watch_id })
  if (isMuted(watch, ctx.now())) refuse('watch_muted', { watch_id: watch.id, reason: 'A muted watch sends nothing. Unmute it to replay.' })
  const deliveries: Replayed[] = []
  for (const row of rows) { const result = await attempt(ctx, watch, row); deliveries.push({ channel: row.channel, outcome: result.outcome, status: result.status ?? null, detail: result.detail }) }
  return { event_id: eventId, watch_id: watch.id, deliveries }
}

/** The scheduled event's share: alerts a receiver asked to retry, and ones a stopped poll left unsent. */
export async function retryDueDeliveries(ctx: AlertContext): Promise<number> {
  const now = ctx.now()
  const rows = (await ctx.db.prepare(`SELECT event_id,channel,watch_id,finding_id,message,state,attempts FROM stump_watch_deliveries
    WHERE (state='retry' AND next_attempt_at<=? AND attempts<?) OR (state='pending' AND attempts=0 AND created_at<?) ORDER BY created_at LIMIT 20`).bind(now, MAX_ATTEMPTS, now - 5 * 60_000).all<DeliveryRow>()).results
  let sent = 0
  for (const row of rows) {
    const watch = await readWatch(ctx.db, row.watch_id)
    if (!watch || isMuted(watch, now)) continue
    await attempt(ctx, watch, row); sent += 1
  }
  return sent
}
