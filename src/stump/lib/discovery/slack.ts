/**
 * Slack incoming-webhook alerts. STUMP-WATCH-004.2.
 *
 * Docs: https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/ (POST JSON to the
 * webhook URL; 200 `ok`; errors `invalid_payload`, `no_text`, `channel_not_found`, `channel_is_archived`,
 * `action_prohibited`, `no_service`, `no_team`, `team_disabled`, ...; 429 with Retry-After).
 * Block Kit limits: https://docs.slack.dev/reference/block-kit/blocks/ (50 blocks, section text 3000
 * characters, header text 150 characters). Escaping `&`, `<`, `>`: https://docs.slack.dev/messaging/formatting-message-text/#escaping .
 *
 * Found text is untrusted. Titles and authors are escaped so they cannot become mentions or links, and
 * the excerpt goes in a plain_text element, which Slack does not parse.
 */
import { SourceError } from './errors.ts'
import { rateLimitRetryAt, readText, send, type HttpOptions } from './http.ts'
import type { AlertFinding, AlertMessage } from './alert-types.ts'
import { truncateGraphemes } from './text.ts'
import { parseHttpUrl } from './url.ts'
import type { DeliveryResult } from './types.ts'

export const SLACK_WEBHOOK_HOSTS = ['hooks.slack.com', 'hooks.slack-gov.com']
const MAX_FINDINGS = 10

export interface SlackPayload {
  text: string
  blocks: Record<string, unknown>[]
  unfurl_links: false
  unfurl_media: false
}

export function slackEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Escape and flatten text used inside mrkdwn: no line breaks, no formatting characters an author could use. */
function inline(s: string, max: number): string {
  return slackEscape(truncateGraphemes(s.replace(/\s+/g, ' ').trim(), max)).replace(/[*_~`|]/g, '')
}

function slackUrl(url: string): string | null {
  const u = parseHttpUrl(url)
  if (!u) return null
  return u.href.replace(/[<>|\s]/g, (c) => encodeURIComponent(c))
}

function link(url: string, label: string): string {
  const safe = slackUrl(url)
  return safe ? `<${safe}|${label || safe}>` : label
}

function findingBlocks(f: AlertFinding): Record<string, unknown>[] {
  const meta = [
    f.source_url ? link(f.source_url, inline(f.source, 20)) : inline(f.source, 20),
    f.author ? inline(f.author, 60) : '',
    typeof f.relevance === 'number' ? `relevance ${Math.round(f.relevance)}` : '',
  ].filter(Boolean)
  const blocks: Record<string, unknown>[] = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*${link(f.url, inline(f.title || f.source_url || 'Finding', 200))}*\n${meta.join(' · ')}` },
    },
  ]
  // Angle brackets are dropped from the excerpt so no mention or link markup can survive in it.
  const extra = [f.excerpt ? truncateGraphemes(f.excerpt.replace(/[<>]/g, '').replace(/\s+/g, ' '), 280) : '', ...(f.reasons ?? []).slice(0, 3)].filter(Boolean)
  if (extra.length) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'plain_text', text: truncateGraphemes(extra.join(' — '), 600), emoji: false }],
    })
  }
  return blocks
}

export function buildSlackPayload(msg: AlertMessage): SlackPayload {
  const shown = msg.findings.slice(0, MAX_FINDINGS)
  const rest = msg.findings.length - shown.length
  const heading =
    msg.kind === 'digest'
      ? `${msg.findings.length} findings for ${msg.watch_name}`
      : `New finding for ${msg.watch_name}`
  const first = shown[0]
  // The top-level text is parsed as mrkdwn: everything found in it is escaped and flattened.
  const safeHeading = msg.kind === 'digest' ? `${msg.findings.length} findings for ${inline(msg.watch_name, 80)}` : `New finding for ${inline(msg.watch_name, 80)}`
  const text = truncateGraphemes(
    first && msg.kind === 'immediate' ? `${safeHeading}: ${inline(first.title, 200)} ${slackUrl(first.url) ?? ''}` : `${safeHeading} ${msg.watch_url ? (slackUrl(msg.watch_url) ?? '') : ''}`.trim(),
    500,
  )
  const blocks: Record<string, unknown>[] = [
    { type: 'header', text: { type: 'plain_text', text: truncateGraphemes(heading, 140), emoji: false } },
  ]
  for (const f of shown) blocks.push(...findingBlocks(f))
  if (rest > 0) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: msg.watch_url ? `${rest} more in ${link(msg.watch_url, inline(msg.watch_name, 60))}` : `${rest} more in the app` }],
    })
  }
  return { text, blocks: blocks.slice(0, 50), unfurl_links: false, unfurl_media: false }
}

export function assertSlackWebhookUrl(url: string, allowedHosts: string[] = SLACK_WEBHOOK_HOSTS): URL {
  const u = parseHttpUrl(url)
  if (!u || u.protocol !== 'https:' || u.username || u.password || !allowedHosts.includes(u.hostname.toLowerCase())) {
    throw new SourceError('invalid_request', 'alert', `A Slack webhook address must be an https URL on ${allowedHosts.join(' or ')}`)
  }
  return u
}

export interface SlackPostOptions extends HttpOptions {
  webhook_url: string
  message: AlertMessage
  /** Replace the allowed Slack hosts, for a Slack-compatible endpoint the company runs. */
  allowed_hosts?: string[]
}

/**
 * Post one alert. The result tells the truth about what is known:
 * `delivered` only on Slack's 200 `ok`; `retry` for 429 and 5xx (not delivered); `rejected` for a
 * 4xx with Slack's code; `unknown` when the request may have arrived (timeout, dropped connection).
 */
export async function postSlackAlert(options: SlackPostOptions): Promise<DeliveryResult> {
  const url = assertSlackWebhookUrl(options.webhook_url, options.allowed_hosts).href
  const now = options.now ?? Date.now
  let response: Response
  try {
    response = await send('alert', options, url, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(buildSlackPayload(options.message)),
    })
  } catch (e) {
    const detail = e instanceof SourceError ? e.message.replace(url, 'the Slack webhook') : 'the request failed'
    return { outcome: 'unknown', detail: `Slack may or may not have received the alert: ${detail}` }
  }
  let body = ''
  try {
    body = (await readText('alert', response, url, 10_000)).trim()
  } catch {
    body = ''
  }
  if (response.status === 200) {
    return body === 'ok'
      ? { outcome: 'delivered', status: 200, detail: 'Slack accepted the alert' }
      : { outcome: 'unknown', status: 200, detail: 'Slack answered 200 without "ok"' }
  }
  if (response.status === 429) {
    return {
      outcome: 'retry', status: 429, code: 'rate_limited',
      retry_at: rateLimitRetryAt(response.headers, now()) ?? now() + 60_000,
      detail: 'Slack rate limited the webhook',
    }
  }
  const code = /^[a-z_]{3,60}$/.test(body) ? body : undefined
  if (response.status >= 500 || response.status === 408) {
    return { outcome: 'retry', status: response.status, code, detail: `Slack answered HTTP ${response.status}` }
  }
  return { outcome: 'rejected', status: response.status, code, detail: `Slack refused the alert${code ? `: ${code}` : ` (HTTP ${response.status})`}` }
}
