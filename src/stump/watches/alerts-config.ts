import { refuse } from '../actions/refusals.ts'
import type { StumpEnv } from '../env.ts'
import { assertSlackWebhookUrl, assertWebhookUrl, SourceError } from '../lib/discovery/index.ts'
import { DEFAULT_IMMEDIATE_MIN_RELEVANCE, type AlertsInput } from './model.ts'
import { seal } from './seal.ts'
import type { StoredAlerts } from './store.ts'

function checked<T>(field: string, check: () => T): T {
  try { return check() } catch (error) {
    if (error instanceof SourceError) refuse('invalid_arguments', { field, reason: error.message })
    throw error
  }
}

/** Whether alert input names a destination: what changes where found text can be sent (a security setting). */
export const setsDestination = (input: unknown): boolean => {
  const alerts = (input && typeof input === 'object' ? input : {}) as AlertsInput
  return alerts.slack !== undefined || alerts.webhook !== undefined
}

/**
 * Alert settings, checked and sealed. A destination given replaces the stored one; an empty one
 * (`slack: {}`) removes it; a webhook given a new address keeps its secret unless a new one comes
 * with it. The Slack address and the webhook address and secret are sealed under this watch.
 */
export async function sealAlerts(env: StumpEnv, watchId: string, input: unknown, existing: StoredAlerts | null): Promise<StoredAlerts> {
  const given = (input && typeof input === 'object' ? input : {}) as AlertsInput
  const next: StoredAlerts = { immediate_min_relevance: given.immediate_min_relevance ?? existing?.immediate_min_relevance ?? DEFAULT_IMMEDIATE_MIN_RELEVANCE, slack: existing?.slack ?? null, webhook: existing?.webhook ?? null }
  if (given.slack !== undefined) {
    if (given.slack.webhook_url === undefined) next.slack = null
    else {
      const url = checked('alerts.slack.webhook_url', () => assertSlackWebhookUrl(given.slack!.webhook_url!))
      next.slack = { url: await seal(env, `${watchId}:slack.url`, url.href), host: url.hostname }
    }
  }
  if (given.webhook !== undefined) {
    const { url, secret } = given.webhook
    if (url === undefined && secret === undefined) next.webhook = null
    else {
      if (url === undefined && !existing?.webhook) refuse('invalid_arguments', { field: 'alerts.webhook.url', reason: 'A webhook needs its address.' })
      if (secret === undefined && !existing?.webhook) refuse('invalid_arguments', { field: 'alerts.webhook.secret', reason: 'A signed webhook needs its secret.' })
      const parsed = url === undefined ? null : checked('alerts.webhook.url', () => assertWebhookUrl(url))
      next.webhook = {
        url: parsed ? await seal(env, `${watchId}:webhook.url`, parsed.href) : existing!.webhook!.url,
        secret: secret === undefined ? existing!.webhook!.secret : await seal(env, `${watchId}:webhook.secret`, secret),
        host: parsed ? parsed.hostname : existing!.webhook!.host,
      }
    }
  }
  return next
}
